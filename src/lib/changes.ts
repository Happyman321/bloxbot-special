import type { FileDiff, SnapshotFileDiff } from "@opencode-ai/sdk/v2/client";
import type { MessageWithParts } from "@/types";

export type ChangeKind = "add" | "modify" | "delete";
export interface ScriptDiffLine {
  type: "context" | "add" | "remove";
  text: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}
export interface SessionChange {
  key: string;
  path: string;
  kind: ChangeKind;
  before: string;
  after: string;
  isScript: boolean;
  linesAdded: number;
  linesRemoved: number;
  diffLines: ScriptDiffLine[];
  sourceMessageId?: string;
  sourceMessageCreatedAt?: number;
  properties?: PropertyChange[];
  patchOnly?: boolean;
}
export interface PropertyChange {
  name: string;
  before?: unknown;
  after?: unknown;
}
export interface StudioObject {
  id: string;
  path: string;
  className: string;
  source?: string;
  properties: Record<string, unknown>;
}
export interface StudioCapture {
  version: 1;
  scope: string;
  changes: Array<{ id: string; before: StudioObject | null; after: StudioObject | null }>;
  warning?: string;
}
export interface ChangeTurn {
  id: string;
  label: string;
  createdAt?: number;
  messages: MessageWithParts[];
  captureIds: string[];
  studioCalls: number;
}

const SCRIPT_PATH = /\.(lua|luau|ts|tsx|js|jsx|json|toml|yaml|yml|md|rs|css|html)$/i;
const CAPTURE_MARKER =
  /\[BloxBot capture: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/g;
const normalizePath = (path: string) => path.replace(/\\/g, "/").trim();
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function getChangeTurns(
  ids: string[],
  byId: Record<string, MessageWithParts>,
): ChangeTurn[] {
  const turns: ChangeTurn[] = [];
  for (const id of ids) {
    const message = byId[id];
    if (!message) continue;
    if (message.info.role === "user") {
      const text = message.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      turns.push({
        id,
        label: text.split("\n\n").slice(-1)[0]?.slice(0, 160) || "Request",
        createdAt: message.info.time?.created,
        messages: [],
        captureIds: [],
        studioCalls: 0,
      });
    } else if (message.info.role === "assistant") {
      // Old imported transcripts may not contain a user message.
      if (!turns.length)
        turns.push({ id, label: "Earlier request", messages: [], captureIds: [], studioCalls: 0 });
      const parentID = "parentID" in message.info ? message.info.parentID : undefined;
      const turn = turns.find((t) => t.id === parentID) ?? turns[turns.length - 1];
      turn.messages.push(message);
      for (const part of message.parts) {
        if (part.type !== "tool") continue;
        if (/roblox.studio.*(execute_luau|multi_edit|insert)/i.test(part.tool)) turn.studioCalls++;
        const state = record(part.state);
        const output = string(state?.output) ?? string(state?.error) ?? "";
        for (const match of output.matchAll(CAPTURE_MARKER)) {
          if (!turn.captureIds.includes(match[1])) turn.captureIds.push(match[1]);
        }
      }
    }
  }
  return turns;
}

/** Myers line alignment, with a work limit for completely different large files. */
export function computeScriptDiff(before: string, after: string): ScriptDiffLine[] {
  const split = (text: string) => (text === "" ? [] : text.replace(/\r\n/g, "\n").split("\n"));
  const a = split(before),
    b = split(after);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  const left = a.slice(prefix, a.length - suffix),
    right = b.slice(prefix, b.length - suffix);
  type Edit = { type: ScriptDiffLine["type"]; text: string };
  const trace: Map<number, number>[] = [];
  const v = new Map<number, number>([[1, 0]]);
  let middle: Edit[] | undefined;
  let work = 0;
  search: for (let d = 0; d <= left.length + right.length; d++) {
    work += 2 * d + 1;
    if (work > 1_000_000) break;
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))
          ? (v.get(k + 1) ?? 0)
          : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < left.length && y < right.length && left[x] === right[y]) {
        x++;
        y++;
      }
      v.set(k, x);
      if (x < left.length || y < right.length) continue;
      middle = [];
      for (let depth = d; depth >= 0; depth--) {
        const previous = trace[depth];
        const diagonal = x - y;
        const prevK =
          diagonal === -depth ||
          (diagonal !== depth &&
            (previous.get(diagonal - 1) ?? -1) < (previous.get(diagonal + 1) ?? -1))
            ? diagonal + 1
            : diagonal - 1;
        const prevX = previous.get(prevK) ?? 0,
          prevY = prevX - prevK;
        while (x > prevX && y > prevY) {
          middle.push({ type: "context", text: left[--x] });
          y--;
        }
        if (depth > 0) {
          if (x === prevX) middle.push({ type: "add", text: right[--y] });
          else middle.push({ type: "remove", text: left[--x] });
        }
      }
      middle.reverse();
      break search;
    }
  }
  middle ??= [
    ...left.map((text) => ({ type: "remove" as const, text })),
    ...right.map((text) => ({ type: "add" as const, text })),
  ];
  const edits: Edit[] = [
    ...a.slice(0, prefix).map((text) => ({ type: "context" as const, text })),
    ...middle,
    ...a.slice(a.length - suffix).map((text) => ({ type: "context" as const, text })),
  ];
  let oldLine = 0,
    newLine = 0;
  return edits.map((line) => ({
    ...line,
    oldLineNumber: line.type === "add" ? null : ++oldLine,
    newLineNumber: line.type === "remove" ? null : ++newLine,
  }));
}

