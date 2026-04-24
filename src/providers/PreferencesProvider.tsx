import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { useAgents } from "@/hooks/useAgents";
import { useConnectedProviders } from "@/hooks/useProviders";
import { type AppConfig, loadConfig, patchConfig } from "@/lib/config";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";

interface PreferencesContextValue {
  selectedModel: string | null;
  selectedAgent: string | null;
  selectedVariant: string | null;
  hiddenModels: Set<string>;
  theme: "light" | "dark";
  folders: string[];
  sessionFolderById: Record<string, string>;
  activeWorkspace: string;
  folderOpenState: Record<string, boolean>;
  preferredStudioId: string | null;
  knownStudioIds: string[];
  folderInstructionsByName: Record<string, string>;
  fastMode: boolean;
  setSelectedModel: (modelID: string) => void;
  setSelectedAgent: (name: string) => void;
  setSelectedVariant: (variant: string | null) => void;
  toggleModelVisibility: (modelKey: string) => void;
  toggleTheme: () => void;
  createFolder: (name: string) => void;
  assignSessionFolder: (sessionId: string, folderName: string | null) => void;
  setActiveWorkspace: (workspace: string) => void;
  toggleFolderOpen: (folderKey: string) => void;
  setPreferredStudioId: (studioId: string | null) => void;
  addKnownStudioId: (studioId: string) => void;
  setFolderInstructions: (folderName: string, instructions: string) => void;
  toggleFastMode: () => void;
}

