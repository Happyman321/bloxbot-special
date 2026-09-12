import type { Session } from "@opencode-ai/sdk/v2/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { deleteBriefing, isHandoffRunning } from "@/lib/handoffs";
import { toast } from "sonner";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useDeleteSession() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const { activeSessionId, clearSession } = useActiveSession();

  return useMutation({
    mutationFn: async (sessionID: string) => {
      if (!client) throw new Error("No client");
      if (isHandoffRunning(sessionID)) throw new Error("Cancel the handoff before deleting this chat.");
      await client.session.delete({ sessionID }, { throwOnError: true });
      try {
        await deleteBriefing(sessionID);
      } catch {
        toast.error("Chat deleted, but its local briefing could not be removed.");
      }
      return sessionID;
    },
    onSuccess: (sessionID: string) => {
      queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
        if (!prev) return prev;
        return prev.filter((s) => s.id !== sessionID);
      });

      if (activeSessionId === sessionID) {
        clearSession();
      }
    },
  });
}
