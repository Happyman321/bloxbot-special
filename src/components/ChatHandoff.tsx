import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useMessageIds } from "@/hooks/useMessages";
import { useIsBusy } from "@/hooks/useSessionStatuses";
import { useSessions } from "@/hooks/useSessions";
import { createContinuation, readBriefing } from "@/lib/handoffs";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

export default function ChatHandoff({ sessionID }: { sessionID: string }) {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const { selectSession } = useActiveSession();
  const { data: sessions = [] } = useSessions();
  const preferences = usePreferences();
  const busy = useIsBusy(sessionID);
  const messageIds = useMessageIds(sessionID);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [focus, setFocus] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const source = sessions.find((session) => session.id === sessionID);
  const briefing = useQuery({
    queryKey: ["handoff-briefing", sessionID],
    queryFn: () => readBriefing(sessionID, source?.metadata?.bloxbotHandoff === "ready"),
    retry: false,
  });
  const pending = !!progress;

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (open || viewing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open, viewing]);

  function close() {
    if (progress === "Opening continuation…") return;
    if (controller.current) {
      controller.current.abort();
      setProgress("Cancelling…");
    } else {
      setOpen(false);
      setViewing(false);
    }
  }

  async function create() {
    if (!client || !source || controller.current || busy) return;
    const cancellation = new AbortController();
    controller.current = cancellation;
    setError("");
    setProgress("Preparing handoff…");
    try {
      const folder = preferences.sessionFolderById[sessionID];
      const workspace = folder ? preferences.workspaceSettingsByName[folder] : undefined;
      const next = await createContinuation(client, {
        source,
        focus,
        model: preferences.selectedModel,
        agent:
          workspace?.type === "vscode"
            ? (workspace.defaultAgent ?? "vscode-workspace")
            : preferences.selectedAgent,
        variant: preferences.selectedVariant,
        signal: cancellation.signal,
        onProgress: setProgress,
        onCleanupWarning: (message) => toast.warning(message),
      });
      preferences.assignSessionFolder(next.id, folder ?? null);
      queryClient.setQueryData(qk.messages(next.id), { messageIds: [], messagesById: {} });
      queryClient.setQueryData(qk.todos(next.id), []);
      await queryClient.invalidateQueries({ queryKey: qk.sessions, exact: true });
      controller.current = null;
      setOpen(false);
      selectSession(next.id);
    } catch (failure) {
      if (cancellation.signal.aborted) setOpen(false);
      else
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not prepare the continuation. Please retry.",
        );
    } finally {
      controller.current = null;
      setProgress("");
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
      <button
        type="button"
        className="rounded-md border px-2.5 py-1 hover:bg-accent disabled:opacity-40"
        disabled={busy || pending || !messageIds.length || !source}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        Continue in new chat
      </button>
      {briefing.data && (
        <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
          Continued from
          {sessions.some((session) => session.id === briefing.data?.sourceSessionId) ? (
            <button
              type="button"
              className="max-w-48 truncate underline"
              onClick={() => selectSession(briefing.data!.sourceSessionId)}
            >
              {briefing.data.sourceTitle}
            </button>
          ) : (
            <span className="max-w-48 truncate" title="Original chat is no longer available">
              {briefing.data.sourceTitle}
            </span>
          )}
          ·{" "}
          <button type="button" className="underline" onClick={() => setViewing(true)}>
            View briefing
          </button>
        </span>
      )}
      {briefing.isError && (
        <button
          type="button"
          className="text-danger-foreground"
          onClick={() => void briefing.refetch()}
        >
          Could not load briefing · Retry
        </button>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={`handoff-title-${sessionID}`}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        className="m-auto w-[min(640px,90vw)] max-h-[85vh] overflow-y-auto rounded-xl border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/40"
      >
        <h2 id={`handoff-title-${sessionID}`} className="mb-3 text-base font-semibold">
          {viewing ? "Background briefing" : "Continue in new chat"}
        </h2>
        {viewing ? (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              Historical context from {briefing.data?.sourceTitle}. The new chat uses this in the
              background.
            </p>
            <div className="whitespace-pre-wrap break-words text-sm">{briefing.data?.text}</div>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Carry useful knowledge into a fresh chat. Your original chat stays available, and the
              new chat waits for your next assignment.
            </p>
            <label htmlFor={`handoff-focus-${sessionID}`} className="mb-1 block text-sm">
              Focus (optional)
            </label>
            <textarea
              id={`handoff-focus-${sessionID}`}
              value={focus}
              maxLength={2_000}
              disabled={pending}
              onChange={(event) => setFocus(event.target.value)}
              rows={3}
              placeholder="For example: only carry over the inventory system context"
              className="w-full resize-y rounded-md border bg-background p-2 text-sm"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              The selected model prepares a private briefing using your existing connection. Long
              chats may take a few minutes.
            </p>
            {pending && <output className="mt-3 block text-sm">{progress}</output>}
            {error && (
              <p role="alert" className="mt-3 text-sm text-danger-foreground">
                {error}
              </p>
            )}
          </>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={progress === "Opening continuation…"}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            {viewing ? "Close" : "Cancel"}
          </button>
          {!viewing && (
            <button
              type="button"
              disabled={pending || busy}
              onClick={() => void create()}
              className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-40"
            >
              Create continuation
            </button>
          )}
        </div>
      </dialog>
    </div>
  );
}
