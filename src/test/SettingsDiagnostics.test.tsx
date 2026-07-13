import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "@/components/Settings";
import { Toaster } from "@/components/ui/sonner";
import { qk } from "@/lib/queryKeys";
import { recordPromptStart, resetDiagnosticsForTest } from "@/lib/diagnostics";
import { ActiveSessionContext } from "@/providers/ActiveSessionProvider";
import { OpenCodeClientContext } from "@/providers/OpenCodeClientProvider";
import { PreferencesProvider } from "@/providers/PreferencesProvider";

vi.mock("@tauri-apps/api/app");
vi.mock("@tauri-apps/plugin-opener");
vi.mock("@tauri-apps/plugin-process");

function createClient() {
  return {
    session: {
      status: vi.fn().mockResolvedValue({ data: {} }),
    },
    provider: {
      list: vi.fn().mockResolvedValue({
        data: {
          all: [
            {
              id: "openai",
              name: "OpenAI",
              env: [],
              models: { "gpt-5": { id: "gpt-5", name: "GPT-5" } },
            },
          ],
          connected: ["openai"],
          default: { openai: "gpt-5" },
        },
      }),
      auth: vi.fn().mockResolvedValue({ data: { openai: [{ type: "oauth" }] } }),
      oauth: { authorize: vi.fn(), callback: vi.fn() },
    },
    auth: { set: vi.fn(), remove: vi.fn() },
    app: { agents: vi.fn().mockResolvedValue({ data: [] }) },
    instance: { dispose: vi.fn() },
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
}

function seedState(queryClient: QueryClient) {
  queryClient.setQueryData(qk.providers, {
    all: [
      {
        id: "openai",
        name: "OpenAI",
        env: [],
        models: { "gpt-5": { id: "gpt-5", name: "GPT-5" } },
      },
    ],
    connected: ["openai"],
    default: { openai: "gpt-5" },
    authMethods: { openai: [{ type: "oauth" }] },
  });
  queryClient.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
  queryClient.setQueryData(qk.agents, []);
  queryClient.setQueryData(qk.config, {
    lastModel: "openai/gpt-5",
    hiddenModels: [],
    folders: [],
    sessionFolderById: {},
    activeWorkspace: "all",
    folderOpenState: {},
    folderInstructionsByName: {},
  });
}

function TestSettings({
  client,
  queryClient,
}: {
  client: ReturnType<typeof createClient>;
  queryClient: QueryClient;
}) {
  const activeSessionIdRef = useRef<string | null>("s1");
  seedState(queryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <OpenCodeClientContext.Provider
        value={{
          client: client as never,
          status: "ready",
          port: 59200,
          ready: true,
          initError: null,
        }}
      >
        <ActiveSessionContext.Provider
          value={{
            activeSessionId: "s1",
            selectSession: async () => {},
            clearSession: () => {},
            activeSessionIdRef,
          }}
        >
          <PreferencesProvider>
            <Settings onClose={() => {}} />
            <Toaster />
          </PreferencesProvider>
        </ActiveSessionContext.Provider>
      </OpenCodeClientContext.Provider>
    </QueryClientProvider>
  );
}

describe("Settings diagnostics", () => {
  beforeEach(() => {
    resetDiagnosticsForTest();
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("copies a redacted diagnostics report", async () => {
    const client = createClient();
    const queryClient = createQueryClient();
    recordPromptStart({
      sessionID: "s1",
      providerID: "openai",
      modelID: "gpt-5",
      now: new Date(Date.now() - 180_000),
    });

    render(<TestSettings client={client} queryClient={queryClient} />);

    fireEvent.click(await screen.findByText("Copy diagnostics"));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
    const report = JSON.parse(copied);
    expect(report.activeSession).toMatchObject({ id: "s1", cachedStatusType: "busy" });
    expect(report.provider).toMatchObject({
      selectedModel: "openai/gpt-5",
      selectedProvider: "openai",
      connectedProviders: ["openai"],
      openaiAuthMethodTypes: ["oauth"],
    });
    expect(report.redaction.includesSecrets).toBe(false);
    expect(copied).not.toContain("sk-");
    expect(copied).not.toContain("Build a game");
  });
});
