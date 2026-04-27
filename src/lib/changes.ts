import type { FileDiff, Part } from "@opencode-ai/sdk/v2/client";

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
}

interface RawChangeInput {
  path: string;
  before?: string;
  after?: string;
  kind?: ChangeKind;
  sourceMessageId?: string;
  sourceMessageCreatedAt?: number;
}

const SCRIPT_EXTENSIONS = new Set([
  ".lua",
  ".luau",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".toml",
  ".yaml",
  ".yml",
  ".md",
  ".rs",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").trim();
}

function inferKind(before: string, after: string, provided?: ChangeKind): ChangeKind {
  if (provided) return provided;
  if (!before && after) return "add";
  if (before && !after) return "delete";
  return "modify";
}

function isScriptPath(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase();
  const dot = normalized.lastIndexOf(".");
  if (dot < 0) return false;
  return SCRIPT_EXTENSIONS.has(normalized.slice(dot));
}

function parseToolPart(part: Part): RawChangeInput[] {
  const source = asRecord(part);
  if (!source) return [];
  const input = asRecord(source.input);
  const output = asRecord(source.output);
  const sources = [input, output].filter(Boolean) as Record<string, unknown>[];
  const results: RawChangeInput[] = [];

  for (const source of sources) {
    const singlePath =
      asString(source.path) ??
      asString(source.file) ??
      asString(source.filePath) ??
      asString(source.filename);
    const before =
      asString(source.before) ??
      asString(source.previous) ??
      asString(source.old) ??
      asString(source.oldText) ??
      asString(source.original);
    const after =
      asString(source.after) ??
      asString(source.new) ??
      asString(source.newText) ??
      asString(source.content) ??
      asString(source.updated);

    if (singlePath && (before !== undefined || after !== undefined)) {
      results.push({ path: singlePath, before, after });
    }

    for (const key of ["files", "changes", "edits", "results"]) {
      for (const entry of asArray(source[key])) {
        const item = asRecord(entry);
        if (!item) continue;
        const path =
          asString(item.path) ??
          asString(item.file) ??
          asString(item.filePath) ??
          asString(item.filename);
        if (!path) continue;
        results.push({
          path,
          before:
            asString(item.before) ??
            asString(item.old) ??
            asString(item.previous) ??
            asString(item.original),
          after:
            asString(item.after) ??
            asString(item.new) ??
            asString(item.updated) ??
            asString(item.content),
          kind: asString(item.kind) as ChangeKind | undefined,
        });
      }
    }
  }

  return results;
}

function parsePatchPart(part: Part): RawChangeInput[] {
  const source = asRecord(part);
  if (!source) return [];

  const filePath =
    asString(source.path) ??
    asString(source.file) ??
    asString(source.filePath) ??
    asString(source.filename);
  const before =
    asString(source.before) ??
    asString(source.old) ??
    asString(source.oldText) ??
    asString(source.previous) ??
    asString(source.original);
  const after =
    asString(source.after) ??
    asString(source.new) ??
    asString(source.newText) ??
    asString(source.content) ??
    asString(source.updated);

  const direct: RawChangeInput[] =
    filePath && (before !== undefined || after !== undefined)
      ? [{ path: filePath, before, after }]
      : [];

  const list: RawChangeInput[] = [];
  for (const key of ["files", "changes", "edits", "items"]) {
    for (const entry of asArray(source[key])) {
      const item = asRecord(entry);
      if (!item) continue;
      const path =
        asString(item.path) ??
        asString(item.file) ??
        asString(item.filePath) ??
        asString(item.filename);
      if (!path) continue;
      list.push({
        path,
        before:
          asString(item.before) ??
          asString(item.old) ??
          asString(item.previous) ??
          asString(item.original),
        after:
          asString(item.after) ??
          asString(item.new) ??
          asString(item.updated) ??
          asString(item.content),
        kind: asString(item.kind) as ChangeKind | undefined,
      });
    }
  }

  return [...direct, ...list];
}

function computeScriptDiff(before: string, after: string): ScriptDiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const maxLen = Math.max(a.length, b.length);
  const lines: ScriptDiffLine[] = [];

  let oldLine = 1;
  let newLine = 1;

  for (let i = 0; i < maxLen; i++) {
    const oldText = a[i];
    const newText = b[i];

    if (oldText === newText) {
      lines.push({
        type: "context",
        text: oldText ?? "",
        oldLineNumber: oldText !== undefined ? oldLine : null,
        newLineNumber: newText !== undefined ? newLine : null,
      });
      if (oldText !== undefined) oldLine += 1;
      if (newText !== undefined) newLine += 1;
      continue;
    }

    if (oldText !== undefined) {
      lines.push({ type: "remove", text: oldText, oldLineNumber: oldLine, newLineNumber: null });
      oldLine += 1;
    }

    if (newText !== undefined) {
      lines.push({ type: "add", text: newText, oldLineNumber: null, newLineNumber: newLine });
      newLine += 1;
    }
  }

  return lines;
}

