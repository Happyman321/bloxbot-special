import { memo, useEffect, useMemo, useState } from "react";

import type { ChangeKind, ChangeTurn, SessionChange } from "@/lib/changes";

interface DiffViewerProps {
  changes: SessionChange[];
  open: boolean;
  onClose: () => void;
  turns?: ChangeTurn[];
  selectedTurnId?: string;
  selectTurn?: (id: string) => void;
  isWorking?: boolean;
  isLoading?: boolean;
  warnings?: string[];
}

function KindPill({ kind }: { kind: ChangeKind }) {
  const palette =
    kind === "add"
      ? "bg-success-surface text-success-foreground"
      : kind === "delete"
        ? "bg-danger-surface text-danger-foreground"
        : "bg-info-surface text-info-foreground";
  const label = kind === "add" ? "Added" : kind === "delete" ? "Removed" : "Changed";

  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${palette}`}>
      {label}
    </span>
  );
}

function ChangeIcon({ kind }: { kind: ChangeKind }) {
  if (kind === "add") {
    return (
      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-success-surface text-success-foreground">
        +
      </span>
    );
  }
  if (kind === "delete") {
    return (
      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-danger-surface text-danger-foreground">
        -
      </span>
    );
  }
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-info-surface text-info-foreground">
      ~
    </span>
  );
}

function DiffStats({ change }: { change: SessionChange }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      {(change.isScript || change.patchOnly) && (
        <>
          <span className="text-success-foreground">+{change.linesAdded}</span>
          <span className="text-danger-foreground">-{change.linesRemoved}</span>
        </>
      )}
      {!!change.properties?.length && <span>{change.properties.length} properties</span>}
    </span>
  );
}

const ScriptDiffView = memo(function ScriptDiffView({ change }: { change: SessionChange }) {
  const [expanded, setExpanded] = useState(false);
  const visible = useMemo(() => {
    const indexes = new Set<number>();
    change.diffLines.forEach((line, index) => {
      if (line.type === "context") return;
      for (
        let i = Math.max(0, index - 3);
        i <= Math.min(change.diffLines.length - 1, index + 3);
        i++
      )
        indexes.add(i);
    });
    return indexes;
  }, [change]);
  if (!change.diffLines.length)
    return (
      <p className="text-xs text-muted-foreground">
        {change.patchOnly
          ? "No text preview is available for this file."
          : "Script source is empty."}
      </p>
    );
  if (!change.linesAdded && !change.linesRemoved)
    return <p className="text-xs text-muted-foreground">Script source unchanged.</p>;
  return (
    <div className="shrink-0 overflow-auto rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="m-2 rounded border px-2 py-1 text-xs"
      >
        {expanded ? "Show changed lines" : "Show all available lines"}
      </button>
      <table className="w-full border-collapse text-[11px]">
        <tbody>
          {change.diffLines.map((line, idx) => {
            if (!expanded && !visible.has(idx)) {
              if (idx > 0 && !visible.has(idx - 1)) return null;
              return (
                <tr key={`gap-${idx}`}>
                  <td colSpan={4} className="px-3 py-2 text-muted-foreground">
                    ⋯ unchanged lines hidden
                  </td>
                </tr>
              );
            }
            const rowClass =
              line.type === "add"
                ? "bg-success-surface"
                : line.type === "remove"
                  ? "bg-danger-surface"
                  : "bg-transparent";
            const marker = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";

            return (
              <tr key={`${change.key}-${idx}`} className={rowClass}>
                <td className="w-11 select-none border-r px-2 py-0.5 text-right text-[10px] text-muted-foreground/80">
                  {line.oldLineNumber ?? ""}
                </td>
                <td className="w-11 select-none border-r px-2 py-0.5 text-right text-[10px] text-muted-foreground/80">
                  {line.newLineNumber ?? ""}
                </td>
                <td className="w-6 select-none px-1 text-center text-muted-foreground">{marker}</td>
                <td className="px-2 py-0.5 font-mono whitespace-pre-wrap">{line.text || " "}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

const PlainDiffView = memo(function PlainDiffView({ change }: { change: SessionChange }) {
  if (change.properties)
    return (
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-left">
            <th className="p-2">Property</th>
            <th className="p-2">Before</th>
            <th className="p-2">After</th>
          </tr>
        </thead>
        <tbody>
          {change.properties.map((property) => (
            <tr key={property.name} className="border-t align-top">
              <td className="p-2 font-medium">{property.name}</td>
              <td className="p-2 whitespace-pre-wrap break-all bg-danger-surface">
                {property.before === undefined
                  ? "—"
                  : typeof property.before === "string"
                    ? property.before
                    : JSON.stringify(property.before)}
              </td>
              <td className="p-2 whitespace-pre-wrap break-all bg-success-surface">
                {property.after === undefined
                  ? "—"
                  : typeof property.after === "string"
                    ? property.after
                    : JSON.stringify(property.after)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
      <div className="min-h-0 rounded-lg border bg-card">
        <div className="border-b px-3 py-2 text-xs font-medium">Before</div>
        <pre className="h-full max-h-[60vh] overflow-auto p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
          {change.before || "(empty)"}
        </pre>
      </div>
      <div className="min-h-0 rounded-lg border bg-card">
        <div className="border-b px-3 py-2 text-xs font-medium">After</div>
        <pre className="h-full max-h-[60vh] overflow-auto p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
          {change.after || "(empty)"}
        </pre>
      </div>
    </div>
  );
});

function DiffViewer({
  changes,
  open,
  onClose,
  turns = [],
  selectedTurnId,
  selectTurn,
  isWorking,
  isLoading,
  warnings = [],
}: DiffViewerProps) {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return changes;
    return changes.filter((c) => c.path.toLowerCase().includes(needle));
  }, [changes, query]);

  const selected = filtered.find((c) => c.key === selectedKey) ?? filtered[0] ?? null;

  if (!open) return null;

  return (
    <div data-companion-blocking="true" className="fixed inset-0 z-40 flex bg-black/45">
      <button
        type="button"
        onClick={onClose}
        className="h-full flex-1 cursor-default"
        aria-label="Close changes viewer backdrop"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Changes"
        className="animate-fade-in flex h-full w-[min(1200px,96vw)] flex-col border-l bg-background shadow-2xl"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <div>
            <div className="text-xs font-semibold">Changes</div>
            <div className="text-[10px] text-muted-foreground">
              Before → final result · one entry per object
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
          >
            Close
          </button>
        </div>

        <div className="border-b px-4 py-2">
          <label className="flex items-center gap-2 text-xs">
            Request
            <select
              aria-label="Request to review"
              value={selectedTurnId ?? ""}
              onChange={(e) => selectTurn?.(e.target.value)}
              className="min-w-0 flex-1 rounded border bg-background p-1.5"
            >
              {[...turns].reverse().map((turn, index) => (
                <option key={turn.id} value={turn.id}>
                  {index === 0 ? "Latest: " : ""}
                  {turn.label}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Studio review covers scripts, instances, editable properties, attributes and tags.
            Terrain voxels and playtest runtime changes are not captured.
          </p>
        </div>
        {warnings.length > 0 && (
          <output className="border-b bg-warning-surface px-4 py-2 text-xs">
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </output>
        )}
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-44 sm:w-64 shrink-0 flex-col border-r">
            <div className="border-b p-2.5">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter scripts and objects..."
                aria-label="Filter changes"
                className="w-full rounded border bg-background px-2 py-1.5 text-xs"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-1.5">
              {filtered.length === 0 ? (
                <div className="px-2 py-3 text-[11px] text-muted-foreground">
                  No matching changes.
                </div>
              ) : (
                filtered.map((change) => {
                  const active = selected?.key === change.key;
                  return (
                    <button
                      key={change.key}
                      type="button"
                      title={change.path}
                      onClick={() => setSelectedKey(change.key)}
                      className={`mb-1 w-full rounded-md border px-2 py-1.5 text-left transition-colors ${
                        active
                          ? "border-info-border bg-info-surface"
                          : "border-transparent hover:border-stone-200 hover:bg-accent"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <ChangeIcon kind={change.kind} />
                        <span className="truncate text-[11px] font-medium">{change.path}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <KindPill kind={change.kind} />
                        <DiffStats change={change} />
                      </div>
                      {change.sourceMessageCreatedAt && (
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {new Date(change.sourceMessageCreatedAt).toLocaleString()}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-3">
            {!selected ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {isWorking
                  ? "Working… Final changes will appear when this request finishes."
                  : isLoading
                    ? "Loading changes…"
                    : query
                      ? "No matching changes."
                      : warnings.length
                        ? "No reviewable changes available. See capture details above."
                        : "No changes recorded for this request."}
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <h3 title={selected.path} className="truncate text-sm font-semibold">
                    {selected.path}
                  </h3>
                  <KindPill kind={selected.kind} />
                  <span className="text-[11px] text-muted-foreground">
                    {selected.isScript ? "Script diff" : "Asset/content diff"}
                  </span>
                </div>

                {(selected.isScript || selected.patchOnly) && (
                  <ScriptDiffView key={selected.key} change={selected} />
                )}
                {selected.properties && selected.properties.length > 0 && (
                  <div className="mt-3">
                    <PlainDiffView change={selected} />
                  </div>
                )}
                {!selected.isScript && !selected.patchOnly && !selected.properties && (
                  <PlainDiffView change={selected} />
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default memo(DiffViewer);
