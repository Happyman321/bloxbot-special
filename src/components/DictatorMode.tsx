import type { Session } from "@opencode-ai/sdk/v2/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useState } from "react";

import ChatMessages from "@/components/ChatMessages";
import {
  useAbortDictatorSession,
  useApproveDictatorPlan,
  useCreateDictator,
  useDeleteDictator,
  useDictators,
  useDictatorTasks,
  useDictatorWorkerSessions,
  useRefreshDictatorChildren,
  useSendDictatorMessage,
  useUpdateDictator,
} from "@/hooks/useDictators";
import { useSessionMessagesCache } from "@/hooks/useMessages";
import { useSessionStatuses } from "@/hooks/useSessionStatuses";
import { useTodos } from "@/hooks/useTodos";
import type { DictatorProfile } from "@/lib/dictators";
import {
  type DictatorWorkerRole,
  deriveWorkerDisplayName,
  getDictatorWorkerRole,
} from "@/lib/dictatorWorkers";
import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

function DictatorFace({ active }: { active?: boolean }) {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={active ? "bloxbot-dictator" : "bloxbot-face-think"}
      aria-hidden="true"
    >
      <rect x="32" y="32" width="448" height="448" rx="112" fill="currentColor" />
      <rect
        className="bloxbot-eye"
        x="144"
        y="176"
        width="72"
        height="72"
        rx="24"
        fill="var(--background)"
      />
      <rect
        className="bloxbot-eye"
        x="296"
        y="176"
        width="72"
        height="72"
        rx="24"
        fill="var(--background)"
      />
      <path
        d="M168 328C168 328 204.8 376 256 376C307.2 376 344 328 344 328"
        stroke="var(--background)"
        strokeWidth="32"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WorkerTranscript({ sessionId }: { sessionId: string }) {
  const cache = useSessionMessagesCache(sessionId);
  const items = cache.messageIds
    .map((id) => cache.messagesById[id])
    .filter((message): message is NonNullable<typeof message> => !!message)
    .slice(-6);

  if (items.length === 0) {
    return <div className="px-2 py-2 text-[11px] text-muted-foreground">No transcript yet.</div>;
  }

  return (
    <div className="max-h-52 space-y-2 overflow-y-auto px-2 py-2">
      {items.map((message) => {
        const text = message.parts
          .filter((part) => part.type === "text")
          .map((part) => ("text" in part ? part.text : ""))
          .join("\n")
          .trim();
        return (
          <div key={message.info.id} className="text-[11px]">
            <div className="mb-0.5 font-semibold capitalize text-muted-foreground">
              {message.info.role}
            </div>
            <div className="whitespace-pre-wrap rounded border bg-background px-2 py-1.5">
              {text || "..."}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const WorkerRow = memo(function WorkerRow({
  session,
  status,
  fallbackDescription,
  overBudget,
  onAbort,
}: {
  session: Session;
  status?: { type: string };
  fallbackDescription?: string;
  overBudget?: boolean;
  onAbort: (sessionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const cache = useSessionMessagesCache(session.id);
  const busy = status?.type === "busy";
  const role = getDictatorWorkerRole(session);
  const displayName = deriveWorkerDisplayName(session, cache, fallbackDescription);

  return (
    <div className={`rounded-md border bg-card ${overBudget ? "border-destructive/60" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
      >
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{displayName}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {role} · {busy ? "Working" : "Idle"} · {session.id.slice(0, 8)}
            {overBudget && <span className="ml-1 text-destructive">over budget</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {busy && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />}
          <span className="text-[10px] text-muted-foreground">{open ? "Hide" : "Open"}</span>
        </div>
      </button>
      {open && (
        <div className="border-t">
          <WorkerTranscript sessionId={session.id} />
          {busy && (
            <div className="border-t px-2 py-2">
              <button
                type="button"
                onClick={() => onAbort(session.id)}
                className="h-7 rounded border px-2 text-[10px] font-medium text-destructive hover:bg-accent"
              >
                Stop worker
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function DictatorInput({ profile }: { profile: DictatorProfile }) {
  const [text, setText] = useState("");
  const send = useSendDictatorMessage();
  const canSend = text.trim().length > 0 && !send.isPending;

  function submit() {
    if (!canSend) return;
    send.mutate({ profile, text });
    setText("");
  }

  return (
    <div className="shrink-0 border-t bg-card px-4 py-3">
      <div className="rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring/20">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Give The Dictator high-level instructions..."
          rows={2}
          className="max-h-40 min-h-16 w-full resize-none bg-transparent px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none"
        />
        <div className="flex items-center justify-between border-t px-3 py-2">
          <span className="text-[10px] text-muted-foreground">
            Plans first. Workers start after approval.
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className="h-7 rounded-md bg-foreground px-3 text-[11px] font-medium text-background transition-opacity disabled:opacity-30"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function DictatorSettingsPanel({ profile }: { profile: DictatorProfile }) {
  const update = useUpdateDictator();
  const [draft, setDraft] = useState(profile);

  useEffect(() => setDraft(profile), [profile]);

  function setNumber(
    key: "maxWorkersPerTask" | "maxConcurrentWorkers" | "maxWriteWorkers",
    value: string,
  ) {
    const parsed = Math.max(1, Math.min(12, Number.parseInt(value, 10) || 1));
    setDraft((prev) => ({
      ...prev,
      settings: { ...prev.settings, [key]: parsed },
    }));
  }

  function save() {
    update.mutate(draft);
  }

  return (
    <div className="space-y-3 border-t px-3 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Dictator settings
      </div>
      <label className="block text-[11px]">
        <span className="text-muted-foreground">Standing instructions</span>
        <textarea
          value={draft.instructions}
          onChange={(event) => setDraft((prev) => ({ ...prev, instructions: event.target.value }))}
          className="mt-1 min-h-20 w-full resize-y rounded-md border bg-background px-2 py-1.5 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-[11px]">
          <span className="text-muted-foreground">Per task</span>
          <input
            type="number"
            min={1}
            max={12}
            value={draft.settings.maxWorkersPerTask}
            onChange={(event) => setNumber("maxWorkersPerTask", event.target.value)}
            className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs"
          />
        </label>
        <label className="text-[11px]">
          <span className="text-muted-foreground">Concurrent</span>
          <input
            type="number"
            min={1}
            max={12}
            value={draft.settings.maxConcurrentWorkers}
            onChange={(event) => setNumber("maxConcurrentWorkers", event.target.value)}
            className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs"
          />
        </label>
        <label className="text-[11px]">
          <span className="text-muted-foreground">Writers</span>
          <input
            type="number"
            min={1}
            max={12}
            value={draft.settings.maxWriteWorkers}
            onChange={(event) => setNumber("maxWriteWorkers", event.target.value)}
            className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs"
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={draft.settings.approvalRequired}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              settings: { ...prev.settings, approvalRequired: event.target.checked },
            }))
          }
        />
        Require approval before worker dispatch
      </label>
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={draft.settings.autoDenyOverBudget}
          onChange={(event) =>
            setDraft((prev) => ({
              ...prev,
              settings: { ...prev.settings, autoDenyOverBudget: event.target.checked },
            }))
          }
        />
        Auto-deny work over configured budget
      </label>
      <button
        type="button"
        onClick={save}
        className="h-8 rounded-md border px-3 text-[11px] font-medium hover:bg-accent"
      >
        Save settings
      </button>
    </div>
  );
}

function extractTaskDescriptions(cache: ReturnType<typeof useSessionMessagesCache>): string[] {
  const descriptions: string[] = [];
  for (const messageId of cache.messageIds) {
    const message = cache.messagesById[messageId];
    if (!message) continue;
    for (const part of message.parts) {
      if (part.type !== "tool") continue;
      const record = part as unknown as {
        tool?: string;
        state?: { input?: Record<string, unknown> };
      };
      if (record.tool !== "task") continue;
      const description = record.state?.input?.description;
      if (typeof description === "string" && description.trim()) {
        descriptions.push(description.trim());
      }
    }
  }
  return descriptions;
}

function roleRank(role: DictatorWorkerRole): number {
  if (role === "explorer") return 0;
  if (role === "worker") return 1;
  return 2;
}

function DictatorDashboard({ profile }: { profile: DictatorProfile }) {
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const refreshChildren = useRefreshDictatorChildren();
  const approvePlan = useApproveDictatorPlan();
  const abort = useAbortDictatorSession();
  const todos = useTodos(profile.parentSessionId);
  const tasks = useDictatorTasks(profile.id).data ?? [];
  const { data: statuses = {} } = useSessionStatuses();
  const parentMessages = useSessionMessagesCache(profile.parentSessionId);
  const workers = useDictatorWorkerSessions(profile);

  useQuery<Session[]>({
    queryKey: qk.dictatorChildren(profile.parentSessionId),
    queryFn: async () => {
      if (!client || !ready) return [];
      const res = await client.session.children({ sessionID: profile.parentSessionId });
      return res.data ?? [];
    },
    enabled: ready && !!client,
  });

  useEffect(() => {
    if (!profile.parentSessionId) return;
    const existing = queryClient.getQueryData<Session[]>(
      qk.dictatorChildren(profile.parentSessionId),
    );
    if (!existing) refreshChildren.mutate(profile);
  }, [profile, queryClient, refreshChildren]);

  const sortedWorkers = useMemo(
    () =>
      [...workers].sort((a, b) => {
        const roleDiff = roleRank(getDictatorWorkerRole(a)) - roleRank(getDictatorWorkerRole(b));
        if (roleDiff !== 0) return roleDiff;
        return b.time.updated - a.time.updated;
      }),
    [workers],
  );
  const taskDescriptions = useMemo(() => extractTaskDescriptions(parentMessages), [parentMessages]);
  const overBudgetWorkerIds = useMemo(() => {
    const ids = new Set<string>();
    sortedWorkers.forEach((worker, index) => {
      if (index >= profile.settings.maxWorkersPerTask) ids.add(worker.id);
    });
    return ids;
  }, [profile.settings.maxWorkersPerTask, sortedWorkers]);
  const completedTodos = todos.filter((todo) => todo.status === "completed").length;
  const busyWorkers = sortedWorkers.filter((child) => statuses[child.id]?.type === "busy").length;

  useEffect(() => {
    if (!profile.settings.autoDenyOverBudget || overBudgetWorkerIds.size === 0) return;
    for (const workerId of overBudgetWorkerIds) {
      if (statuses[workerId]?.type === "busy") {
        abort.mutate(workerId);
      }
    }
  }, [abort, overBudgetWorkerIds, profile.settings.autoDenyOverBudget, statuses]);

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l bg-card">
      <div className="border-b px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Command
            </div>
            <div className="mt-1 text-xs font-medium">{profile.name}</div>
          </div>
          <DictatorFace active={statuses[profile.parentSessionId]?.type === "busy"} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border bg-background px-2 py-1.5">
            <div className="text-sm font-semibold">{sortedWorkers.length}</div>
            <div className="text-[9px] text-muted-foreground">Workers</div>
          </div>
          <div className="rounded-md border bg-background px-2 py-1.5">
            <div className="text-sm font-semibold">{busyWorkers}</div>
            <div className="text-[9px] text-muted-foreground">Active</div>
          </div>
          <div className="rounded-md border bg-background px-2 py-1.5">
            <div className="text-sm font-semibold">
              {completedTodos}/{todos.length}
            </div>
            <div className="text-[9px] text-muted-foreground">Tasks</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => approvePlan.mutate(profile)}
          disabled={approvePlan.isPending}
          className="mt-3 h-8 w-full rounded-md bg-foreground px-3 text-[11px] font-medium text-background transition-opacity disabled:opacity-50"
        >
          Approve Plan
        </button>
        <button
          type="button"
          onClick={() => refreshChildren.mutate(profile)}
          className="mt-2 h-8 w-full rounded-md border px-3 text-[11px] font-medium hover:bg-accent"
        >
          Refresh Workers
        </button>
      </div>

      <div className="border-b px-3 py-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Limits
        </div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <div>Workers per task: {profile.settings.maxWorkersPerTask}</div>
          <div>Concurrent workers: {profile.settings.maxConcurrentWorkers}</div>
          <div>Write workers: {profile.settings.maxWriteWorkers}</div>
          <div>Approval: {profile.settings.approvalRequired ? "required" : "manual override"}</div>
        </div>
      </div>

      <div className="border-b px-3 py-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Parent tasks
        </div>
        {todos.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">No task list yet.</div>
        ) : (
          <div className="space-y-1">
            {todos.map((todo, index) => (
              <div
                key={`${todo.content}-${index}`}
                className="flex items-start gap-1.5 text-[11px]"
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                <span
                  className={
                    todo.status === "completed" ? "text-muted-foreground line-through" : ""
                  }
                >
                  {todo.content}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-b px-3 py-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Approvals
        </div>
        {tasks.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">No approved plans yet.</div>
        ) : (
          <div className="space-y-1">
            {tasks.map((task) => (
              <div key={task.id} className="rounded border bg-background px-2 py-1.5 text-[11px]">
                <div className="font-medium">{task.title}</div>
                <div className="text-[10px] text-muted-foreground">{task.status}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Worker chats
          </div>
          {refreshChildren.isPending && (
            <span className="text-[10px] text-muted-foreground">Syncing</span>
          )}
        </div>
        {sortedWorkers.length === 0 ? (
          <div className="rounded-md border bg-background px-3 py-4 text-center text-[11px] text-muted-foreground">
            Workers will appear here after the Dictator dispatches subagents.
          </div>
        ) : (
          <div className="space-y-2">
            {sortedWorkers.map((child, index) => (
              <WorkerRow
                key={child.id}
                session={child}
                status={statuses[child.id]}
                fallbackDescription={taskDescriptions[index]}
                overBudget={overBudgetWorkerIds.has(child.id)}
                onAbort={(sessionId) => abort.mutate(sessionId)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function DictatorMode() {
  const { ready, initError } = useOpenCodeClient();
  const { data: dictators = [] } = useDictators();
  const createDictator = useCreateDictator();
  const updateDictator = useUpdateDictator();
  const deleteDictator = useDeleteDictator();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (selectedId && dictators.some((dictator) => dictator.id === selectedId)) return;
    setSelectedId(dictators[0]?.id ?? null);
  }, [dictators, selectedId]);

  const selected = useMemo(
    () => dictators.find((dictator) => dictator.id === selectedId) ?? null,
    [dictators, selectedId],
  );

  function handleCreate() {
    const name = window.prompt("Dictator name", "The Dictator");
    if (!name) return;
    createDictator.mutate(name, {
      onSuccess: (profile) => setSelectedId(profile.id),
    });
  }

  function handleRename(profile: DictatorProfile) {
    const name = window.prompt("Rename Dictator", profile.name)?.trim();
    if (!name) return;
    updateDictator.mutate({ ...profile, name });
  }

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        {initError ?? "Initializing Dictator Mode..."}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-card">
        <div className="flex h-10 items-center justify-between border-b px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Dictators
          </span>
          <button
            type="button"
            onClick={handleCreate}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            title="New Dictator"
          >
            +
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {dictators.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <DictatorFace />
              <div className="mt-3 text-xs font-medium">No Dictators yet.</div>
              <button
                type="button"
                onClick={handleCreate}
                className="mt-3 h-8 rounded-md bg-foreground px-3 text-[11px] font-medium text-background"
              >
                Create Dictator
              </button>
            </div>
          ) : (
            dictators.map((dictator) => {
              const active = dictator.id === selectedId;
              return (
                <div key={dictator.id} className="group relative mx-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(dictator.id);
                      setShowSettings(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${
                      active
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    }`}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {dictator.name}
                    </span>
                  </button>
                  <div className="absolute inset-y-0 right-1 hidden items-center gap-0.5 group-hover:flex">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRename(dictator);
                      }}
                      className="h-5 rounded px-1 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteDictator.mutate(dictator.id);
                      }}
                      className="h-5 rounded px-1 text-[10px] text-muted-foreground hover:text-destructive"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {selected && (
          <div className="border-t p-3">
            <button
              type="button"
              onClick={() => setShowSettings((value) => !value)}
              className="h-8 w-full rounded-md border text-[11px] font-medium hover:bg-accent"
            >
              {showSettings ? "Hide Settings" : "Settings"}
            </button>
          </div>
        )}
      </aside>

      {!selected ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <DictatorFace active />
          <h2 className="mt-4 font-serif text-2xl italic text-foreground">Create a Dictator</h2>
          <p className="mt-2 max-w-md text-xs text-muted-foreground">
            Give high-level feature requests, approve the plan, then track the worker chats here.
          </p>
        </div>
      ) : (
        <>
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center justify-between border-b px-4">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-xs font-semibold">{selected.name}</h3>
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-medium text-secondary-foreground">
                  Dictator
                </span>
              </div>
            </div>
            {showSettings ? (
              <DictatorSettingsPanel profile={selected} />
            ) : (
              <>
                <ChatMessages sessionId={selected.parentSessionId} />
                <DictatorInput profile={selected} />
              </>
            )}
          </section>
          <DictatorDashboard profile={selected} />
        </>
      )}
    </div>
  );
}

export default DictatorMode;