function makeChange(
  path: string,
  before: string,
  after: string,
  kind: ChangeKind,
  messageId?: string,
): SessionChange {
  const diffLines = computeScriptDiff(before, after);
  return {
    key: `${messageId}:${path}`,
    path,
    before,
    after,
    kind,
    isScript: SCRIPT_PATH.test(path),
    diffLines,
    linesAdded: diffLines.filter((l) => l.type === "add").length,
    linesRemoved: diffLines.filter((l) => l.type === "remove").length,
    sourceMessageId: messageId,
  };
}

// Only accept recorded before/after pairs. Tool inputs are proposed work, not evidence of edits.
function extractPairs(
  value: unknown,
  depth = 0,
): Array<{ path: string; before: string; after: string }> {
  if (depth > 5) return [];
  const parsed = json(value) ?? value;
  if (Array.isArray(parsed)) return parsed.flatMap((item) => extractPairs(item, depth + 1));
  const obj = record(parsed);
  if (!obj) return [];
  const path = string(obj.filePath) ?? string(obj.path) ?? string(obj.file) ?? string(obj.filename);
  const before = string(obj.before),
    after = string(obj.after);
  if (path && before !== undefined && after !== undefined)
    return [{ path: normalizePath(path), before, after }];
  return ["files", "changes", "edits", "results", "content", "text", "filediff"].flatMap((key) =>
    extractPairs(obj[key], depth + 1),
  );
}

export function buildSessionChanges(
  ids: string[],
  byId: Record<string, MessageWithParts>,
): SessionChange[] {
  const turns = getChangeTurns(ids, byId);
  const turn = turns[turns.length - 1];
  return turn ? buildTurnChanges(turn, {}) : [];
}

