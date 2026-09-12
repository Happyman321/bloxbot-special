import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LazyStore } from "@tauri-apps/plugin-store";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetStores } from "@/__mocks__/@tauri-apps/plugin-store";
import ChatHandoff from "@/components/ChatHandoff";
import { createContinuation } from "@/lib/handoffs";

const state = vi.hoisted(() => ({
  busy: false,
  messages: ["m1"],
  selectSession: vi.fn(),
  assignSessionFolder: vi.fn(),
  sessions: [{ id: "source", title: "Inventory" }],
  client: {},
}));
vi.mock("@/hooks/useMessages", () => ({ useMessageIds: () => state.messages }));
vi.mock("@/hooks/useSessionStatuses", () => ({ useIsBusy: () => state.busy }));
vi.mock("@/hooks/useSessions", () => ({ useSessions: () => ({ data: state.sessions }) }));
vi.mock("@/providers/ActiveSessionProvider", () => ({
  useActiveSession: () => ({ selectSession: state.selectSession }),
}));
vi.mock("@/providers/OpenCodeClientProvider", () => ({
  useOpenCodeClient: () => ({ client: state.client }),
}));
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({
    sessionFolderById: { source: "Game" },
    workspaceSettingsByName: {},
    selectedModel: "provider/model",
    selectedAgent: "studio",
    selectedVariant: "high",
    assignSessionFolder: state.assignSessionFolder,
  }),
}));
vi.mock("@/lib/handoffs", async (original) => ({
  ...(await original<typeof import("@/lib/handoffs")>()),
  createContinuation: vi.fn(),
}));

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChatHandoff sessionID="source" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  __resetStores();
  vi.clearAllMocks();
  state.busy = false;
  state.messages = ["m1"];
});

describe("continuation UI", () => {
  it("opens an optional focus dialog and carries the source workspace into the fresh chat", async () => {
    vi.mocked(createContinuation).mockResolvedValue({ id: "destination" } as Awaited<
      ReturnType<typeof createContinuation>
    >);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Continue in new chat" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Focus (optional)"), {
      target: { value: "Inventory only" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create continuation" }));
    await waitFor(() => expect(state.selectSession).toHaveBeenCalledWith("destination"));
    expect(createContinuation).toHaveBeenCalledWith(
      state.client,
      expect.objectContaining({
        focus: "Inventory only",
        model: "provider/model",
        agent: "studio",
        variant: "high",
      }),
    );
    expect(state.assignSessionFolder).toHaveBeenCalledWith("destination", "Game");
  });

  it("shows the saved briefing only when explicitly opened, even if the source chat was deleted", async () => {
    await new LazyStore("bloxbot-handoffs.json").set("source", {
      version: 1,
      sourceSessionId: "deleted",
      sourceTitle: "Earlier chat",
      createdAt: 1,
      sourceMessageId: "old",
      focus: "",
      text: "PRIVATE BRIEFING: check ServerScriptService.Inventory",
    });
    mount();
    await screen.findByRole("button", { name: "View briefing" });
    expect(screen.queryByText(/PRIVATE BRIEFING/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Earlier chat" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View briefing" }));
    expect(screen.getByText(/PRIVATE BRIEFING/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables empty or busy chats", () => {
    state.busy = true;
    const view = mount();
    expect(screen.getByRole("button", { name: "Continue in new chat" })).toBeDisabled();
    view.unmount();
    state.busy = false;
    state.messages = [];
    mount();
    expect(screen.getByRole("button", { name: "Continue in new chat" })).toBeDisabled();
  });

  it("cancels preparation and keeps the original chat active", async () => {
    vi.mocked(createContinuation).mockImplementation(
      (_client, input) =>
        new Promise((_resolve, reject) => {
          input.signal.addEventListener("abort", () =>
            reject(new DOMException("cancelled", "AbortError")),
          );
        }),
    );
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Continue in new chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Create continuation" }));
    expect(screen.getByRole("button", { name: "Create continuation" })).toBeDisabled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
    expect(state.selectSession).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the focus note for retry after failure", async () => {
    vi.mocked(createContinuation).mockRejectedValue(new Error("Please retry."));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Continue in new chat" }));
    fireEvent.change(screen.getByLabelText("Focus (optional)"), { target: { value: "Inventory" } });
    fireEvent.click(screen.getByRole("button", { name: "Create continuation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please retry.");
    expect(screen.getByLabelText("Focus (optional)")).toHaveValue("Inventory");
    expect(screen.getByRole("button", { name: "Create continuation" })).toBeEnabled();
    expect(state.selectSession).not.toHaveBeenCalled();
  });
});