function countDiffLines(lines: ScriptDiffLine[]) {
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const line of lines) {
    if (line.type === "add") linesAdded += 1;
    if (line.type === "remove") linesRemoved += 1;
  }

  return { linesAdded, linesRemoved };
}

function extractRawChanges(part: Part): RawChangeInput[] {
  if (part.type === "tool") {
    return parseToolPart(part);
  }
  if (part.type === "patch" || part.type === "snapshot") {
    return parsePatchPart(part);
  }
  return [];
}

function toSessionChange(change: RawChangeInput, defaultKeyPrefix: string): SessionChange {
  const before = change.before ?? "";
  const after = change.after ?? "";
  const diffLines = computeScriptDiff(before, after);
  const { linesAdded, linesRemoved } = countDiffLines(diffLines);
  const kind = inferKind(before, after, change.kind);

  return {
    key: `${defaultKeyPrefix}:${change.path}:${kind}`,
    path: change.path,
    kind,
    before,
    after,
    isScript: isScriptPath(change.path),
    linesAdded,
    linesRemoved,
    diffLines,
    sourceMessageId: change.sourceMessageId,
    sourceMessageCreatedAt: change.sourceMessageCreatedAt,
  } satisfies SessionChange;
}

export function buildSessionChanges(
  messageIds: string[],
  messagesById: Record<string, MessageWithParts>,
): SessionChange[] {
  for (let i = messageIds.length - 1; i >= 0; i -= 1) {
    const messageId = messageIds[i];
    const message = messagesById[messageId];
    if (!message || message.info.role !== "assistant") continue;

    const latestByPath = new Map<string, RawChangeInput>();
    for (const part of message.parts) {
      const rawChanges = extractRawChanges(part);
      for (const change of rawChanges) {
        const path = normalizePath(change.path);
        if (!path) continue;
        latestByPath.set(path, {
          ...change,
          path,
          sourceMessageId: messageId,
          sourceMessageCreatedAt: message.info.time?.created,
        });
      }
    }

    if (latestByPath.size === 0) continue;

    return [...latestByPath.values()]
      .map((change) => toSessionChange(change, messageId))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  return [];
}

export function buildSessionChangesFromDiffs(
  diffsByMessage: Array<{ messageId: string; createdAt?: number; diffs: FileDiff[] }>,
): SessionChange[] {
  const all: SessionChange[] = [];

  for (const item of diffsByMessage) {
    for (const diff of item.diffs) {
      const path = normalizePath(diff.file);
      if (!path) continue;
      all.push(
        toSessionChange(
          {
            path,
            before: diff.before,
            after: diff.after,
            sourceMessageId: item.messageId,
            sourceMessageCreatedAt: item.createdAt,
          },
          item.messageId,
        ),
      );
    }
  }

  return all.sort((a, b) => {
    const aTime = a.sourceMessageCreatedAt ?? 0;
    const bTime = b.sourceMessageCreatedAt ?? 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.path.localeCompare(b.path);
  });
}
