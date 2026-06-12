import type { Event, SessionStatus } from "@opencode-ai/sdk/v2/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDiagnosticsReport,
  getDiagnosticsSnapshot,
  recordPromptFailure,
  recordPromptStart,
  recordPromptSuccess,
  recordSessionStatus,
  recordSseConnected,
  recordSseEvent,
  recordSseFailure,
  resetDiagnosticsForTest,
} from "@/lib/diagnostics";

describe("diagnostics", () => {
  beforeEach(() => {
    resetDiagnosticsForTest();
  });

  it("tracks prompt start, success, and failure without storing content", () => {
    recordPromptStart({
      sessionID: "s1",
      providerID: "openai",
      modelID: "gpt-5",
      now: new Date("2026-05-10T10:00:00.000Z"),
    });

    expect(getDiagnosticsSnapshot().prompt).toMatchObject({
      sessionID: "s1",
      providerID: "openai",
      modelID: "gpt-5",
      startedAt: "2026-05-10T10:00:00.000Z",
      completedAt: null,
      failedAt: null,
    });

    recordPromptSuccess(new Date("2026-05-10T10:00:01.000Z"));
    expect(getDiagnosticsSnapshot().prompt?.completedAt).toBe("2026-05-10T10:00:01.000Z");

    recordPromptFailure(new Error("network timeout"), new Date("2026-05-10T10:00:02.000Z"));
    expect(getDiagnosticsSnapshot().prompt?.error).toBe("network timeout");
    expect(getDiagnosticsSnapshot().prompt?.failedAt).toBe("2026-05-10T10:00:02.000Z");
  });

  it("tracks SSE state and event counts", () => {
    recordSseConnected(new Date("2026-05-10T10:00:00.000Z"));
    recordSseEvent(
      {
        type: "message.updated",
        properties: { info: { id: "m1", sessionID: "s1", role: "assistant" } },
      } as Event,
      new Date("2026-05-10T10:00:01.000Z"),
    );
    recordSseFailure("stream closed", 1, new Date("2026-05-10T10:00:02.000Z"));

    const snapshot = getDiagnosticsSnapshot();
    expect(snapshot.sse.eventCounts["message.updated"]).toBe(1);
    expect(snapshot.sse.lastEventType).toBe("message.updated");
    expect(snapshot.sse.state).toBe("failed");
    expect(snapshot.sse.lastFailure).toBe("stream closed");
  });

  it("reports a stuck signal for old busy prompts with no relevant event after send", () => {
    recordPromptStart({
      sessionID: "s1",
      providerID: "openai",
      modelID: "gpt-5",
      now: new Date("2026-05-10T10:00:00.000Z"),
    });

    const report = buildDiagnosticsReport({
      appVersion: "8.0.0",
      port: 59200,
      selectedModel: "openai/gpt-5",
      connectedProviders: ["openai"],
      activeSessionId: "s1",
      activeSessionStatus: { type: "busy" } as SessionStatus,
      now: new Date("2026-05-10T10:03:00.000Z"),
    });

    expect(report.stuckSignal.isStuck).toBe(true);
    expect(report.redaction).toEqual({
      includesSecrets: false,
      includesPromptText: false,
      includesMessageText: false,
      includesImageData: false,
    });
  });

  it("clears the stuck signal when a status update arrives after the prompt", () => {
    recordPromptStart({
      sessionID: "s1",
      providerID: "openai",
      modelID: "gpt-5",
      now: new Date("2026-05-10T10:00:00.000Z"),
    });
    recordSessionStatus("s1", "busy", new Date("2026-05-10T10:00:30.000Z"));

    const report = buildDiagnosticsReport({
      appVersion: "8.0.0",
      port: 59200,
      selectedModel: "openai/gpt-5",
      connectedProviders: ["openai"],
      activeSessionId: "s1",
      activeSessionStatus: { type: "busy" } as SessionStatus,
      now: new Date("2026-05-10T10:03:00.000Z"),
    });

    expect(report.stuckSignal.isStuck).toBe(false);
    expect(report.stuckSignal.relevantEventAfterPrompt).toBe(true);
  });
});
