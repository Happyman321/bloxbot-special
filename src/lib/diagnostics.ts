import type { Event, ProviderAuthMethod, SessionStatus } from "@opencode-ai/sdk/v2/client";

export const STUCK_PROMPT_THRESHOLD_MS = 120_000;

type SseState = "idle" | "connected" | "reconnecting" | "failed";

interface PromptDiagnostics {
  sessionID: string;
  providerID: string | null;
  modelID: string | null;
  startedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  error: string | null;
}

interface DiagnosticsState {
  prompt: PromptDiagnostics | null;
  sse: {
    state: SseState;
    consecutiveFailures: number;
    lastConnectedAt: string | null;
    lastFailureAt: string | null;
    lastFailure: string | null;
    lastEventAt: string | null;
    lastEventType: string | null;
    eventCounts: Record<string, number>;
  };
  lastStatusUpdate: {
    at: string;
    sessionID: string;
    statusType: string;
  } | null;
  lastMessageUpdate: {
    at: string;
    sessionID: string | null;
    eventType: string;
  } | null;
  lastRelevantEventAt: string | null;
}

interface DiagnosticsReportInput {
  appVersion: string | null;
  port: number;
  selectedModel: string | null;
  connectedProviders: string[];
  activeSessionId: string | null;
  activeSessionStatus: SessionStatus | undefined;
  openaiAuthMethods?: ProviderAuthMethod[];
  now?: Date;
}

const MESSAGE_EVENT_TYPES = new Set(["message.updated", "message.part.updated", "message.part.delta"]);
const STATUS_EVENT_TYPES = new Set(["session.status", "session.idle"]);

function nowIso(now: Date = new Date()) {
  return now.toISOString();
}

function errorSummary(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  return String(error);
}

function initialState(): DiagnosticsState {
  return {
    prompt: null,
    sse: {
      state: "idle",
      consecutiveFailures: 0,
      lastConnectedAt: null,
      lastFailureAt: null,
      lastFailure: null,
      lastEventAt: null,
      lastEventType: null,
      eventCounts: {},
    },
    lastStatusUpdate: null,
    lastMessageUpdate: null,
    lastRelevantEventAt: null,
  };
}

let state = initialState();
const listeners = new Set<() => void>();

