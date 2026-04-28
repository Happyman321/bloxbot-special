import type { QuestionRequest } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";

export function useActiveQuestion(sessionId?: string | null): QuestionRequest | null {
  const { data } = useQuery<QuestionRequest | null>({
    queryKey: sessionId ? qk.question(sessionId) : qk.questions,
    enabled: false,
  });
  return data ?? null;
}