export const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used within PreferencesProvider");
  }
  return context;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { data: configData } = useQuery<AppConfig>({
    queryKey: qk.config,
    queryFn: loadConfig,
  });

  const [selectedModel, setSelectedModelState] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgentState] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariantState] = useState<string | null>(null);
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(new Set());
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const [folders, setFolders] = useState<string[]>([]);
  const [sessionFolderById, setSessionFolderById] = useState<Record<string, string>>({});
  const [activeWorkspace, setActiveWorkspaceState] = useState("all");
  const [folderOpenState, setFolderOpenState] = useState<Record<string, boolean>>({});
  const [preferredStudioId, setPreferredStudioIdState] = useState<string | null>(null);
  const [knownStudioIds, setKnownStudioIds] = useState<string[]>([]);
  const [folderInstructionsByName, setFolderInstructionsByName] = useState<Record<string, string>>(
    {},
  );
  const [fastMode, setFastModeState] = useState(false);

  const connectedProviders = useConnectedProviders();

  // Initialize from config data when it arrives
  useEffect(() => {
    if (!configData) return;
    setHiddenModels(new Set(configData.hiddenModels ?? []));
    setThemeState(configData.theme ?? "light");
    setFolders(configData.folders ?? []);
    setSessionFolderById(configData.sessionFolderById ?? {});
    setActiveWorkspaceState(configData.activeWorkspace ?? "all");
    setFolderOpenState(configData.folderOpenState ?? {});
    setPreferredStudioIdState(configData.preferredStudioId ?? null);
    setKnownStudioIds(configData.knownStudioIds ?? []);
    setFolderInstructionsByName(configData.folderInstructionsByName ?? {});
    setFastModeState(configData.fastMode ?? false);
  }, [configData]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Restore last used model if its provider is still connected
  useEffect(() => {
    if (!configData || connectedProviders.length === 0) return;
    if (
      configData.lastModel &&
      connectedProviders.includes(splitModelKey(configData.lastModel)[0])
    ) {
      setSelectedModelState(configData.lastModel);
    }
  }, [configData, connectedProviders]);

  // Auto-select first agent
  const agents = useAgents();
  useEffect(() => {
    if (agents.length === 0 || selectedAgent) return;
    const primary = agents.find((a) => a.mode === "primary" && !a.hidden);
    if (primary) setSelectedAgentState(primary.name);
  }, [agents, selectedAgent]);

  const setSelectedModel = useCallback((modelID: string) => {
    setSelectedModelState(modelID);
    patchConfig({ lastModel: modelID }).catch(() => {});
  }, []);

  const setSelectedAgent = useCallback((name: string) => {
    setSelectedAgentState(name);
  }, []);

  const setSelectedVariant = useCallback((variant: string | null) => {
    setSelectedVariantState(variant);
  }, []);

  const toggleModelVisibility = useCallback((modelKey: string) => {
    setHiddenModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelKey)) {
        next.delete(modelKey);
      } else {
        next.add(modelKey);
      }
      patchConfig({ hiddenModels: [...next] }).catch(() => {});
      return next;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      patchConfig({ theme: next }).catch(() => {});
      return next;
    });
  }, []);

  const createFolder = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setFolders((prev) => {
      if (prev.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
        return prev;
      }
      const next = [...prev, trimmed];
      patchConfig({ folders: next }).catch(() => {});
      return next;
    });
  }, []);

  const assignSessionFolder = useCallback((sessionId: string, folderName: string | null) => {
    setSessionFolderById((prev) => {
      const next = { ...prev };
      if (folderName?.trim()) {
        next[sessionId] = folderName.trim();
      } else {
        delete next[sessionId];
      }
      patchConfig({ sessionFolderById: next }).catch(() => {});
      return next;
    });
  }, []);

  const setActiveWorkspace = useCallback((workspace: string) => {
    setActiveWorkspaceState(workspace);
    patchConfig({ activeWorkspace: workspace }).catch(() => {});
  }, []);

  const toggleFolderOpen = useCallback((folderKey: string) => {
    setFolderOpenState((prev) => {
      const next = { ...prev, [folderKey]: !prev[folderKey] };
      patchConfig({ folderOpenState: next }).catch(() => {});
      return next;
    });
  }, []);

  const setPreferredStudioId = useCallback((studioId: string | null) => {
    const normalized = studioId?.trim() || null;
    setPreferredStudioIdState(normalized);
    patchConfig({ preferredStudioId: normalized }).catch(() => {});
  }, []);

  const addKnownStudioId = useCallback((studioId: string) => {
    const normalized = studioId.trim();
    if (!normalized) return;

    setKnownStudioIds((prev) => {
      if (prev.includes(normalized)) return prev;
      const next = [...prev, normalized].sort((a, b) => a.localeCompare(b));
      patchConfig({ knownStudioIds: next }).catch(() => {});
      return next;
    });
  }, []);

  const setFolderInstructions = useCallback((folderName: string, instructions: string) => {
    const trimmedFolder = folderName.trim();
    if (!trimmedFolder) return;

    setFolderInstructionsByName((prev) => {
      const next = { ...prev };
      const normalizedInstructions = instructions.trim();

      if (normalizedInstructions) {
        next[trimmedFolder] = normalizedInstructions;
      } else {
        delete next[trimmedFolder];
      }

      patchConfig({ folderInstructionsByName: next }).catch(() => {});
      return next;
    });
  }, []);

  const toggleFastMode = useCallback(() => {
    setFastModeState((prev) => {
      const next = !prev;
      patchConfig({ fastMode: next }).catch(() => {});
      return next;
    });
  }, []);

  const value: PreferencesContextValue = {
    selectedModel,
    selectedAgent,
    selectedVariant,
    hiddenModels,
    theme,
    folders,
    sessionFolderById,
    activeWorkspace,
    folderOpenState,
    preferredStudioId,
    knownStudioIds,
    folderInstructionsByName,
    fastMode,
    setSelectedModel,
    setSelectedAgent,
    setSelectedVariant,
    toggleModelVisibility,
    toggleTheme,
    createFolder,
    assignSessionFolder,
    setActiveWorkspace,
    toggleFolderOpen,
    setPreferredStudioId,
    addKnownStudioId,
    setFolderInstructions,
    toggleFastMode,
  };

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
