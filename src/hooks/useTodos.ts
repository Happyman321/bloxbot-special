import type { Todo } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

const NOOP_KEY = ["__noop_todos__"] as const;
const EMPTY: Todo[] = [];

export function useTodos(sessionIdOverride?: string | null): Todo[] {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();
  const sessionId = sessionIdOverride ?? activeSessionId;

  const { data } = useQuery<Todo[]>({
    queryKey: sessionId ? qk.todos(sessionId) : NOOP_KEY,
    queryFn: async () => {
      if (!client || !sessionId) return [];
      const res = await client.session.todo({ sessionID: sessionId });
      return res.data ?? [];
    },
    enabled: ready && !!client && !!sessionId,
  });
  return data ?? EMPTY;
}
