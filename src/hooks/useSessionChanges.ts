import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useMessagesCache } from "@/hooks/useMessages";
import {
  buildSessionChanges,
  buildSessionChangesFromDiffs,
  type SessionChange,
} from "@/lib/changes";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

const EMPTY_CHANGES: SessionChange[] = [];

export function useSessionChanges(): SessionChange[] {
  const messagesCache = useMessagesCache();
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();

  const fallbackChanges = useMemo(() => {
    if (messagesCache.messageIds.length === 0) return EMPTY_CHANGES;
    return buildSessionChanges(messagesCache.messageIds, messagesCache.messagesById);
  }, [messagesCache]);

  const { data: apiChanges } = useQuery<SessionChange[]>({
    queryKey: activeSessionId ? qk.changes(activeSessionId) : ["changes", "noop"],
    enabled:
      ready &&
      !!client &&
      !!activeSessionId &&
      messagesCache.messageIds.length > 0 &&
      typeof client.session.diff === "function",
    queryFn: async () => {
      if (!client || !activeSessionId) return EMPTY_CHANGES;

      const userMessages = messagesCache.messageIds
        .map((messageId) => messagesCache.messagesById[messageId])
        .filter((msg): msg is NonNullable<typeof msg> => !!msg)
        .filter((msg) => msg.info.role === "user");

      if (userMessages.length === 0) return EMPTY_CHANGES;

      const diffsByMessage = await Promise.all(
        userMessages.map(async (msg) => {
          try {
            const res = await client.session.diff({
              sessionID: activeSessionId,
              messageID: msg.info.id,
            });
            return {
              messageId: msg.info.id,
              createdAt: msg.info.time.created,
              diffs: res.data ?? [],
            };
          } catch {
            return {
              messageId: msg.info.id,
              createdAt: msg.info.time.created,
              diffs: [],
            };
          }
        }),
      );

      return buildSessionChangesFromDiffs(diffsByMessage);
    },
  });

  return apiChanges && apiChanges.length > 0 ? apiChanges : fallbackChanges;
}
