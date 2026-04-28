import type { PermissionRequest } from "@opencode-ai/sdk/v2/client";
import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";

export function useActivePermission(sessionId?: string | null): PermissionRequest | null {
  const { data } = useQuery<PermissionRequest | null>({
    queryKey: sessionId ? qk.permission(sessionId) : qk.permissions,
    enabled: false,
  });
  return data ?? null;
}
