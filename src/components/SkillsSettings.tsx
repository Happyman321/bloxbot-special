import { useQueryClient } from "@tanstack/react-query";
import { relaunch } from "@tauri-apps/plugin-process";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { qk } from "@/lib/queryKeys";
import {
  deleteBloxbotSkill,
  duplicateBloxbotSkill,
  getBloxbotSkill,
  type SkillDraft,
  type SkillSummary,
  saveBloxbotSkill,
  setBloxbotSkillEnabled,
  useBloxbotSkills,
} from "@/lib/skills";

const MAX_SKILL_BYTES = 128 * 1024;
const EMPTY_DRAFT: SkillDraft = { id: "", description: "", instructions: "" };
let restartRequiredState = false;
const restartListeners = new Set<() => void>();

function markSkillRestartRequired() {
  restartRequiredState = true;
  for (const listener of restartListeners) listener();
}

function useSkillRestartRequired() {
  return useSyncExternalStore(
    (listener) => {
      restartListeners.add(listener);
      return () => restartListeners.delete(listener);
    },
    () => restartRequiredState,
  );
}

export function validateSkillDraft(draft: SkillDraft): string | null {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.id) || draft.id.length > 64) {
    return "ID must be 1–64 lowercase letters or numbers separated by hyphens.";
  }
  if (draft.id.startsWith("bloxbot-")) {
    return "IDs beginning with bloxbot- are reserved for bundled skills.";
  }
  if (draft.description.length < 1 || draft.description.length > 1024) {
    return "Description must be 1–1024 characters.";
  }
  if (!draft.instructions.trim()) return "Instructions cannot be empty.";
  const estimated = new TextEncoder().encode(
    `---\nname: ${draft.id}\ndescription: ${JSON.stringify(draft.description)}\n---\n\n${draft.instructions.trim()}\n`,
  ).length;
  if (estimated > MAX_SKILL_BYTES) return "The complete SKILL.md must be at most 128 KiB.";
  return null;
}

type EditorState =
  | { mode: "closed" }
  | { mode: "create"; draft: SkillDraft }
  | { mode: "edit"; draft: SkillDraft }
  | { mode: "import"; draft: SkillDraft };

export function serializeSkillDocument(draft: SkillDraft): string {
  return `---\nname: ${draft.id}\ndescription: ${JSON.stringify(draft.description)}\n---\n\n${draft.instructions.trim()}\n`;
}

function parseYamlScalar(value: string): string {
  if (value.startsWith('"')) {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "string") throw new Error("Expected a quoted text value.");
    return parsed;
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw new Error("Unterminated single-quoted YAML value.");
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (!value) throw new Error("YAML values cannot be empty.");
  return value;
}

function parseBlockScalar(lines: string[], start: number, folded: boolean) {
  const block: string[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() !== "" && !/^\s/.test(line)) break;
    block.push(line);
    index += 1;
  }
  const indents = block
    .filter((line) => line.trim())
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const indent = indents.length ? Math.min(...indents) : 0;
  const normalized = block.map((line) => (line.trim() ? line.slice(indent) : ""));
  const value = folded
    ? normalized
        .join("\n")
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.replace(/\n/g, " "))
        .join("\n\n")
        .trim()
    : normalized.join("\n").trimEnd();
  return { value, nextIndex: index };
}

export function parseSkillDocument(contents: string): SkillDraft {
  if (new TextEncoder().encode(contents).length > MAX_SKILL_BYTES) {
    throw new Error("The SKILL.md file must be at most 128 KiB.");
  }
  const normalized = contents.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("This file is missing SKILL.md YAML frontmatter.");
  }
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing < 0) throw new Error("This file has unterminated YAML frontmatter.");

  const lines = normalized.slice(4, closing).split("\n");
  const fields = new Map<string, string>();
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) continue;
    const [, key, raw = ""] = match;
    if (key !== "name" && key !== "description") continue;
    if (fields.has(key)) throw new Error(`SKILL.md contains duplicate '${key}' fields.`);
    if (/^[|>][+-]?$/.test(raw)) {
      const block = parseBlockScalar(lines, index + 1, raw.startsWith(">"));
      fields.set(key, block.value);
      index = block.nextIndex - 1;
    } else {
      fields.set(key, parseYamlScalar(raw.trim()));
    }
  }

  const id = fields.get("name")?.trim();
  const description = fields.get("description")?.trim();
  const instructions = normalized.slice(closing + 5).trim();
  if (!id) throw new Error("SKILL.md is missing the required 'name' field.");
  if (!description) throw new Error("SKILL.md is missing the required 'description' field.");
  if (!instructions) throw new Error("SKILL.md instructions cannot be empty.");
  return { id, description, instructions };
}

