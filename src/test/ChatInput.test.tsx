/**
 * Component tests for ChatInput.
 *
 * Tests message submission, image attachment validation,
 * model selection, and send/abort button states.
 */

import type { Session, SessionStatus } from "@opencode-ai/sdk/v2/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatInput from "@/components/ChatInput";
import { Toaster } from "@/components/ui/sonner";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { ActiveSessionContext } from "@/providers/ActiveSessionProvider";
import { OpenCodeClientContext } from "@/providers/OpenCodeClientProvider";
import { PreferencesProvider } from "@/providers/PreferencesProvider";

// ── Helpers ──────────────────────────────────────────────────────────

function makeSession(id: string, title: string): Session {
  return {
    id,
    title,
    time: { created: Date.now(), updated: Date.now() },
    version: 1,
    parentID: "",
  } as Session;
}

function createClient(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      get: vi.fn().mockResolvedValue({ data: null }),
      create: vi.fn().mockResolvedValue({ data: null }),
      delete: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({ data: null }),
      abort: vi.fn().mockResolvedValue({}),
      messages: vi.fn().mockResolvedValue({ data: [] }),
      status: vi.fn().mockResolvedValue({ data: {} }),
      todo: vi.fn().mockResolvedValue({ data: [] }),
      promptAsync: vi.fn().mockResolvedValue({}),
      ...overrides,
    },
    provider: {
      list: vi.fn().mockResolvedValue({
        data: {
          all: [
            {
              id: "anthropic",
              name: "Anthropic",
              env: [],
              models: {
                "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
              },
            },
          ],
          connected: ["anthropic"],
          default: { anthropic: "claude-3.5-sonnet" },
        },
      }),
      oauth: { authorize: vi.fn(), callback: vi.fn() },
      auth: vi.fn().mockResolvedValue({ data: undefined }),
    },
    auth: { set: vi.fn(), remove: vi.fn() },
    question: { list: vi.fn().mockResolvedValue({ data: [] }), reply: vi.fn(), reject: vi.fn() },
    permission: { list: vi.fn().mockResolvedValue({ data: [] }), reply: vi.fn() },
    event: { subscribe: vi.fn().mockResolvedValue({ stream: null }) },
    app: { agents: vi.fn().mockResolvedValue({ data: [] }) },
    mcp: {
      status: vi.fn().mockResolvedValue({ data: {} }),
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
    instance: { dispose: vi.fn() },
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
}

function seedState(
  qc: QueryClient,
  session: Session,
  overrides?: {
    config?: Record<string, unknown>;
    messages?: MessagesCache;
  },
) {
  qc.setQueryData(qk.sessions, [session]);
  qc.setQueryData(qk.statuses, {});
  qc.setQueryData(qk.agents, []);
  qc.setQueryData(qk.providers, {
    all: [
      {
        id: "anthropic",
        name: "Anthropic",
        env: [],
        models: { "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" } },
      },
    ],
    connected: ["anthropic"],
    default: { anthropic: "claude-3.5-sonnet" },
  });
  qc.setQueryData(qk.config, {
    lastModel: "anthropic/claude-3.5-sonnet",
    hiddenModels: [],
    sessionFolderById: {},
    folderInstructionsByName: {},
    ...(overrides?.config ?? {}),
  });
  qc.setQueryData<MessagesCache>(
    qk.messages(session.id),
    overrides?.messages ?? { messageIds: [], messagesById: {} },
  );
  qc.setQueryData(qk.todos(session.id), []);
  qc.setQueryData(qk.questions, null);
  qc.setQueryData(qk.permissions, null);
}

/**
 * Wrapper that renders ChatInput with all required providers.
 * Pre-selects a session so the input is active.
 */