function publish(next: DiagnosticsState) {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDiagnosticsSnapshot(): DiagnosticsState {
  return state;
}

export function resetDiagnosticsForTest() {
  publish(initialState());
}

export function recordPromptStart(input: {
  sessionID: string;
  providerID?: string | null;
  modelID?: string | null;
  now?: Date;
}) {
  publish({
    ...state,
    prompt: {
      sessionID: input.sessionID,
      providerID: input.providerID ?? null,
      modelID: input.modelID ?? null,
      startedAt: nowIso(input.now),
      completedAt: null,
      failedAt: null,
      error: null,
    },
  });
}

export function recordPromptSuccess(now?: Date) {
  if (!state.prompt) return;
  publish({
    ...state,
    prompt: {
      ...state.prompt,
      completedAt: nowIso(now),
      failedAt: null,
      error: null,
    },
  });
}

export function recordPromptFailure(error: unknown, now?: Date) {
  if (!state.prompt) return;
  publish({
    ...state,
    prompt: {
      ...state.prompt,
      failedAt: nowIso(now),
      error: errorSummary(error),
    },
  });
}

export function recordSseConnected(now?: Date) {
  publish({
    ...state,
    sse: {
      ...state.sse,
      state: "connected",
      consecutiveFailures: 0,
      lastConnectedAt: nowIso(now),
      lastFailure: null,
    },
  });
}

export function recordSseFailure(error: unknown, consecutiveFailures: number, now?: Date) {
  publish({
    ...state,
    sse: {
      ...state.sse,
      state: "failed",
      consecutiveFailures,
      lastFailureAt: nowIso(now),
      lastFailure: errorSummary(error),
    },
  });
}

export function recordSseReconnecting(consecutiveFailures: number, now?: Date) {
  publish({
    ...state,
    sse: {
      ...state.sse,
      state: "reconnecting",
      consecutiveFailures,
      lastFailureAt: nowIso(now),
    },
  });
}

export function recordSseEvent(event: Event, now?: Date) {
  const at = nowIso(now);
  const eventType = event.type;
  const eventCounts = {
    ...state.sse.eventCounts,
    [eventType]: (state.sse.eventCounts[eventType] ?? 0) + 1,
  };
  const isRelevant = MESSAGE_EVENT_TYPES.has(eventType) || STATUS_EVENT_TYPES.has(eventType);
  const messageSessionID =
    "properties" in event &&
    event.properties &&
    typeof event.properties === "object" &&
    "info" in event.properties &&
    event.properties.info &&
    typeof event.properties.info === "object" &&
    "sessionID" in event.properties.info
      ? String(event.properties.info.sessionID)
      : "properties" in event &&
          event.properties &&
          typeof event.properties === "object" &&
          "part" in event.properties &&
          event.properties.part &&
          typeof event.properties.part === "object" &&
          "sessionID" in event.properties.part
        ? String(event.properties.part.sessionID)
        : null;

  publish({
    ...state,
    sse: {
      ...state.sse,
      state: "connected",
      consecutiveFailures: 0,
      lastEventAt: at,
      lastEventType: eventType,
      eventCounts,
    },
    lastMessageUpdate: MESSAGE_EVENT_TYPES.has(eventType)
      ? { at, sessionID: messageSessionID, eventType }
      : state.lastMessageUpdate,
    lastRelevantEventAt: isRelevant ? at : state.lastRelevantEventAt,
  });
}

export function recordSessionStatus(sessionID: string, statusType: string, now?: Date) {
  const at = nowIso(now);
  publish({
    ...state,
    lastStatusUpdate: { at, sessionID, statusType },
    lastRelevantEventAt: at,
  });
}

function methodTypes(methods?: ProviderAuthMethod[]) {
  return (methods ?? []).map((method) =>
    typeof method === "object" && method && "type" in method ? String(method.type) : "unknown",
  );
}

function buildStuckSignal(input: DiagnosticsReportInput, snapshot: DiagnosticsState) {
  const now = input.now ?? new Date();
  const prompt = snapshot.prompt;
  const activeStatusType = input.activeSessionStatus?.type ?? null;
  const promptAgeMs = prompt ? now.getTime() - Date.parse(prompt.startedAt) : null;
  const relevantEventAfterPrompt =
    !!prompt &&
    !!snapshot.lastRelevantEventAt &&
    Date.parse(snapshot.lastRelevantEventAt) > Date.parse(prompt.startedAt);
  const isStuck =
    activeStatusType === "busy" &&
    !!prompt &&
    prompt.sessionID === input.activeSessionId &&
    promptAgeMs !== null &&
    promptAgeMs >= STUCK_PROMPT_THRESHOLD_MS &&
    !relevantEventAfterPrompt;

  return {
    isStuck,
    thresholdMs: STUCK_PROMPT_THRESHOLD_MS,
    promptAgeMs,
    activeStatusType,
    relevantEventAfterPrompt,
  };
}

export function buildDiagnosticsReport(input: DiagnosticsReportInput) {
  const snapshot = getDiagnosticsSnapshot();
  const selectedProvider = input.selectedModel?.split("/")[0] ?? null;

  return {
    generatedAt: nowIso(input.now),
    app: {
      version: input.appVersion,
      platform: typeof navigator !== "undefined" ? navigator.platform : "unknown",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    },
    opencode: {
      port: input.port,
      sse: snapshot.sse,
    },
    provider: {
      selectedModel: input.selectedModel,
      selectedProvider,
      connectedProviders: input.connectedProviders,
      openaiAuthMethodTypes: methodTypes(input.openaiAuthMethods),
    },
    activeSession: {
      id: input.activeSessionId,
      cachedStatusType: input.activeSessionStatus?.type ?? null,
    },
    timestamps: {
      lastPrompt: snapshot.prompt,
      lastSseEventAt: snapshot.sse.lastEventAt,
      lastSseEventType: snapshot.sse.lastEventType,
      lastStatusUpdate: snapshot.lastStatusUpdate,
      lastMessageUpdate: snapshot.lastMessageUpdate,
    },
    stuckSignal: buildStuckSignal(input, snapshot),
    redaction: {
      includesSecrets: false,
      includesPromptText: false,
      includesMessageText: false,
      includesImageData: false,
    },
  };
}

export function formatDiagnosticsReport(input: DiagnosticsReportInput): string {
  return JSON.stringify(buildDiagnosticsReport(input), null, 2);
}