export function buildTurnChanges(
  turn: ChangeTurn,
  captures: Record<string, StudioCapture>,
): SessionChange[] {
  const files = new Map<string, { before: string; after: string }>();
  for (const message of turn.messages)
    for (const part of message.parts) {
      const raw = record(part);
      const state = record(raw?.state);
      const sources =
        part.type === "tool"
          ? state?.status === "completed"
            ? [state.metadata, state.output]
            : []
          : part.type === "patch"
            ? [part]
            : [];
      for (const source of sources)
        for (const pair of extractPairs(source)) {
          files.set(pair.path, {
            before: files.get(pair.path)?.before ?? pair.before,
            after: pair.after,
          });
        }
    }
  const result: SessionChange[] = [];
  for (const [path, value] of files) {
    if (value.before === value.after) continue;
    result.push(
      makeChange(
        path,
        value.before,
        value.after,
        !value.before ? "add" : !value.after ? "delete" : "modify",
        turn.id,
      ),
    );
  }
  const objects = new Map<string, StudioCapture["changes"][number]>();
  for (const captureId of turn.captureIds) {
    const capture = captures[captureId];
    if (!capture) continue;
    for (const change of capture.changes) {
      const key = `${capture.scope}:${change.id}`;
      const first = objects.get(key);
      objects.set(key, { ...change, before: first ? first.before : change.before });
    }
  }
  for (const [key, { before, after }] of objects) {
    if (!before && !after) continue;
    const properties: PropertyChange[] = [];
    const oldProps = before
      ? { Path: before.path, ClassName: before.className, ...before.properties }
      : {};
    const newProps = after
      ? { Path: after.path, ClassName: after.className, ...after.properties }
      : {};
    for (const name of [...new Set([...Object.keys(oldProps), ...Object.keys(newProps)])].sort()) {
      const oldValue = (oldProps as Record<string, unknown>)[name],
        newValue = (newProps as Record<string, unknown>)[name];
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue))
        properties.push({ name, before: oldValue, after: newValue });
    }
    if (before && after && before.source === after.source && !properties.length) continue;
    const object = after ?? before;
    if (!object) continue;
    const change = makeChange(
      object.path,
      before?.source ?? "",
      after?.source ?? "",
      !before ? "add" : !after ? "delete" : "modify",
      turn.id,
    );
    change.key = `${turn.id}:${key}`;
    change.isScript = object.source !== undefined;
    change.properties = properties;
    result.push(change);
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

type ApiDiff =
  | FileDiff
  | SnapshotFileDiff
  | { file: string; before: string; after: string; additions: number; deletions: number };
export function buildSessionChangesFromDiffs(
  items: Array<{ messageId: string; createdAt?: number; diffs: ApiDiff[] }>,
): SessionChange[] {
  return items
    .flatMap((item) =>
      item.diffs.flatMap((diff) => {
        const path = normalizePath(("path" in diff ? diff.path : diff.file) ?? "");
        if (!path) return [];
        const kind =
          "status" in diff && diff.status === "added"
            ? "add"
            : "status" in diff && diff.status === "deleted"
              ? "delete"
              : "modify";
        const change = makeChange(
          path,
          "before" in diff ? diff.before : "",
          "after" in diff ? diff.after : "",
          kind,
          item.messageId,
        );
        change.sourceMessageCreatedAt = item.createdAt;
        if ("patch" in diff) {
          change.patchOnly = true;
          change.linesAdded = diff.additions;
          change.linesRemoved = diff.deletions;
          let oldLine = 0,
            newLine = 0,
            inHunk = false;
          change.diffLines = (diff.patch ?? "").split("\n").flatMap((text): ScriptDiffLine[] => {
            const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
            if (hunk) {
              oldLine = Number(hunk[1]);
              newLine = Number(hunk[2]);
              inHunk = true;
              return [{ type: "context", text, oldLineNumber: null, newLineNumber: null }];
            }
            if (!inHunk) return [];
            if (text.startsWith("+"))
              return [
                { type: "add", text: text.slice(1), oldLineNumber: null, newLineNumber: newLine++ },
              ];
            if (text.startsWith("-"))
              return [
                {
                  type: "remove",
                  text: text.slice(1),
                  oldLineNumber: oldLine++,
                  newLineNumber: null,
                },
              ];
            if (text.startsWith(" "))
              return [
                {
                  type: "context",
                  text: text.slice(1),
                  oldLineNumber: oldLine++,
                  newLineNumber: newLine++,
                },
              ];
            return [];
          });
        }
        return [change];
      }),
    )
    .sort(
      (a, b) =>
        (b.sourceMessageCreatedAt ?? 0) - (a.sourceMessageCreatedAt ?? 0) ||
        a.path.localeCompare(b.path),
    );
}
