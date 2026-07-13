import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";

const NOOP_KEY = ["__noop__", "chat-error"] as const;

export function useChatError(sessionID: string | null): string | null {
  const { data } = useQuery<string | null>({
    queryKey: sessionID ? qk.chatError(sessionID) : NOOP_KEY,
    queryFn: async () => null,
    enabled: false,
  });
  return data ?? null;
}
