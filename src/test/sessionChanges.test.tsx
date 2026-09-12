import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { useSessionChanges } from "@/hooks/useSessionChanges";
import { qk } from "@/lib/queryKeys";
import { type MessagesCache, sseDispatch } from "@/lib/sseDispatch";

const mock = vi.hoisted(() => ({
  cache: {} as MessagesCache,
  session: "s1",
  status: "idle",
  diff: vi.fn(),
}));
vi.mock("@/hooks/useMessages", () => ({ useMessagesCache: () => mock.cache }));
vi.mock("@/hooks/useSessionStatuses", () => ({
  useSessionStatuses: () => ({ data: { [mock.session]: { type: mock.status } } }),
}));
vi.mock("@/providers/ActiveSessionProvider", () => ({
  useActiveSession: () => ({ activeSessionId: mock.session }),
}));
vi.mock("@/providers/OpenCodeClientProvider", () => ({
  useOpenCodeClient: () => ({ client: { session: { diff: mock.diff } }, ready: true }),
}));
const captureId = "12345678-1234-1234-1234-123456789abc";
beforeEach(() => {
  mock.status = "idle";
  mock.session = "s1";
  mock.diff.mockReset().mockResolvedValue({ data: [] });
  mock.cache = {
    messageIds: ["u1", "a1"],
    messagesById: {
      u1: {
        info: { id: "u1", role: "user", time: { created: 1 } },
        parts: [{ type: "text", text: "Edit the door" }],
      },
      a1: {
        info: { id: "a1", role: "assistant", parentID: "u1" },
        parts: [
          {
            type: "tool",
            tool: "roblox-studio_multi_edit",
            state: { status: "completed", output: `[BloxBot capture: ${captureId}]` },
          },
        ],
      },
    },
  } as MessagesCache;
  vi.mocked(invoke)
    .mockReset()
    .mockResolvedValue({
      version: 1,
      scope: "studio",
      changes: [
        {
          id: "1",
          before: {
            id: "1",
            path: "game/Door",
            className: "Script",
            source: "old",
            properties: {},
          },
          after: {
            id: "1",
            path: "game/Door",
            className: "Script",
            source: "final",
            properties: {},
          },
        },
      ],
    });
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useSessionChanges(), { wrapper }), client };
}
it("publishes final Studio changes only when the request finishes, including retry pauses", async () => {
  mock.status = "busy";
  const { result, rerender } = setup();
  expect(result.current.changes).toEqual([]);
  expect(mock.diff).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
  mock.status = "retry";
  rerender();
  expect(result.current.isWorking).toBe(true);
  mock.status = "idle";
  rerender();
  await waitFor(() => expect(result.current.changes).toHaveLength(1));
  expect(result.current.changes[0]).toMatchObject({ before: "old", after: "final" });
  expect(invoke).toHaveBeenCalledWith("read_studio_capture", { captureId });
});
it("defaults to the newest request and allows selecting history without stale fallbacks", async () => {
  const { result, rerender } = setup();
  await waitFor(() => expect(result.current.changes).toHaveLength(1));
  mock.cache = {
    messageIds: [...mock.cache.messageIds, "u2"],
    messagesById: {
      ...mock.cache.messagesById,
      u2: { ...mock.cache.messagesById.u1, info: { ...mock.cache.messagesById.u1.info, id: "u2" } },
    },
  };
  rerender();
  await waitFor(() => expect(result.current.selectedTurnId).toBe("u2"));
  expect(result.current.changes).toEqual([]);
  act(() => result.current.selectTurn("u1"));
  await waitFor(() => expect(result.current.changes).toHaveLength(1));
  mock.session = "s2";
  rerender();
  expect(result.current.selectedTurnId).toBe("u2");
});
it("refreshes a late API summary when the server announces its diff", async () => {
  const { result, client } = setup();
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  mock.diff.mockResolvedValue({
    data: [
      {
        file: "config.lua",
        patch: "@@ -1 +1 @@\n-old\n+new",
        additions: 1,
        deletions: 1,
        status: "modified",
      },
    ],
  });
  act(() =>
    sseDispatch(
      client,
      { type: "session.diff", properties: { sessionID: "s1", diff: [] } },
      { current: "s1" },
    ),
  );
  await waitFor(() => expect(result.current.changes).toHaveLength(2));
  expect(client.getQueryState([...qk.changes("s1"), "u1"])?.isInvalidated).toBe(false);
});
it("keeps Studio captures visible when the local file diff API fails", async () => {
  mock.diff.mockRejectedValue(new Error("Offline"));
  const { result } = setup();
  await waitFor(() =>
    expect(result.current.warnings).toContain(
      "File changes could not be loaded. Studio captures are shown when available.",
    ),
  );
  expect(result.current.changes).toHaveLength(1);
});
