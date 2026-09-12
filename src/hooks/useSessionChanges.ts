import { useQueries, useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import { useMessagesCache } from "@/hooks/useMessages";
import { useSessionStatuses } from "@/hooks/useSessionStatuses";
import {
  buildSessionChangesFromDiffs,
  buildTurnChanges,
  getChangeTurns,
  type StudioCapture,
} from "@/lib/changes";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useSessionChanges() {
  const cache = useMessagesCache();
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();
  const { data: statuses } = useSessionStatuses();
  const status = activeSessionId ? statuses?.[activeSessionId]?.type : undefined;
  const busy = status === "busy" || status === "retry";
  const [selection, setSelection] = useState<{ session: string | null; turn: string } | null>(null);
  const turns = useMemo(() => getChangeTurns(cache.messageIds, cache.messagesById), [cache]);
  const latest = turns[turns.length - 1];
  const turn =
    selection?.session === activeSessionId
      ? (turns.find((t) => t.id === selection.turn) ?? latest)
      : latest;
  const isWorking = busy && turn?.id === latest?.id;
  const captures = useQueries({
    queries: (turn?.captureIds ?? []).map((id) => ({
      queryKey: ["studio-capture", id],
      enabled: !isWorking,
      queryFn: () => invoke<StudioCapture>("read_studio_capture", { captureId: id }),
      staleTime: Infinity,
      retry: 1,
    })),
  });
  const api = useQuery({
    queryKey: [...(activeSessionId ? qk.changes(activeSessionId) : ["changes", "noop"]), turn?.id],
    enabled: ready && !!client && !!activeSessionId && !!turn && !isWorking,
    queryFn: async () => {
      if (!client || !activeSessionId || !turn) return [];
      const result = await client.session.diff({ sessionID: activeSessionId, messageID: turn.id });
      if (result.error) throw new Error("Could not load file changes");
      return buildSessionChangesFromDiffs([
        { messageId: turn.id, createdAt: turn.createdAt, diffs: result.data ?? [] },
      ]);
    },
  });
  const records: Record<string, StudioCapture> = {};
  const warnings: string[] = [];
  captures.forEach((query, index) => {
    if (query.data && turn) {
      records[turn.captureIds[index]] = query.data;
      if (query.data.warning) warnings.push(query.data.warning);
    }
    if (query.error)
      warnings.push(`A saved Studio capture could not be loaded: ${query.error.message}`);
  });
  if (turn?.studioCalls && !turn.captureIds.length && !isWorking)
    warnings.push(
      "This request has no saved Studio snapshots. Older requests cannot recover their original object state; new requests capture changes automatically.",
    );
  if (api.error)
    warnings.push("File changes could not be loaded. Studio captures are shown when available.");
  // Publish one final comparison only after every saved capture has settled.
  const isLoading = !isWorking && (api.isLoading || captures.some((c) => c.isLoading));
  const recorded = turn && !isWorking && !isLoading ? buildTurnChanges(turn, records) : [];
  const paths = new Set(recorded.map((c) => c.path));
  const changes =
    isWorking || isLoading
      ? []
      : [...recorded, ...(api.data ?? []).filter((c) => !paths.has(c.path))];
  return {
    changes,
    turns,
    selectedTurnId: turn?.id,
    isWorking,
    isLoading,
    warnings: [...new Set(warnings)],
    selectTurn: (id: string) => setSelection({ session: activeSessionId, turn: id }),
  };
}
