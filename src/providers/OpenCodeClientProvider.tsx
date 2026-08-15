import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import StartupCompanionScreen from "@/components/StartupCompanionScreen";
import { DEFAULT_COMPANION_PREFERENCES } from "@/lib/companion";
import { type AppConfig, loadConfig } from "@/lib/config";
import { recordSseConnected, recordSseFailure, recordSseReconnecting } from "@/lib/diagnostics";
import { qk } from "@/lib/queryKeys";
import { sseDispatch } from "@/lib/sseDispatch";
import { applyTheme, DEFAULT_THEME_ID, THEME_BY_ID } from "@/lib/themes";

const SSE_RECONNECT_DELAY = 3000;
const SSE_FAILURE_THRESHOLD = 3;
const STARTUP_REQUEST_TIMEOUT = 3000;
const PREFETCH_TIMEOUT = 4000;

type AppStatus = "waiting" | "ready" | "error";

interface OpenCodeClientContextValue {
  client: OpencodeClient | null;
  status: AppStatus;
  port: number;
  ready: boolean;
  initError: string | null;
  startupTransitionComplete?: boolean;
}

export const OpenCodeClientContext = createContext<OpenCodeClientContextValue>({
  client: null,
  status: "waiting",
  port: 0,
  ready: false,
  initError: null,
  startupTransitionComplete: false,
});

export function useOpenCodeClient() {
  return useContext(OpenCodeClientContext);
}

export function OpenCodeClientProvider({
  children,
  activeSessionIdRef,
}: {
  children: ReactNode;
  activeSessionIdRef: React.RefObject<string | null>;
}) {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<AppStatus>("waiting");
  const [port, setPort] = useState(0);
  const [client, setClient] = useState<OpencodeClient | null>(null);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [startupTransitionComplete, setStartupTransitionComplete] = useState(false);

  const sseAbortRef = useRef<AbortController | null>(null);
  const { data: startupConfig } = useQuery<AppConfig>({
    queryKey: qk.config,
    queryFn: loadConfig,
  });

  useEffect(() => {
    if (startupConfig) applyTheme(startupConfig.theme);
  }, [startupConfig]);

  const finishStartupTransition = useCallback(() => {
    setStartupTransitionComplete(true);
  }, []);

  // ── Get port from Rust, wait for server, create client ────────────
  useEffect(() => {
    if (ready) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    // Step 1: Poll Tauri command until the sidecar port is available.
    async function waitForPort(): Promise<[number, string]> {
      while (!cancelled) {
        try {
          return await invoke<[number, string]>("get_opencode_info");
        } catch {
          await new Promise((r) => {
            retryTimer = setTimeout(r, 1000);
          });
        }
      }
      throw new Error("cancelled");
    }

    // Step 2: Poll the lightweight health endpoint until the HTTP server responds.
    async function waitForServer(baseUrl: string): Promise<void> {
      while (!cancelled) {
        try {
          const res = await fetch(`${baseUrl}/global/health`, {
            method: "GET",
            signal: AbortSignal.timeout(STARTUP_REQUEST_TIMEOUT),
          });
          if (res.ok || res.status >= 400) return;
        } catch {
          // Connection refused or timeout - keep polling.
        }
        await new Promise((r) => {
          retryTimer = setTimeout(r, 1000);
        });
      }
      throw new Error("cancelled");
    }

    async function init() {
      try {
        const [ocPort, workspace] = await waitForPort();
        if (cancelled) return;

        const baseUrl = `http://127.0.0.1:${ocPort}`;
        await waitForServer(baseUrl);
        if (cancelled) return;

        const newClient = createOpencodeClient({ baseUrl, directory: workspace });
        await prefetchServerState(newClient, queryClient);
        if (cancelled) return;

        setPort(ocPort);
        setClient(newClient);
        setReady(true);
        setStatus("ready");
        setInitError(null);
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to initialize OpenCode:", err);
        setInitError(String(err));
        // Retry the whole sequence.
        retryTimer = setTimeout(init, 3000);
      }
    }

    init();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [ready, queryClient]);

  // ── SSE subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!client || !ready) return;

    const abortController = new AbortController();
    sseAbortRef.current = abortController;
    let consecutiveFailures = 0;
    let reconnectToastId: string | number | undefined;

    function showReconnectToast() {
      if (reconnectToastId != null) return;
      reconnectToastId = toast.error("Lost connection to OpenCode", {
        description: "Events are no longer being received.",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Reconnect",
          onClick: () => window.location.reload(),
        },
      });
    }

    function dismissReconnectToast() {
      if (reconnectToastId != null) {
        toast.dismiss(reconnectToastId);
        reconnectToastId = undefined;
      }
    }

    async function subscribe() {
      try {
        if (!client) return;
        const sseResult = await client.event.subscribe({});
        if (!sseResult?.stream) {
          consecutiveFailures++;
          recordSseReconnecting(consecutiveFailures);
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          if (!abortController.signal.aborted) {
            setTimeout(() => {
              if (!abortController.signal.aborted) subscribe();
            }, SSE_RECONNECT_DELAY);
          }
          return;
        }
        consecutiveFailures = 0;
        recordSseConnected();
        dismissReconnectToast();

        for await (const event of sseResult.stream) {
          if (abortController.signal.aborted) break;
          sseDispatch(queryClient, event, activeSessionIdRef);
        }

        if (!abortController.signal.aborted) {
          consecutiveFailures++;
          recordSseReconnecting(consecutiveFailures);
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          setTimeout(() => {
            if (!abortController.signal.aborted) subscribe();
          }, SSE_RECONNECT_DELAY);
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          console.error("SSE stream error:", err);
          consecutiveFailures++;
          recordSseFailure(err, consecutiveFailures);
          if (consecutiveFailures >= SSE_FAILURE_THRESHOLD) showReconnectToast();
          setTimeout(() => {
            if (!abortController.signal.aborted) subscribe();
          }, SSE_RECONNECT_DELAY);
        }
      }
    }

    subscribe();

    return () => {
      abortController.abort();
      sseAbortRef.current = null;
      dismissReconnectToast();
    };
  }, [client, ready, queryClient, activeSessionIdRef]);

  const value: OpenCodeClientContextValue = {
    client,
    status,
    port,
    ready,
    initError,
    startupTransitionComplete,
  };

  const startupCompanion = startupConfig?.companion ?? DEFAULT_COMPANION_PREFERENCES;
  const startupTheme = THEME_BY_ID[startupConfig?.theme ?? DEFAULT_THEME_ID];

  return (
    <OpenCodeClientContext.Provider value={value}>
      {ready && children}
      {!startupTransitionComplete && (
        <StartupCompanionScreen
          ready={ready}
          error={initError}
          companion={startupCompanion}
          theme={startupTheme}
          onComplete={finishStartupTransition}
        />
      )}
    </OpenCodeClientContext.Provider>
  );
}