function TestChatInput({
  client,
  queryClient,
  sessionId = "s1",
  clientStatus = "ready",
  seedOverrides,
}: {
  client: ReturnType<typeof createClient>;
  queryClient: QueryClient;
  sessionId?: string;
  clientStatus?: string;
  seedOverrides?: {
    config?: Record<string, unknown>;
    messages?: MessagesCache;
  };
}) {
  const activeSessionIdRef = useRef<string | null>(sessionId);
  const session = makeSession(sessionId, "Test Session");
  seedState(queryClient, session, seedOverrides);

  return (
    <QueryClientProvider client={queryClient}>
      <OpenCodeClientContext.Provider
        value={{
          client: client as never,
          status: clientStatus as "waiting" | "ready" | "error",
          port: 4096,
          ready: clientStatus === "ready",
          initError: null,
        }}
      >
        <ActiveSessionContext.Provider
          value={{
            activeSessionId: sessionId,
            selectSession: async () => {},
            clearSession: () => {},
            activeSessionIdRef,
          }}
        >
          <PreferencesProvider>
            <ChatInput />
            <Toaster />
          </PreferencesProvider>
        </ActiveSessionContext.Provider>
      </OpenCodeClientContext.Provider>
    </QueryClientProvider>
  );
}

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === "get_opencode_info") return [4096, ""];
    if (command === "get_vscode_bridge_info") return { port: 59300, token: "test-token" };
    if (command === "list_roblox_studios") return [];
    return undefined;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────

