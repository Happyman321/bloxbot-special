import type {
  Event,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from "@opencode-ai/sdk/v2/client";
import type { QueryClient } from "@tanstack/react-query";

import { chatErrorMessage, isChatAbortError } from "@/lib/chatErrors";
import { claimDictatorManagedSession, type DictatorProfile } from "@/lib/dictators";
import { upsertSessionById } from "@/lib/dictatorWorkers";
import { recordSessionStatus, recordSseEvent } from "@/lib/diagnostics";
import { qk } from "@/lib/queryKeys";
import type { MessageWithParts } from "@/types";

export interface MessagesCache {
  messageIds: string[];
  messagesById: Record<string, MessageWithParts>;
}

function getCachedMessageSessionId(queryClient: QueryClient, messageID: string): string | null {
  const messageCaches = queryClient.getQueriesData<MessagesCache>({ queryKey: ["sessions"] });
  for (const [queryKey, cache] of messageCaches) {
    if (!Array.isArray(queryKey) || queryKey.length !== 3 || queryKey[2] !== "messages") continue;
    if (cache?.messagesById[messageID]) return String(queryKey[1]);
  }
  return null;
}

function updateSessionQuestion(
  queryClient: QueryClient,
  currentSessionId: string | null,
  sessionID: string,
  question: QuestionRequest | null,
) {
  queryClient.setQueryData<QuestionRequest | null>(qk.question(sessionID), question);
  if (sessionID === currentSessionId) {
    queryClient.setQueryData<QuestionRequest | null>(qk.questions, question);
  }
}

function updateSessionPermission(
  queryClient: QueryClient,
  currentSessionId: string | null,
  sessionID: string,
  permission: PermissionRequest | null,
) {
  queryClient.setQueryData<PermissionRequest | null>(qk.permission(sessionID), permission);
  if (sessionID === currentSessionId) {
    queryClient.setQueryData<PermissionRequest | null>(qk.permissions, permission);
  }
}

function claimDictatorChildSession(queryClient: QueryClient, session: Session) {
  if (!session.parentID) return;

  const profiles = queryClient.getQueryData<DictatorProfile[]>(qk.dictators);
  if (!profiles?.some((profile) => profile.parentSessionId === session.parentID)) return;

  queryClient.setQueryData<Session[]>(qk.dictatorChildren(session.parentID), (prev) =>
    upsertSessionById(prev ?? [], session),
  );
  queryClient.setQueryData<DictatorProfile[]>(qk.dictators, (prev) =>
    claimDictatorManagedSession(prev, session.id, session.parentID),
  );
}

/**
 * Maps an SSE Event to query cache updates.
 * `activeSessionIdRef` is a ref so we can read it without restarting the SSE loop.
 */
export function sseDispatch(
  queryClient: QueryClient,
  event: Event,
  activeSessionIdRef: { current: string | null },
) {
  if (!event || !event.type) return;

  const currentSessionId = activeSessionIdRef.current;
  recordSseEvent(event);

  try {
    switch (event.type) {
      case "session.created": {
        const { info } = event.properties;
        queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
          if (!prev) return [info];
          if (prev.some((s) => s.id === info.id)) return prev;
          return [info, ...prev];
        });
        claimDictatorChildSession(queryClient, info);
        break;
      }
      case "session.updated": {
        const { info } = event.properties;
        queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
          if (!prev) return prev;
          return prev.map((s) => (s.id === info.id ? info : s));
        });
        claimDictatorChildSession(queryClient, info);
        break;
      }
      case "session.deleted": {
        const { info } = event.properties;
        queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
          if (!prev) return prev;
          return prev.filter((s) => s.id !== info.id);
        });
        break;
      }
      case "session.status": {
        const { sessionID, status } = event.properties;
        recordSessionStatus(sessionID, status.type);
        if (status.type === "busy") queryClient.setQueryData(qk.chatError(sessionID), null);
        queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (prev) => {
          if (prev?.[sessionID]?.type === status.type) return prev;
          return { ...prev, [sessionID]: status };
        });
        break;
      }
      case "session.idle": {
        const { sessionID } = event.properties;
        recordSessionStatus(sessionID, "idle");
        queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (prev) => {
          if (prev?.[sessionID]?.type === "idle") return prev;
          return { ...prev, [sessionID]: { type: "idle" } as SessionStatus };
        });
        break;
      }
      case "message.updated": {
        const { info } = event.properties;
        queryClient.setQueryData<MessagesCache>(qk.messages(info.sessionID), (prev) => {
          if (!prev)
            return { messageIds: [info.id], messagesById: { [info.id]: { info, parts: [] } } };
          const existing = prev.messagesById[info.id];
          if (existing) {
            return {
              ...prev,
              messagesById: { ...prev.messagesById, [info.id]: { ...existing, info } },
            };
          }
          return {
            messageIds: [...prev.messageIds, info.id],
            messagesById: { ...prev.messagesById, [info.id]: { info, parts: [] } },
          };
        });
        if (info.role === "user") queryClient.setQueryData(qk.chatError(info.sessionID), null);
        if (info.role === "assistant" && "error" in info && info.error) {
          recordSessionStatus(info.sessionID, "idle");
          queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (prev) => ({
            ...prev,
            [info.sessionID]: { type: "idle" } as SessionStatus,
          }));
        }
        break;
      }
      case "session.error": {
        const sessionID = event.properties.sessionID ?? currentSessionId;
        if (!sessionID) break;
        queryClient.setQueryData(
          qk.chatError(sessionID),
          isChatAbortError(event.properties.error)
            ? null
            : chatErrorMessage(event.properties.error),
        );
        recordSessionStatus(sessionID, "idle");
        queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (prev) => ({
          ...prev,
          [sessionID]: { type: "idle" } as SessionStatus,
        }));
        break;
      }
      case "message.part.updated": {
        const { part } = event.properties;
        queryClient.setQueryData<MessagesCache>(qk.messages(part.sessionID), (prev) => {
          if (!prev) return prev;
          const msg = prev.messagesById[part.messageID];
          if (!msg) return prev;
          const partIdx = msg.parts.findIndex((p) => p.id === part.id);
          const newParts =
            partIdx >= 0
              ? msg.parts.map((p, i) => (i === partIdx ? part : p))
              : [...msg.parts, part];
          return {
            ...prev,
            messagesById: {
              ...prev.messagesById,
              [part.messageID]: { ...msg, parts: newParts },
            },
          };
        });
        break;
      }
      case "message.part.delta": {
        const { messageID, partID, field, delta } = event.properties;
        const sessionID = getCachedMessageSessionId(queryClient, messageID) ?? currentSessionId;
        if (!sessionID) break;
        queryClient.setQueryData<MessagesCache>(qk.messages(sessionID), (prev) => {
          if (!prev) return prev;
          const msg = prev.messagesById[messageID];
          if (!msg) return prev;
          const partIdx = msg.parts.findIndex((p) => p.id === partID);
          if (partIdx < 0) return prev;
          const part = { ...msg.parts[partIdx] };
          const key = field || "text";
          if (key in part && typeof (part as Record<string, unknown>)[key] === "string") {
            (part as Record<string, unknown>)[key] =
              ((part as Record<string, unknown>)[key] as string) + delta;
          }
          const newParts = msg.parts.map((p, i) => (i === partIdx ? part : p));
          return {
            ...prev,
            messagesById: { ...prev.messagesById, [messageID]: { ...msg, parts: newParts } },
          };
        });
        break;
      }
      case "message.removed": {
        const { sessionID, messageID } = event.properties;
        queryClient.setQueryData<MessagesCache>(qk.messages(sessionID), (prev) => {
          if (!prev) return prev;
          const { [messageID]: _removed, ...rest } = prev.messagesById;
          return {
            messageIds: prev.messageIds.filter((id) => id !== messageID),
            messagesById: rest,
          };
        });
        break;
      }
      case "message.part.removed": {
        const { sessionID, messageID, partID } = event.properties;
        queryClient.setQueryData<MessagesCache>(qk.messages(sessionID), (prev) => {
          if (!prev) return prev;
          const msg = prev.messagesById[messageID];
          if (!msg) return prev;
          return {
            ...prev,
            messagesById: {
              ...prev.messagesById,
              [messageID]: { ...msg, parts: msg.parts.filter((p) => p.id !== partID) },
            },
          };
        });
        break;
      }
      case "todo.updated": {
        const { sessionID, todos } = event.properties;
        queryClient.setQueryData<Todo[]>(qk.todos(sessionID), todos);
        break;
      }
      case "question.asked": {
        const props = event.properties;
        updateSessionQuestion(queryClient, currentSessionId, props.sessionID, props);
        break;
      }
      case "question.replied":
      case "question.rejected": {
        const { sessionID } = event.properties;
        updateSessionQuestion(queryClient, currentSessionId, sessionID, null);
        break;
      }
      case "permission.asked": {
        const props = event.properties;
        updateSessionPermission(queryClient, currentSessionId, props.sessionID, props);
        break;
      }
      case "permission.replied": {
        const { sessionID } = event.properties;
        updateSessionPermission(queryClient, currentSessionId, sessionID, null);
        break;
      }
    }
  } catch (err) {
    console.warn("sseDispatch: malformed event, skipping", event.type, err);
  }
}
