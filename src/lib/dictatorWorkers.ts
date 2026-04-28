import type { Session } from "@opencode-ai/sdk/v2/client";
import type { MessagesCache } from "@/lib/sseDispatch";

const AGENT_NAME_PATTERN = /@?dictator-(worker|explorer|reviewer)/gi;

export type DictatorWorkerRole = "worker" | "explorer" | "reviewer";

export function upsertSessionById(sessions: Session[], session: Session): Session[] {
  const existingIndex = sessions.findIndex((item) => item.id === session.id);
  if (existingIndex < 0) return [session, ...sessions];
  return sessions.map((item) => (item.id === session.id ? session : item));
}

export function uniqueSessionsById(sessions: Session[]): Session[] {
  const seen = new Set<string>();
  const unique: Session[] = [];
  for (const session of sessions) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    unique.push(session);
  }
  return unique;
}

export function cleanWorkerTitle(value?: string | null): string {
  const cleaned = (value ?? "")
    .replace(AGENT_NAME_PATTERN, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:,-]+|[\s:,-]+$/g, "")
    .trim();
  return cleaned;
}

export function getDictatorWorkerRole(session: Session): DictatorWorkerRole {
  const title = session.title?.toLowerCase() ?? "";
  if (title.includes("dictator-explorer") || title.includes("explorer")) return "explorer";
  if (title.includes("dictator-reviewer") || title.includes("reviewer")) return "reviewer";
  return "worker";
}

export function getFirstUserText(cache?: MessagesCache): string {
  if (!cache) return "";
  for (const messageId of cache.messageIds) {
    const message = cache.messagesById[messageId];
    if (!message || message.info.role !== "user") continue;
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => ("text" in part ? part.text : ""))
      .join(" ")
      .trim();
    if (text) return cleanWorkerTitle(text);
  }
  return "";
}

export function deriveWorkerDisplayName(
  session: Session,
  cache?: MessagesCache,
  taskDescription?: string,
): string {
  const fromTitle = cleanWorkerTitle(session.title);
  if (fromTitle && fromTitle.toLowerCase() !== "untitled") return fromTitle;

  const fromTranscript = getFirstUserText(cache);
  if (fromTranscript) return fromTranscript;

  const fromTask = cleanWorkerTitle(taskDescription);
  if (fromTask) return fromTask;

  return `Worker ${session.id.slice(0, 8)}`;
}