describe("ChatInput", () => {
  it("renders the textarea and send button", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    const textarea = await screen.findByPlaceholderText("Describe what you want to build...");
    expect(textarea).toBeInTheDocument();
    expect(screen.getByTitle("Send")).toBeInTheDocument();
    expect(screen.getByTitle("Voice input")).toBeDisabled();
  });

  it("sends a text message on submit", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    const textarea = await screen.findByPlaceholderText("Describe what you want to build...");

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Build a game" } });
    });

    const sendBtn = screen.getByTitle("Send");
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    expect(client.session.promptAsync).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("set_active_roblox_studio", expect.anything());
    const args = client.session.promptAsync.mock.calls[0][0];
    expect(args.parts[0].text).toBe("Build a game");
    expect(args.sessionID).toBe("s1");
  });

  it("sends message on Enter key (without Shift)", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    const textarea = await screen.findByPlaceholderText("Describe what you want to build...");

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Hello" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    });

    expect(client.session.promptAsync).toHaveBeenCalled();
  });

  it("does NOT send on Shift+Enter (allows newline)", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    const textarea = await screen.findByPlaceholderText("Describe what you want to build...");

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Hello" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    });

    expect(client.session.promptAsync).not.toHaveBeenCalled();
  });

  it("disables send button when textarea is empty", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    const sendBtn = await screen.findByTitle("Send");
    expect(sendBtn).toBeDisabled();
  });

  it("clears textarea after sending", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    const textarea = (await screen.findByPlaceholderText(
      "Describe what you want to build...",
    )) as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Test message" } });
    });
    expect(textarea.value).toBe("Test message");

    await act(async () => {
      fireEvent.click(screen.getByTitle("Send"));
    });

    expect(textarea.value).toBe("");
  });

  it("does not send when text is only whitespace", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    const textarea = await screen.findByPlaceholderText("Describe what you want to build...");

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "   " } });
      fireEvent.keyDown(textarea, { key: "Enter" });
    });

    expect(client.session.promptAsync).not.toHaveBeenCalled();
  });

  it("injects workspace instructions on the first message in a chat", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(
      <TestChatInput
        client={client}
        queryClient={qc}
        seedOverrides={{
          config: {
            sessionFolderById: { s1: "my-workspace" },
            folderInstructionsByName: { "my-workspace": "Always use strict typing." },
          },
        }}
      />,
    );

    const textarea = await screen.findByPlaceholderText("Describe what you want to build...");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Build a leaderboard" } });
      fireEvent.click(screen.getByTitle("Send"));
    });

    const args = client.session.promptAsync.mock.calls[0][0];
    expect(args.parts[0].text).toContain("[Workspace Instructions: my-workspace]");
    expect(args.parts[0].text).toContain("Always use strict typing.");
    expect(args.parts[0].text).toContain("Build a leaderboard");
  });

  it("does not inject workspace instructions after the first message", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(
      <TestChatInput
        client={client}
        queryClient={qc}
        seedOverrides={{
          config: {
            sessionFolderById: { s1: "my-workspace" },
            folderInstructionsByName: { "my-workspace": "Always use strict typing." },
          },
          messages: {
            messageIds: ["existing-message-id"],
            messagesById: {},
          },
        }}
      />,
    );

    const textarea = await screen.findByPlaceholderText("Describe what you want to build...");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Add badges" } });
      fireEvent.click(screen.getByTitle("Send"));
    });

    const args = client.session.promptAsync.mock.calls[0][0];
    expect(args.parts[0].text).toBe("Add badges");
  });

  it("shows Stop button when session is busy", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    // Set busy *after* render so seedState doesn't overwrite
    act(() => {
      qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
    });

    await waitFor(() => {
      expect(screen.getByTitle("Stop")).toBeInTheDocument();
    });
  });

  it("does not send when session is busy", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    // Set busy after render
    act(() => {
      qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
    });

    const textarea = await screen.findByPlaceholderText("Describe what you want to build...");

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Hello" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
    });

    expect(client.session.promptAsync).not.toHaveBeenCalled();
  });

  it("shows model selector with current model display", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    // Should show the model name (the part after the slash)
    await waitFor(() => {
      expect(screen.getByText("claude-3.5-sonnet")).toBeInTheDocument();
    });
  });

  it("shows Shift+Enter hint", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    await waitFor(() => {
      expect(screen.getByText("Shift+Enter for new line")).toBeInTheDocument();
    });
  });

  it("has an attach images button", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    expect(await screen.findByTitle("Attach images")).toBeInTheDocument();
  });

  it("detects studio IDs from the backend command and renders them in picker", async () => {
    const client = createClient();
    vi.mocked(invoke).mockResolvedValueOnce([{ id: "12345", name: "Main Place", active: true }]);
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    fireEvent.click(await screen.findByTitle("Pick a Roblox Studio instance"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("list_roblox_studios");
      expect(screen.getByText("Main Place")).toBeInTheDocument();
      expect(screen.getByText("12345")).toBeInTheDocument();
      expect(screen.getByText("active")).toBeInTheDocument();
    });
  });

  it("reconnects the Studio MCP server and refreshes detected studios", async () => {
    const client = createClient();
    vi.mocked(invoke)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "67890", name: "Recovered Place", active: false }]);
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    fireEvent.click(await screen.findByTitle("Pick a Roblox Studio instance"));
    fireEvent.click(await screen.findByText("Reconnect to Studio"));

    await waitFor(() => {
      expect(client.mcp.disconnect).toHaveBeenCalledWith({ name: "roblox-studio" });
      expect(client.mcp.connect).toHaveBeenCalledWith({ name: "roblox-studio" });
      expect(screen.getByText("Recovered Place")).toBeInTheDocument();
      expect(screen.getByText("67890")).toBeInTheDocument();
    });
  });

  it("shows the empty state when the backend command returns no active studios", async () => {
    const client = createClient();
    vi.mocked(invoke).mockResolvedValueOnce([]);
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    fireEvent.click(await screen.findByTitle("Pick a Roblox Studio instance"));

    await waitFor(() => {
      expect(screen.getByText("No open Roblox Studio sessions found.")).toBeInTheDocument();
    });
  });

  it("keeps Auto available and shows the bridge error when Studio detection fails", async () => {
    const client = createClient();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Studio MCP unavailable"));
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    fireEvent.click(await screen.findByTitle("Pick a Roblox Studio instance"));

    await waitFor(() => {
      expect(screen.getAllByText("Auto detect")).toHaveLength(2);
      expect(
        screen.getByText(/Picker bridge unavailable: Studio MCP unavailable/),
      ).toBeInTheDocument();
    });
  });

  it("activates an explicit Studio before updating the picker selection", async () => {
    const client = createClient();
    vi.mocked(invoke)
      .mockResolvedValueOnce([{ id: "studio-1", name: "Chosen Place", active: false }])
      .mockResolvedValueOnce(undefined);
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    fireEvent.click(await screen.findByTitle("Pick a Roblox Studio instance"));
    fireEvent.click(await screen.findByText("Chosen Place"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_active_roblox_studio", {
        studioId: "studio-1",
      });
      expect(screen.getByText("Chosen Place")).toBeInTheDocument();
    });
  });

  it("reasserts an explicit Studio before sending without asking the agent to select it", async () => {
    const client = createClient();
    vi.mocked(invoke)
      .mockResolvedValueOnce([{ id: "studio-1", name: "Chosen Place", active: false }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);
    fireEvent.click(await screen.findByTitle("Pick a Roblox Studio instance"));
    fireEvent.click(await screen.findByText("Chosen Place"));
    await waitFor(() => expect(screen.getByText("Chosen Place")).toBeInTheDocument());

    const textarea = await screen.findByPlaceholderText("Describe what you want to build...");
    fireEvent.change(textarea, { target: { value: "Inspect Workspace" } });
    fireEvent.click(screen.getByTitle("Send"));

    await waitFor(() => expect(client.session.promptAsync).toHaveBeenCalled());
    expect(invoke).toHaveBeenLastCalledWith("set_active_roblox_studio", {
      studioId: "studio-1",
    });
    const args = client.session.promptAsync.mock.calls[0][0];
    expect(args.parts[0].text).toContain("[Studio Target Already Active: studio-1]");
    expect(args.parts[0].text).toContain("Do not list Studios or call set_active_studio");
  });

  it("returns to Auto mode and best-effort reconnects the Studio MCP server", async () => {
    const client = createClient();
    vi.mocked(invoke)
      .mockResolvedValueOnce([{ id: "studio-1", name: "Chosen Place", active: false }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: "studio-1", name: "Chosen Place", active: true }]);
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);
    fireEvent.click(await screen.findByTitle("Pick a Roblox Studio instance"));
    fireEvent.click(await screen.findByText("Chosen Place"));
    await waitFor(() => expect(screen.getByText("Chosen Place")).toBeInTheDocument());

    fireEvent.click(screen.getByTitle("Pick a Roblox Studio instance"));
    const autoOptions = await screen.findAllByText("Auto detect");
    fireEvent.click(autoOptions[autoOptions.length - 1]);

    await waitFor(() => {
      expect(client.mcp.disconnect).toHaveBeenCalledWith({ name: "roblox-studio" });
      expect(client.mcp.connect).toHaveBeenCalledWith({ name: "roblox-studio" });
      expect(screen.getByTitle("Pick a Roblox Studio instance")).toHaveTextContent("Auto detect");
    });
  });

  it("does not send when explicit Studio preflight fails", async () => {
    const client = createClient();
    vi.mocked(invoke)
      .mockResolvedValueOnce([{ id: "studio-1", name: "Chosen Place", active: false }])
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Studio disconnected"));
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);
    fireEvent.click(await screen.findByTitle("Pick a Roblox Studio instance"));
    fireEvent.click(await screen.findByText("Chosen Place"));
    await waitFor(() => expect(screen.getByText("Chosen Place")).toBeInTheDocument());

    const textarea = await screen.findByPlaceholderText("Describe what you want to build...");
    fireEvent.change(textarea, { target: { value: "Inspect Workspace" } });
    fireEvent.click(screen.getByTitle("Send"));

    await waitFor(() => {
      expect(client.session.promptAsync).not.toHaveBeenCalled();
      expect(qc.getQueryData(qk.chatError("s1"))).toContain("switch to Auto detect");
    });
  });
});
