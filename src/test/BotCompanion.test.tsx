import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BotCompanion from "@/components/BotCompanion";
import { DEFAULT_COMPANION_PREFERENCES } from "@/lib/companion";
import { qk } from "@/lib/queryKeys";
import { THEME_BY_ID } from "@/lib/themes";
import { ActiveSessionContext } from "@/providers/ActiveSessionProvider";
import { OpenCodeClientContext } from "@/providers/OpenCodeClientProvider";
import { PreferencesContext } from "@/providers/PreferencesProvider";

function renderCompanion(queryClient: QueryClient, mode: "chat" | "image" = "chat") {
  const activeSessionIdRef = createRef<string | null>();
  activeSessionIdRef.current = "s1";
  const client = {
    session: {
      status: vi.fn().mockResolvedValue({ data: queryClient.getQueryData(qk.statuses) ?? {} }),
    },
  };
  if (queryClient.getQueryData(qk.question("s1")) === undefined) {
    queryClient.setQueryData(qk.question("s1"), null);
  }
  if (queryClient.getQueryData(qk.permission("s1")) === undefined) {
    queryClient.setQueryData(qk.permission("s1"), null);
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <OpenCodeClientContext.Provider
        value={{
          client: client as never,
          status: "ready",
          port: 4096,
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
          <PreferencesContext.Provider
            value={
              {
                theme: "paper",
                themeDefinition: THEME_BY_ID.paper,
                companion: DEFAULT_COMPANION_PREFERENCES,
              } as never
            }
          >
            <BotCompanion mode={mode} />
          </PreferencesContext.Provider>
        </ActiveSessionContext.Provider>
      </OpenCodeClientContext.Provider>
    </QueryClientProvider>,
  );
}

describe("Bot companion reactions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("greets the user with a friendly startup wave", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(qk.statuses, { s1: { type: "idle" } });
    renderCompanion(queryClient);

    expect(
      screen.queryByText(/Ready to build|make something|Good to see you/),
    ).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(450));
    expect(screen.getByText(/Ready to build|make something|Good to see you/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Make BloxBot wave" }).closest("[data-mood]"),
    ).toHaveAttribute("data-mood", "wave");

    act(() => vi.advanceTimersByTime(3_501));
    expect(
      screen.queryByText(/Ready to build|make something|Good to see you/),
    ).not.toBeInTheDocument();
  });

  it("shows Thinking and then a timed Done reaction when Chat becomes idle", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, {
      s1: { type: "busy" },
    });
    renderCompanion(queryClient);
    expect(screen.getByText("Thinking…")).toBeInTheDocument();

    await act(async () => {
      queryClient.setQueryData(qk.statuses, { s1: { type: "idle" } });
      await Promise.resolve();
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByText("Done!")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2_501));
    expect(screen.queryByText("Done!")).not.toBeInTheDocument();
  });

  it("prioritizes errors over a waiting question and expires the error bubble", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(qk.statuses, { s1: { type: "busy" } });
    queryClient.setQueryData(qk.question("s1"), { id: "q1", sessionID: "s1", questions: [] });
    queryClient.setQueryData(qk.chatError("s1"), "Provider failed");
    renderCompanion(queryClient);

    await act(async () => {});
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4_001));
    expect(screen.getByText("Needs you")).toBeInTheDocument();
  });

  it("stays ambient outside Chat and reacts when activated", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(qk.statuses, { s1: { type: "busy" } });
    renderCompanion(queryClient, "image");
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Make BloxBot wave" }));
    expect(
      screen.getByRole("button", { name: "Make BloxBot wave" }).closest("[data-mood]"),
    ).toHaveAttribute("data-mood", "wave");
  });
});
