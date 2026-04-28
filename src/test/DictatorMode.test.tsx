import type { Session, SessionStatus } from "@opencode-ai/sdk/v2/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DictatorMode from "@/components/DictatorMode";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { OpenCodeClientContext } from "@/providers/OpenCodeClientProvider";

function makeSession(id: string, title: string, parentID?: string): Session {
  return {
    id,
    title,
    parentID,
    time: { created: Date.now(), updated: Date.now() },
    version: 1,
  } as Session;
}

function makeClient() {
  return {
    session: {
      children: vi.fn().mockResolvedValue({ data: [] }),
      todo: vi.fn().mockResolvedValue({ data: [] }),
      abort: vi.fn().mockResolvedValue({}),
      promptAsync: vi.fn().mockResolvedValue({}),
      messages: vi.fn().mockResolvedValue({ data: [] }),
      status: vi.fn().mockResolvedValue({ data: {} }),
    },
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
      },
    },
  });
}

function seedDictatorState(qc: QueryClient) {
  const parent = makeSession("parent", "Dictator: Boss");
  const fromChildren = makeSession(
    "child-api",
    "@dictator-explorer Inspect Studio hierarchy",
    "parent",
  );
  const fromGlobal = makeSession("child-global", "@dictator-worker Build framework", "parent");
  const fromManaged = makeSession("child-managed", "Review final integration", "parent");

  qc.setQueryData(qk.sessions, [parent, fromGlobal, fromManaged]);
  qc.setQueryData(qk.dictatorChildren("parent"), [fromChildren]);
  qc.setQueryData(qk.statuses, {
    "child-global": { type: "busy" } as SessionStatus,
  });
  qc.setQueryData(qk.todos("parent"), [
    { content: "Plan", status: "completed" },
    { content: "Build", status: "pending" },
  ]);
  qc.setQueryData<MessagesCache>(qk.messages("parent"), {
    messageIds: [],
    messagesById: {},
  });
  qc.setQueryData<MessagesCache>(qk.messages("child-api"), {
    messageIds: [],
    messagesById: {},
  });
  qc.setQueryData<MessagesCache>(qk.messages("child-global"), {
    messageIds: [],
    messagesById: {},
  });
  qc.setQueryData<MessagesCache>(qk.messages("child-managed"), {
    messageIds: [],
    messagesById: {},
  });
  qc.setQueryData(qk.dictators, [
    {
      id: "d1",
      name: "Boss",
      parentSessionId: "parent",
      managedSessionIds: ["parent", "child-managed"],
      instructions: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settings: {
        maxWorkersPerTask: 3,
        maxConcurrentWorkers: 3,
        maxWriteWorkers: 1,
        workerAgentAllowlist: ["dictator-worker", "dictator-explorer", "dictator-reviewer"],
        approvalRequired: true,
        autoDenyOverBudget: true,
        modelKey: null,
        workerModelKey: null,
      },
    },
  ]);
}

function renderDictatorMode(client: ReturnType<typeof makeClient>, qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <OpenCodeClientContext.Provider
        value={{
          client: client as never,
          status: "ready",
          port: 4096,
          ready: true,
          initError: null,
        }}
      >
        <DictatorMode />
      </OpenCodeClientContext.Provider>
    </QueryClientProvider>,
  );
}

describe("DictatorMode", () => {
  it("shows workers from children cache, parentID sessions, and managed sessions", async () => {
    const qc = makeQueryClient();
    const client = makeClient();
    seedDictatorState(qc);

    renderDictatorMode(client, qc);

    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("Inspect Studio hierarchy")).toBeInTheDocument();
      expect(screen.getByText("Build framework")).toBeInTheDocument();
      expect(screen.getByText("Review final integration")).toBeInTheDocument();
      expect(screen.getByText("explorer · Idle · child-ap")).toBeInTheDocument();
      expect(screen.getByText("worker · Working · child-gl")).toBeInTheDocument();
    });
  });
});
