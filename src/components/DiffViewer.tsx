import { memo, useMemo, useState } from "react";

import type { ChangeKind, SessionChange } from "@/lib/changes";

interface DiffViewerProps {
  changes: SessionChange[];
  open: boolean;
  onClose: () => void;
}

function KindPill({ kind }: { kind: ChangeKind }) {
  const palette =
    kind === "add"
      ? "bg-emerald-100 text-emerald-700"
      : kind === "delete"
        ? "bg-red-100 text-red-700"
        : "bg-blue-100 text-blue-700";
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
      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-emerald-500/10 text-emerald-600">
        +
      </span>
    );
  }
  if (kind === "delete") {
    return (
      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-red-500/10 text-red-600">
        -
      </span>
    );
  }
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-blue-500/10 text-blue-600">
      ~
    </span>
  );
}

function DiffStats({ change }: { change: SessionChange }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className="text-emerald-600">+{change.linesAdded}</span>
      <span className="text-red-600">-{change.linesRemoved}</span>
    </span>
  );
}

const ScriptDiffView = memo(function ScriptDiffView({ change }: { change: SessionChange }) {
  return (
    <div className="overflow-auto rounded-lg border bg-card">
      <table className="w-full border-collapse text-[11px]">
        <tbody>
          {change.diffLines.map((line, idx) => {
            const rowClass =
              line.type === "add"
                ? "bg-emerald-50/70"
                : line.type === "remove"
                  ? "bg-red-50/70"
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

function DiffViewer({ changes, open, onClose }: DiffViewerProps) {
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return changes;
    return changes.filter((c) => c.path.toLowerCase().includes(needle));
  }, [changes, query]);

  const selected = filtered.find((c) => c.path === selectedPath) ?? filtered[0] ?? null;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex bg-black/45">
      <button
        type="button"
        onClick={onClose}
        className="h-full flex-1 cursor-default"
        aria-label="Close changes viewer backdrop"
      />
      <div className="animate-fade-in flex h-full w-[min(1200px,92vw)] flex-col border-l bg-background shadow-2xl">
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <div>
            <div className="text-xs font-semibold">Changes</div>
            <div className="text-[10px] text-muted-foreground">Final net result only</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
          >
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-72 shrink-0 flex-col border-r">
            <div className="border-b p-2.5">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter files..."
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
                  const active = selected?.path === change.path;
                  return (
                    <button
                      key={change.key}
                      type="button"
                      onClick={() => setSelectedPath(change.path)}
                      className={`mb-1 w-full rounded-md border px-2 py-1.5 text-left transition-colors ${
                        active
                          ? "border-blue-300 bg-blue-50"
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
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col p-3">
            {!selected ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No changes available for this session yet.
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold">{selected.path}</h3>
                  <KindPill kind={selected.kind} />
                  <span className="text-[11px] text-muted-foreground">
                    {selected.isScript ? "Script diff" : "Asset/content diff"}
                  </span>
                </div>

                {selected.isScript ? (
                  <ScriptDiffView change={selected} />
                ) : (
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
