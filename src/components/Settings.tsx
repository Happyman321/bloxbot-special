import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import AppearanceSettings from "@/components/AppearanceSettings";
import { SkillsSettings } from "@/components/SkillsSettings";
import { useCompleteOAuth, useStartOAuth } from "@/hooks/mutations/useOAuth";
import { useDisconnectProvider, useSetApiKey } from "@/hooks/mutations/useSetApiKey";
import {
  useAllModels,
  useAllProviders,
  useAuthMethods,
  useConnectedProviders,
} from "@/hooks/useProviders";
import {
  formatDiagnosticsReport,
  getDiagnosticsSnapshot,
  subscribeDiagnostics,
} from "@/lib/diagnostics";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";
import type { ModelInfo, ProviderInfo } from "@/types";

// ── Popular providers (same order as OpenCode's web UI) ──────────────
const POPULAR_PROVIDERS = [
  "opencode",
  "anthropic",
  "github-copilot",
  "openai",
  "xai",
  "google",
  "openrouter",
  "vercel",
];

// ── Provider-specific metadata for auth UX ───────────────────────────
const PROVIDER_META: Record<string, { placeholder?: string; helpUrl?: string }> = {
  opencode: {
    placeholder: "opencode-...",
    helpUrl: "https://opencode.ai/zen",
  },
  anthropic: {
    placeholder: "sk-ant-...",
    helpUrl: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    placeholder: "sk-...",
    helpUrl: "https://platform.openai.com/api-keys",
  },
  xai: {
    placeholder: "xai-...",
    helpUrl: "https://console.x.ai/",
  },
  google: {
    placeholder: "AIza...",
    helpUrl: "https://aistudio.google.com/app/apikey",
  },
  openrouter: {
    placeholder: "sk-or-...",
    helpUrl: "https://openrouter.ai/keys",
  },
};

const TECHNOLOGIES = [
  { name: "OpenCode", url: "https://opencode.ai", description: "AI coding engine" },
  {
    name: "Roblox Studio MCP",
    url: "https://create.roblox.com/docs/studio/mcp",
    description: "Official Studio MCP server",
  },
];

type SettingsTab = "providers" | "models" | "skills" | "appearance" | "usage" | "about";

interface SettingsProps {
  onClose: () => void;
}