export function SkillsSettings() {
  const { data: skills = [], isLoading, error } = useBloxbotSkills();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const importInputRef = useRef<HTMLInputElement>(null);
  const restartRequired = useSkillRestartRequired();
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return skills;
    return skills.filter((skill) =>
      `${skill.id} ${skill.description} ${skill.source} ${skill.source === "builtin" ? "built-in" : "custom"}`
        .toLowerCase()
        .includes(query),
    );
  }, [search, skills]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: qk.skills });
    markSkillRestartRequired();
  }

  async function editSkill(skill: SkillSummary) {
    setBusyId(skill.id);
    try {
      const document = await getBloxbotSkill(skill.id);
      setEditor({
        mode: "edit",
        draft: {
          id: document.id,
          description: document.description,
          instructions: document.instructions,
        },
      });
    } catch (cause) {
      toast.error(String(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function duplicateSkill(skill: SkillSummary) {
    const proposed = window.prompt(
      "ID for the editable copy",
      `${skill.id.replace(/^bloxbot-/, "")}-copy`,
    );
    if (!proposed) return;
    setBusyId(skill.id);
    try {
      await duplicateBloxbotSkill(skill.id, proposed.trim());
      await refresh();
      toast.success("Skill duplicated");
    } catch (cause) {
      toast.error(String(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleSkill(skill: SkillSummary) {
    setBusyId(skill.id);
    try {
      await setBloxbotSkillEnabled(skill.id, !skill.enabled);
      await refresh();
    } catch (cause) {
      toast.error(String(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function removeSkill(skill: SkillSummary) {
    if (!window.confirm(`Move “${skill.id}” to BloxBot's recoverable trash?`)) return;
    setBusyId(skill.id);
    try {
      await deleteBloxbotSkill(skill.id);
      await refresh();
      toast.success("Skill moved to trash");
    } catch (cause) {
      toast.error(String(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function exportSkill(skill: SkillSummary) {
    setBusyId(skill.id);
    try {
      const document = await getBloxbotSkill(skill.id);
      const contents = serializeSkillDocument({
        id: document.id,
        description: document.description,
        instructions: document.instructions,
      });
      const href = URL.createObjectURL(
        new Blob([contents], { type: "text/markdown;charset=utf-8" }),
      );
      const anchor = window.document.createElement("a");
      anchor.href = href;
      anchor.download = "SKILL.md";
      anchor.click();
      URL.revokeObjectURL(href);
      toast.success("Skill exported");
    } catch (cause) {
      toast.error(String(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function importSkillFile(file: File) {
    if (file.size > MAX_SKILL_BYTES) {
      toast.error("The SKILL.md file must be at most 128 KiB.");
      return;
    }
    try {
      setEditor({ mode: "import", draft: parseSkillDocument(await file.text()) });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Skills</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Focused instructions BloxBot can load only when a request needs them.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditor({ mode: "create", draft: EMPTY_DRAFT })}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            Create skill
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
          >
            Import SKILL.md
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".md,text/markdown,text/plain"
            aria-label="Import SKILL.md file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importSkillFile(file);
            }}
          />
        </div>
      </div>

      {restartRequired && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <span>Restart BloxBot to apply skill changes. Your chats are preserved.</span>
          <button type="button" onClick={() => relaunch()} className="font-medium underline">
            Restart now
          </button>
        </div>
      )}

      <div className="mb-4 rounded-lg border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
        Skills can influence actions in Roblox Studio. Only save instructions you trust.
      </div>

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search skills…"
        aria-label="Search skills"
        className="mb-3 h-8 w-full rounded-md border bg-background px-3 text-xs outline-none focus:border-foreground/30"
      />

      {isLoading && (
        <p className="py-6 text-center text-xs text-muted-foreground">Loading skills…</p>
      )}
      {error && <p className="py-6 text-center text-xs text-destructive">{String(error)}</p>}
      {!isLoading && !error && filtered.length === 0 && (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No skills match this search.
        </p>
      )}

      <div className="space-y-2">
        {filtered.map((skill) => (
          <div key={skill.id} className="rounded-lg border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-mono text-xs font-medium">{skill.id}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {skill.source === "builtin" ? "Built-in" : "Custom"}
                  </span>
                  {!skill.editable && (
                    <span className="text-[10px] text-muted-foreground">Read-only</span>
                  )}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {skill.description}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={skill.enabled}
                aria-label={`${skill.enabled ? "Disable" : "Enable"} ${skill.id}`}
                disabled={busyId === skill.id}
                onClick={() => toggleSkill(skill)}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${skill.enabled ? "bg-emerald-500" : "bg-muted"}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${skill.enabled ? "translate-x-4" : "translate-x-0.5"}`}
                />
              </button>
            </div>
            <div className="mt-3 flex gap-3 text-[11px]">
              {skill.editable && (
                <button
                  type="button"
                  disabled={busyId === skill.id}
                  onClick={() => editSkill(skill)}
                  className="hover:underline"
                >
                  Edit
                </button>
              )}
              <button
                type="button"
                disabled={busyId === skill.id}
                onClick={() => duplicateSkill(skill)}
                className="hover:underline"
              >
                Duplicate
              </button>
              <button
                type="button"
                disabled={busyId === skill.id}
                onClick={() => exportSkill(skill)}
                className="hover:underline"
              >
                Export
              </button>
              {skill.editable && (
                <button
                  type="button"
                  disabled={busyId === skill.id}
                  onClick={() => removeSkill(skill)}
                  className="text-destructive hover:underline"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-lg border p-3">
        <h3 className="text-xs font-medium">Roblox Studio skills</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Roblox-authored and creator-authored skills are managed in Roblox Assistant settings. They
          remain available automatically through Studio MCP and are not copied into BloxBot.
        </p>
      </div>

      {editor.mode !== "closed" && (
        <SkillEditor
          mode={editor.mode}
          initialDraft={editor.draft}
          existingIds={skills.map((skill) => skill.id)}
          onClose={() => setEditor({ mode: "closed" })}
          onSaved={async () => {
            setEditor({ mode: "closed" });
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function SkillEditor({
  mode,
  initialDraft,
  existingIds,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit" | "import";
  initialDraft: SkillDraft;
  existingIds: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [saving, setSaving] = useState(false);
  const validation = validateSkillDraft(draft);
  const collision =
    mode !== "edit" && existingIds.some((id) => id.toLowerCase() === draft.id.toLowerCase());
  const error = collision ? "A skill with this ID already exists." : validation;

  async function save() {
    if (error) return;
    setSaving(true);
    try {
      await saveBloxbotSkill(draft);
      await onSaved();
      toast.success(
        mode === "create" ? "Skill created" : mode === "import" ? "Skill imported" : "Skill saved",
      );
    } catch (cause) {
      toast.error(String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${mode === "create" ? "Create" : mode === "import" ? "Import" : "Edit"} skill`}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">
            {mode === "create"
              ? "Create skill"
              : mode === "import"
                ? "Review imported skill"
                : "Edit skill"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto p-4">
          <label className="block text-xs font-medium">
            ID
            <input
              value={draft.id}
              disabled={mode === "edit"}
              onChange={(event) => setDraft({ ...draft, id: event.target.value })}
              placeholder="my-skill"
              className="mt-1.5 h-8 w-full rounded-md border bg-background px-3 font-mono text-xs disabled:opacity-60"
            />
            {mode === "edit" && (
              <span className="mt-1 block font-normal text-muted-foreground">
                IDs are immutable. Duplicate the skill to rename it.
              </span>
            )}
          </label>
          <label className="block text-xs font-medium">
            Description
            <textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              maxLength={1024}
              rows={3}
              placeholder="When should BloxBot load this skill?"
              className="mt-1.5 w-full resize-y rounded-md border bg-background px-3 py-2 text-xs"
            />
            <span className="mt-1 block text-right font-normal text-muted-foreground">
              {draft.description.length}/1024
            </span>
          </label>
          <label className="block text-xs font-medium">
            Markdown instructions
            <textarea
              value={draft.instructions}
              onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
              rows={14}
              placeholder="# Workflow&#10;&#10;Explain what BloxBot should do…"
              className="mt-1.5 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs leading-relaxed"
            />
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {mode === "import"
              ? "Review every instruction before importing. Only this SKILL.md file is saved; scripts and supporting files are not included."
              : "BloxBot writes the YAML frontmatter for you. Skills can influence Studio actions, so only use trusted instructions."}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs">
            Cancel
          </button>
          <button
            type="button"
            disabled={Boolean(error) || saving}
            onClick={save}
            className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
          >
            {saving ? "Saving…" : mode === "import" ? "Import skill" : "Save skill"}
          </button>
        </div>
      </div>
    </div>
  );
}
