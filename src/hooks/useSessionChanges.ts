import { useMemo } from "react";

import { useMessagesCache } from "@/hooks/useMessages";
import { buildSessionChanges, type SessionChange } from "@/lib/changes";

const EMPTY_CHANGES: SessionChange[] = [];

export function useSessionChanges(): SessionChange[] {
  const messagesCache = useMessagesCache();

  return useMemo(() => {
    if (messagesCache.messageIds.length === 0) return EMPTY_CHANGES;
    return buildSessionChanges(messagesCache.messageIds, messagesCache.messagesById);
  }, [messagesCache]);
}