function Settings({ onClose }: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>("providers");
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-4">
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Back to chat"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h3 className="text-xs font-semibold">Settings</h3>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <div className="flex w-40 shrink-0 flex-col border-r py-3">
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Server
          </div>
          <button
            onClick={() => setTab("providers")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "providers"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Providers
          </button>
          <button
            onClick={() => setTab("models")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "models"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            Models
          </button>
          <button
            onClick={() => setTab("skills")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "skills"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2v4" />
              <path d="M12 18v4" />
              <path d="m4.93 4.93 2.83 2.83" />
              <path d="m16.24 16.24 2.83 2.83" />
              <path d="M2 12h4" />
              <path d="M18 12h4" />
              <path d="m4.93 19.07 2.83-2.83" />
              <path d="m16.24 7.76 2.83-2.83" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Skills
          </button>

          <div className="mt-4 px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            App
          </div>
          <button
            onClick={() => setTab("appearance")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "appearance"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2" />
              <path d="M12 20v2" />
              <path d="M4.93 4.93l1.41 1.41" />
              <path d="M17.66 17.66l1.41 1.41" />
              <path d="M2 12h2" />
              <path d="M20 12h2" />
              <path d="M6.34 17.66l-1.41 1.41" />
              <path d="M19.07 4.93l-1.41 1.41" />
            </svg>
            Appearance
          </button>
          <button
            onClick={() => setTab("usage")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "usage"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="20" x2="12" y2="10" />
              <line x1="18" y1="20" x2="18" y2="4" />
              <line x1="6" y1="20" x2="6" y2="16" />
            </svg>
            Usage
          </button>
          <button
            onClick={() => setTab("about")}
            className={`mx-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              tab === "about"
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            About
          </button>
        </div>

        {/* Content area */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {tab === "providers" && <ProvidersTab appVersion={appVersion} />}
          {tab === "models" && <ModelsTab />}
          {tab === "skills" && <SkillsSettings />}
          {tab === "appearance" && <AppearanceSettings />}
          {tab === "usage" && <UsageTab />}
          {tab === "about" && <AboutTab appVersion={appVersion} />}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Providers Tab — matches OpenCode's two-section layout with connect dialog
// ═══════════════════════════════════════════════════════════════════════

type ConnectDialogState =
  | { step: "closed" }
  | { step: "methods"; provider: ProviderInfo }
  | {
      step: "oauth";
      provider: ProviderInfo;
      methodIndex: number;
      method: "auto" | "code" | null;
      instructions: string | null;
    }
  | { step: "apikey"; provider: ProviderInfo };

function ProvidersTab({ appVersion }: { appVersion: string | null }) {
  const queryClient = useQueryClient();
  const { activeSessionId } = useActiveSession();
  const { client, port } = useOpenCodeClient();
  const { selectedModel } = usePreferences();
  const allProviders = useAllProviders();
  const connectedProviders = useConnectedProviders();
  const authMethods = useAuthMethods();
  const setApiKeyMutation = useSetApiKey();
  const startOAuthMutation = useStartOAuth();
  const completeOAuthMutation = useCompleteOAuth();
  const disconnectMutation = useDisconnectProvider();

  const [dialog, setDialog] = useState<ConnectDialogState>({ step: "closed" });
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [oauthCodeInput, setOauthCodeInput] = useState("");
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [restartingApp, setRestartingApp] = useState(false);
  const diagnostics = useSyncExternalStore(
    subscribeDiagnostics,
    getDiagnosticsSnapshot,
    getDiagnosticsSnapshot,
  );

  const oauthAbortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const closeDialog = useCallback(() => {
    oauthAbortRef.current?.abort();
    oauthAbortRef.current = null;
    setDialog({ step: "closed" });
    setApiKeyInput("");
    setOauthCodeInput("");
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      oauthAbortRef.current?.abort();
    };
  }, []);

  // Close dialog on click outside
  useEffect(() => {
    if (dialog.step === "closed") return;
    function handleClick(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        closeDialog();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [closeDialog, dialog.step]);

  // Auto-close dialog when provider becomes connected
  const prevConnectedRef = useRef(connectedProviders);
  useEffect(() => {
    const prev = prevConnectedRef.current;
    prevConnectedRef.current = connectedProviders;
    if (dialog.step === "closed") return;
    const providerId = dialog.provider.id;
    if (connectedProviders.includes(providerId) && !prev.includes(providerId)) {
      toast.success(`${dialog.provider.name} connected`);
      closeDialog();
    }
  }, [closeDialog, connectedProviders, dialog]);

  function getOAuthMethods(providerId: string) {
    const methods = authMethods[providerId];
    if (!methods) return [];
    return methods
      .map((method, index) => ({ method, index }))
      .filter(({ method }) => method.type === "oauth");
  }

  function getOAuthMethodIndex(providerId: string): number | null {
    return getOAuthMethods(providerId)[0]?.index ?? null;
  }

  function getApiKeyMethod(providerId: string) {
    const methods = authMethods[providerId];
    return methods?.find((m) => m.type === "api") ?? null;
  }

  function hasApiKeyAuth(providerId: string): boolean {
    const methods = authMethods[providerId];
    if (!methods || methods.length === 0) return true;
    return methods.some((m) => m.type === "api");
  }

  function getMethodLabel(method: { label?: unknown }, fallback: string): string {
    return typeof method.label === "string" && method.label.trim() ? method.label : fallback;
  }

  function openConnect(provider: ProviderInfo) {
    const oauthMethods = getOAuthMethods(provider.id);
    const oauthIdx = oauthMethods[0]?.index ?? null;
    const apiKey = hasApiKeyAuth(provider.id);

    // If only one method, skip method selection
    if (oauthMethods.length === 1 && oauthIdx !== null && !apiKey) {
      startOAuthFlow(provider, oauthIdx);
    } else if (oauthIdx === null && apiKey) {
      setDialog({ step: "apikey", provider });
    } else if (oauthIdx !== null && apiKey) {
      setDialog({ step: "methods", provider });
    } else if (oauthMethods.length > 1) {
      setDialog({ step: "methods", provider });
    } else {
      // No auth methods available
      setError(
        `No authentication methods available. Required env vars: ${provider.env.join(", ")}`,
      );
      setDialog({ step: "methods", provider });
    }
  }

  async function startOAuthFlow(provider: ProviderInfo, methodIndex: number) {
    setDialog({ step: "oauth", provider, methodIndex, method: null, instructions: null });
    setError(null);
    try {
      const authResult = await startOAuthMutation.mutateAsync({
        providerID: provider.id,
        methodIndex,
      });
      if (!authResult) {
        closeDialog();
        return;
      }
      setDialog({
        step: "oauth",
        provider,
        methodIndex,
        method: authResult.method,
        instructions: authResult.instructions ?? null,
      });
      if (authResult.method === "auto") {
        const abort = new AbortController();
        oauthAbortRef.current = abort;
        try {
          const success = await completeOAuthMutation.mutateAsync({
            providerID: provider.id,
            methodIndex,
          });
          if (!abort.signal.aborted) {
            if (success) {
              // Auto-close handled by the connectedProviders effect
            } else {
              setError("Authorization failed. Please try again.");
              setDialog({ step: "methods", provider });
            }
          }
        } catch {
          if (!abort.signal.aborted) {
            setError("Sign-in timed out or was cancelled");
            setDialog({ step: "methods", provider });
          }
        }
      }
    } catch {
      setError("Failed to start sign-in flow");
      setDialog({ step: "methods", provider });
    }
  }

  async function handleOAuthCode(providerId: string) {
    if (dialog.step !== "oauth" || !oauthCodeInput.trim()) return;
    try {
      const success = await completeOAuthMutation.mutateAsync({
        providerID: providerId,
        methodIndex: dialog.methodIndex,
        code: oauthCodeInput.trim(),
      });
      if (!success) {
        setError("Authorization failed. Please try again.");
      }
      // Success auto-closes via connectedProviders effect
    } catch {
      setError("Invalid code. Please try again.");
    }
    setOauthCodeInput("");
  }

  async function handleSaveKey(providerId: string) {
    if (!apiKeyInput.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await setApiKeyMutation.mutateAsync({ providerID: providerId, key: apiKeyInput.trim() });
      // Success auto-closes via connectedProviders effect
    } catch {
      setError("Invalid key or connection failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect(providerId: string) {
    setDisconnecting(providerId);
    try {
      await disconnectMutation.mutateAsync(providerId);
      toast.success("Provider disconnected");
    } catch {
      toast.error("Failed to disconnect");
    } finally {
      setDisconnecting(null);
    }
  }

  async function handleRefreshModels() {
    if (!client) {
      toast.error("OpenCode is not connected yet");
      return;
    }

    setRefreshingModels(true);
    try {
      const [providerRes, authRes] = await Promise.all([
        client.provider.list({}),
        client.provider.auth({}).catch(() => ({ data: undefined })),
      ]);

      if (providerRes.data) {
        const nextProviderData = authRes.data
          ? { ...providerRes.data, authMethods: authRes.data }
          : providerRes.data;
        queryClient.setQueryData(qk.providers, nextProviderData);
      } else {
        queryClient.invalidateQueries({ queryKey: qk.providers });
      }

      toast.success("Model list refreshed");
    } catch (err) {
      console.error("[providers] Failed to refresh models:", err);
      toast.error("Could not refresh models");
    } finally {
      setRefreshingModels(false);
    }
  }

  async function handleClearCacheAndReload() {
    setRestartingApp(true);

    try {
      queryClient.removeQueries({ queryKey: qk.providers });
      queryClient.removeQueries({ queryKey: qk.statuses });
      queryClient.removeQueries({ queryKey: qk.agents });
      toast.success("Cache cleared. Restarting app...");
      await relaunch();
    } catch (err) {
      console.error("[providers] Failed to restart app:", err);
      toast.error("Failed to restart app");
      setRestartingApp(false);
    }
  }

  async function handleCopyDiagnostics() {
    const statuses = queryClient.getQueryData<Record<string, SessionStatus>>(qk.statuses);
    const report = formatDiagnosticsReport({
      appVersion,
      port,
      selectedModel,
      connectedProviders,
      activeSessionId,
      activeSessionStatus: activeSessionId ? statuses?.[activeSessionId] : undefined,
      openaiAuthMethods: authMethods.openai,
    });

    try {
      await navigator.clipboard.writeText(report);
      toast.success("Diagnostics copied");
    } catch (err) {
      console.error("[providers] Failed to copy diagnostics:", err);
      toast.error("Could not copy diagnostics");
    }
  }

  // Split providers into connected and unconnected
  const connected = allProviders.filter((p) => connectedProviders.includes(p.id));
  const unconnected = allProviders.filter((p) => !connectedProviders.includes(p.id));

  // Sort unconnected: popular first, then alphabetical
  const sortedUnconnected = useMemo(() => {
    const pop: ProviderInfo[] = [];
    const oth: ProviderInfo[] = [];
    for (const p of unconnected) {
      if (POPULAR_PROVIDERS.includes(p.id)) {
        pop.push(p);
      } else {
        oth.push(p);
      }
    }
    pop.sort((a, b) => POPULAR_PROVIDERS.indexOf(a.id) - POPULAR_PROVIDERS.indexOf(b.id));
    oth.sort((a, b) => a.name.localeCompare(b.name));
    return [...pop, ...oth];
  }, [unconnected]);

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">Providers</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Connect AI providers to use their models.
      </p>

      <div className="mt-4 rounded-lg border bg-card p-3">
        <div className="text-[11px] font-medium">Missing a model?</div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Refresh the provider model catalog, or clear temporary cache and restart the app. Your
          chats are preserved.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={handleRefreshModels}
            disabled={refreshingModels || restartingApp}
            className="rounded-md border bg-background px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            {refreshingModels ? "Refreshing..." : "Refresh model list"}
          </button>
          <button
            onClick={handleClearCacheAndReload}
            disabled={restartingApp || refreshingModels}
            className="rounded-md border bg-background px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            {restartingApp ? "Restarting..." : "Clear cache & reload app"}
          </button>
          <button
            onClick={handleCopyDiagnostics}
            className="rounded-md border bg-background px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent"
          >
            Copy diagnostics
          </button>
        </div>
        <div className="mt-2 text-[10px] text-muted-foreground">
          SSE: {diagnostics.sse.state}
          {diagnostics.sse.lastEventType ? `, last event ${diagnostics.sse.lastEventType}` : ""}
        </div>
      </div>

      {/* Connected providers */}
      {connected.length > 0 && (
        <div className="mt-6">
          <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Connected
          </div>
          <div className="space-y-1.5">
            {connected.map((provider) => (
              <div
                key={provider.id}
                className="flex items-center justify-between rounded-lg border bg-card px-3.5 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{provider.name}</span>
                  <span className="flex items-center gap-1.5 rounded-full bg-success-surface px-2 py-0.5 text-[10px] font-medium text-success-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-success-border" />
                    Connected
                  </span>
                </div>
                {provider.id !== "opencode" && (
                  <button
                    onClick={() => handleDisconnect(provider.id)}
                    disabled={disconnecting === provider.id}
                    className="text-[11px] text-muted-foreground transition-colors hover:text-danger-foreground disabled:opacity-50"
                  >
                    {disconnecting === provider.id ? "..." : "Disconnect"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unconnected providers */}
      {sortedUnconnected.length > 0 && (
        <div className="mt-6">
          <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {connected.length > 0 ? "Available" : "Providers"}
          </div>
          <div className="space-y-1.5">
            {sortedUnconnected.map((provider) => (
              <div
                key={provider.id}
                className="flex items-center justify-between rounded-lg border bg-card px-3.5 py-2.5"
              >
                <span className="text-sm font-medium">{provider.name}</span>
                <button
                  onClick={() => openConnect(provider)}
                  className="rounded-md border bg-background px-3 py-1 text-[11px] font-medium transition-colors hover:bg-accent"
                >
                  Connect
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {allProviders.length === 0 && (
        <div className="mt-8 py-4 text-center text-xs text-muted-foreground">
          Loading providers...
        </div>
      )}

      {/* Connect dialog overlay */}
      {dialog.step !== "closed" && (
        <div
          data-companion-blocking="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        >
          <div
            ref={dialogRef}
            className="mx-4 w-full max-w-sm rounded-xl border bg-card p-5 shadow-lg"
          >
            <div className="flex items-center justify-between">
              <h5 className="text-sm font-semibold">Connect {dialog.provider.name}</h5>
              <button
                onClick={closeDialog}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {error && <p className="mt-3 text-[11px] text-destructive">{error}</p>}

            {/* Method selection */}
            {dialog.step === "methods" && (
              <div className="mt-4 space-y-2">
                {getOAuthMethods(dialog.provider.id).map(({ method, index }) => (
                  <button
                    key={`oauth-${index}`}
                    onClick={() => {
                      setError(null);
                      startOAuthFlow(dialog.provider, index);
                    }}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-md border bg-background text-xs font-medium transition-colors hover:bg-accent"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                      <polyline points="10 17 15 12 10 7" />
                      <line x1="15" y1="12" x2="3" y2="12" />
                    </svg>
                    {getMethodLabel(method, `Sign in with ${dialog.provider.name}`)}
                  </button>
                ))}
                {getOAuthMethodIndex(dialog.provider.id) !== null &&
                  hasApiKeyAuth(dialog.provider.id) && (
                    <div className="flex items-center gap-2">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-[10px] text-muted-foreground">or</span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  )}
                {hasApiKeyAuth(dialog.provider.id) && (
                  <button
                    onClick={() => {
                      setError(null);
                      setDialog({ step: "apikey", provider: dialog.provider });
                    }}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-md border bg-background text-xs font-medium transition-colors hover:bg-accent"
                  >
                    {getMethodLabel(getApiKeyMethod(dialog.provider.id) ?? {}, "Use an API key")}
                  </button>
                )}
              </div>
            )}

            {/* OAuth flow */}
            {dialog.step === "oauth" && (
              <div className="mt-4 space-y-3">
                {!dialog.method && (
                  <div className="flex items-center justify-center py-4">
                    <svg
                      className="h-4 w-4 animate-spin text-muted-foreground"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                    </svg>
                  </div>
                )}
                {dialog.method === "auto" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                      <svg
                        className="h-3 w-3 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                      </svg>
                      Waiting for authorization...
                    </div>
                    {dialog.instructions && (
                      <div className="rounded-md border bg-muted/50 p-2.5">
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {dialog.instructions}
                        </p>
                        <button
                          onClick={() => {
                            const code = dialog.instructions?.match(/[A-Z0-9]{4,}-[A-Z0-9]{4,}/i);
                            if (code) {
                              navigator.clipboard.writeText(code[0]);
                              toast("Code copied to clipboard");
                            }
                          }}
                          className="mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-foreground transition-colors hover:bg-accent"
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          Copy code
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {dialog.method === "code" && (
                  <div className="space-y-2">
                    {dialog.instructions && (
                      <p className="text-[11px] text-muted-foreground">{dialog.instructions}</p>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={oauthCodeInput}
                        onChange={(e) => setOauthCodeInput(e.target.value)}
                        placeholder="Paste authorization code..."
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && oauthCodeInput.trim()) {
                            e.preventDefault();
                            handleOAuthCode(dialog.provider.id);
                          }
                        }}
                        className="h-8 flex-1 rounded border bg-background px-2 font-mono text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
                        autoFocus
                      />
                      <button
                        onClick={() => handleOAuthCode(dialog.provider.id)}
                        disabled={!oauthCodeInput.trim()}
                        className="h-8 rounded bg-foreground px-3 text-xs font-medium text-background transition-opacity disabled:opacity-40"
                      >
                        Submit
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* API key input */}
            {dialog.step === "apikey" && (
              <div className="mt-4 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => {
                      setApiKeyInput(e.target.value);
                      setError(null);
                    }}
                    placeholder={PROVIDER_META[dialog.provider.id]?.placeholder ?? "API key..."}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && apiKeyInput.trim() && !saving) {
                        e.preventDefault();
                        handleSaveKey(dialog.provider.id);
                      }
                    }}
                    className="h-8 flex-1 rounded border bg-background px-2 font-mono text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
                    autoFocus
                  />
                  <button
                    onClick={() => handleSaveKey(dialog.provider.id)}
                    disabled={saving || !apiKeyInput.trim()}
                    className="h-8 rounded bg-foreground px-3 text-xs font-medium text-background transition-opacity disabled:opacity-40"
                  >
                    {saving ? "..." : "Save"}
                  </button>
                </div>
                {PROVIDER_META[dialog.provider.id]?.helpUrl && (
                  <a
                    href={PROVIDER_META[dialog.provider.id]?.helpUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-[10px] text-muted-foreground underline hover:text-foreground"
                  >
                    Get an API key
                  </a>
                )}
                {getOAuthMethodIndex(dialog.provider.id) !== null && (
                  <button
                    onClick={() => setDialog({ step: "methods", provider: dialog.provider })}
                    className="block text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Back to sign-in options
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Models Tab
// ═══════════════════════════════════════════════════════════════════════

function ModelsTab() {
  const allModels = useAllModels();
  const connectedProviders = useConnectedProviders();
  const { hiddenModels, toggleModelVisibility } = usePreferences();

  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Group models by provider (only connected providers), filtered by search
  const modelsByProvider = useMemo(() => {
    const query = search.toLowerCase().trim();
    const groups: Record<string, { providerName: string; models: ModelInfo[] }> = {};

    for (const model of allModels) {
      // Only show models from connected providers
      if (!connectedProviders.includes(model.providerId)) continue;

      // Filter by search
      if (query) {
        const haystack = `${model.name} ${model.id} ${model.providerName}`.toLowerCase();
        if (!haystack.includes(query)) continue;
      }

      if (!groups[model.providerId]) {
        groups[model.providerId] = {
          providerName: model.providerName,
          models: [],
        };
      }
      groups[model.providerId].models.push(model);
    }

    // Sort models within each group
    for (const group of Object.values(groups)) {
      group.models.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Sort provider groups: popular first, then alphabetical
    const entries = Object.entries(groups);
    entries.sort(([aId], [bId]) => {
      const aPopular = POPULAR_PROVIDERS.includes(aId);
      const bPopular = POPULAR_PROVIDERS.includes(bId);
      if (aPopular && !bPopular) return -1;
      if (!aPopular && bPopular) return 1;
      if (aPopular && bPopular) {
        return POPULAR_PROVIDERS.indexOf(aId) - POPULAR_PROVIDERS.indexOf(bId);
      }
      return groups[aId].providerName.localeCompare(groups[bId].providerName);
    });

    return entries;
  }, [allModels, connectedProviders, search]);

  const totalModels = allModels.filter((m) => connectedProviders.includes(m.providerId)).length;

  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">Models</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Toggle which models appear in the model selector.
      </p>

      {/* Search */}
      <div className="mt-4">
        <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2.5">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-muted-foreground/50"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models..."
            className="h-8 flex-1 bg-transparent text-xs placeholder:text-muted-foreground/40 focus:outline-none"
          />
          {search && (
            <button
              onClick={() => {
                setSearch("");
                searchRef.current?.focus();
              }}
              className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <svg
                width="8"
                height="8"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Model groups */}
      <div className="mt-5 space-y-6">
        {modelsByProvider.map(([providerId, group]) => (
          <div key={providerId}>
            <div className="flex items-center gap-2 pb-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-[10px] font-semibold text-muted-foreground">
                {group.providerName.charAt(0).toUpperCase()}
              </span>
              <span className="text-sm font-medium">{group.providerName}</span>
            </div>
            <div className="rounded-lg border bg-card">
              {group.models.map((model, idx) => {
                const modelKey = `${model.providerId}/${model.id}`;
                const isVisible = !hiddenModels.has(modelKey);
                return (
                  <div key={modelKey}>
                    {idx > 0 && <div className="mx-3.5 h-px bg-border" />}
                    <button
                      onClick={() => toggleModelVisibility(modelKey)}
                      className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
                    >
                      <span className="truncate text-xs">{model.name}</span>
                      {/* Toggle switch */}
                      <span
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                          isVisible ? "bg-foreground" : "bg-border"
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${
                            isVisible ? "translate-x-4" : "translate-x-0.5"
                          }`}
                        />
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {modelsByProvider.length === 0 && totalModels > 0 && (
          <div className="py-4 text-center text-xs text-muted-foreground">
            No models matching &quot;{search}&quot;
          </div>
        )}

        {totalModels === 0 && (
          <div className="py-4 text-center text-xs text-muted-foreground">
            Connect a provider to see available models.
          </div>
        )}
      </div>
    </div>
  );
}

const USAGE_LINKS = [
  {
    label: "ChatGPT usage",
    hint: "View your Codex-heavy ChatGPT usage details.",
    href: "https://chatgpt.com/#settings/usage",
  },
  {
    label: "OpenAI API usage",
    hint: "Token and spend history by model and date.",
    href: "https://platform.openai.com/usage",
  },
  {
    label: "OpenAI billing",
    hint: "Limits, invoices, and payment settings.",
    href: "https://platform.openai.com/settings/organization/billing/overview",
  },
];

function UsageTab() {
  async function handleOpen(url: string) {
    try {
      await openUrl(url);
    } catch (error) {
      console.error("Failed to open usage link:", error);
      toast.error("Couldn't open usage page");
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-5">
      <h4 className="text-sm font-semibold">Usage</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Quick links to your ChatGPT/OpenAI usage pages. Bars are shortcuts, not account data.
      </p>

      <div className="mt-4 space-y-3">
        {USAGE_LINKS.map((item, index) => (
          <button
            key={item.href}
            onClick={() => handleOpen(item.href)}
            className="w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/40"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium">{item.label}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{item.hint}</div>
              </div>
              <div className="text-[10px] text-muted-foreground">Open ↗</div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-foreground/70"
                style={{ width: `${65 - index * 18}%` }}
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// About Tab
// ═══════════════════════════════════════════════════════════════════════

function AboutTab({ appVersion }: { appVersion: string | null }) {
  return (
    <div className="mx-auto w-full max-w-md px-6 py-8">
      <h4 className="font-serif text-lg italic text-foreground">About BloxBot</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        AI-assisted Roblox development, right from your desktop.
      </p>

      {/* Version */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Version
        </div>
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium">
                BloxBot{appVersion && <span className="font-mono"> v{appVersion}</span>}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Built with */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Built With
        </div>
        <div className="rounded-lg border bg-card">
          {TECHNOLOGIES.map((tech, idx) => (
            <div key={tech.name}>
              {idx > 0 && <div className="mx-3.5 h-px bg-border" />}
              <a
                href={tech.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between px-3.5 py-2.5 transition-colors hover:bg-accent"
              >
                <div className="min-w-0">
                  <span className="text-xs font-medium">{tech.name}</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">{tech.description}</span>
                </div>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-muted-foreground"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          ))}
        </div>
        <p className="mt-3 px-1 text-[11px] leading-relaxed text-muted-foreground">
          BloxBot is powered by these projects. Thank you to the teams behind them.
        </p>
      </div>

      {/* Links */}
      <div className="mt-6">
        <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Links
        </div>
        <div className="space-y-1.5">
          <a
            href="https://bloxbot.ai"
            target="_blank"
            rel="noreferrer"
            className="flex h-9 w-full items-center gap-2 rounded-lg border bg-card px-3.5 text-xs transition-colors hover:bg-accent"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            Website
          </a>
          <a
            href="https://github.com/paralov/app-bloxbot-ai"
            target="_blank"
            rel="noreferrer"
            className="flex h-9 w-full items-center gap-2 rounded-lg border bg-card px-3.5 text-xs transition-colors hover:bg-accent"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
}

export default Settings;
