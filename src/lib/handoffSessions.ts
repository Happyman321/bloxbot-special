import type { Event, Session } from "@opencode-ai/sdk/v2/client";

export const HANDOFF_PREFIX = "[BloxBot internal handoff] ";
export const HANDOFF_AGENT = "bloxbot-handoff";
const internalIds = new Set<string>();
const internalMessages = new Set<string>();

export function isInternalHandoffSession(session: Session): boolean {
  const internal =
    session.title.startsWith(HANDOFF_PREFIX) ||
    session.metadata?.bloxbotHandoff === "pending" ||
    session.metadata?.bloxbotHandoff === "scratch";
  if (internal) internalIds.add(session.id);
  else internalIds.delete(session.id);
  return internal;
}

export function visibleSessions(sessions: Session[]): Session[] {
  return sessions.filter((session) => !isInternalHandoffSession(session));
}

/** Filter before diagnostics and cache dispatch, including content-only deltas. */
export function isInternalHandoffEvent(event: Event): boolean {
  const properties = event.properties as Record<string, unknown>;
  const info = properties.info as Record<string, unknown> | undefined;
  if (event.type.startsWith("session.") && info && typeof info.title === "string") {
    return isInternalHandoffSession(info as Session);
  }
  const part = properties.part as Record<string, unknown> | undefined;
  const id = properties.sessionID ?? info?.sessionID ?? part?.sessionID;
  if (typeof id === "string" && internalIds.has(id)) {
    if (event.type === "message.updated" && typeof info?.id === "string") {
      internalMessages.add(info.id);
    }
    return true;
  }
  return typeof properties.messageID === "string" && internalMessages.has(properties.messageID);
}