// ── Pre-warm query cache with server state ──
// Hooks have their own queryFn as fallback, but seeding the cache here
// avoids extra round-trips on first render.

async function prefetchServerState(client: OpencodeClient, queryClient: QueryClient) {
  const [sessionRes, providerRes, statusRes, agentsRes, authRes] = await Promise.all([
    withStartupTimeout("sessions", client.session.list({})),
    withStartupTimeout("providers", client.provider.list({})),
    withStartupTimeout("statuses", client.session.status({})),
    withStartupTimeout("agents", client.app.agents({})),
    withStartupTimeout("provider auth", client.provider.auth({})),
  ]);

  if (sessionRes.data) {
    const sorted = [...sessionRes.data].sort((a, b) => b.time.created - a.time.created);
    queryClient.setQueryData(qk.sessions, sorted);
  }

  if (statusRes.data) {
    queryClient.setQueryData(qk.statuses, statusRes.data);
  }

  if (agentsRes.data && Array.isArray(agentsRes.data)) {
    queryClient.setQueryData(qk.agents, agentsRes.data);
  }

  if (providerRes.data) {
    const providerData = authRes.data
      ? { ...providerRes.data, authMethods: authRes.data }
      : providerRes.data;
    queryClient.setQueryData(qk.providers, providerData);
  }
}

async function withStartupTimeout<T>(
  label: string,
  promise: Promise<T>,
): Promise<T | { data: undefined }> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<{ data: undefined }>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(`OpenCode startup prefetch timed out: ${label}`);
          resolve({ data: undefined });
        }, PREFETCH_TIMEOUT);
      }),
    ]);
  } catch (err) {
    console.warn(`OpenCode startup prefetch failed: ${label}`, err);
    return { data: undefined };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
