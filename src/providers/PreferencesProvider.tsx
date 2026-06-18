import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { useAgents } from "@/hooks/useAgents";
import { useConnectedProviders } from "@/hooks/useProviders";
import {
  type AppConfig,
  DEFAULT_WORKSPACE_SETTINGS,
  loadConfig,
  patchConfig,
  type WorkspaceSettings,
} from "@/lib/config";
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
  workspaceSettingsByName: Record<string, WorkspaceSettings>;
  setSelectedModel: (modelID: string) => void;
  setSelectedAgent: (name: string) => void;
  setSelectedVariant: (variant: string | null) => void;
  toggleModelVisibility: (modelKey: string) => void;
  toggleTheme: () => void;
  createFolder: (name: string) => void;
  renameFolder: (oldName: string, newName: string) => void;
  assignSessionFolder: (sessionId: string, folderName: string | null) => void;
  setActiveWorkspace: (workspace: string) => void;
  toggleFolderOpen: (folderKey: string) => void;
  setPreferredStudioId: (studioId: string | null) => void;
  addKnownStudioId: (studioId: string) => void;
  setFolderInstructions: (folderName: string, instructions: string) => void;
  updateWorkspaceSettings: (folderName: string, settings: Partial<WorkspaceSettings>) => void;
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
  const [workspaceSettingsByName, setWorkspaceSettingsByName] = useState<
    Record<string, WorkspaceSettings>
  >({});

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
    setWorkspaceSettingsByName(configData.workspaceSettingsByName ?? {});
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
      setWorkspaceSettingsByName((settingsPrev) => {
        const settingsNext = {
          ...settingsPrev,
          [trimmed]: { ...DEFAULT_WORKSPACE_SETTINGS },
        };
        patchConfig({ folders: next, workspaceSettingsByName: settingsNext }).catch(() => {});
        return settingsNext;
      });
      return next;
    });
  }, []);

  const renameFolder = useCallback(
    (oldName: string, newName: string) => {
      const from = oldName.trim();
      const to = newName.trim();
      if (!from || !to || from === to) return;
      if (
        folders.some((existing) => existing !== from && existing.toLowerCase() === to.toLowerCase())
      ) {
        return;
      }

      const nextFolders = folders.map((folder) => (folder === from ? to : folder));
      const nextSessionFolderById = Object.fromEntries(
        Object.entries(sessionFolderById).map(([sessionId, folder]) => [
          sessionId,
          folder === from ? to : folder,
        ]),
      );
      const nextFolderOpenState = { ...folderOpenState };
      if (from in nextFolderOpenState) {
        nextFolderOpenState[to] = nextFolderOpenState[from];
        delete nextFolderOpenState[from];
      }
      const nextLegacyInstructions = { ...folderInstructionsByName };
      if (from in nextLegacyInstructions) {
        nextLegacyInstructions[to] = nextLegacyInstructions[from];
        delete nextLegacyInstructions[from];
      }
      const nextWorkspaceSettings = { ...workspaceSettingsByName };
      nextWorkspaceSettings[to] = nextWorkspaceSettings[from] ?? { ...DEFAULT_WORKSPACE_SETTINGS };
      delete nextWorkspaceSettings[from];

      setFolders(nextFolders);
      setSessionFolderById(nextSessionFolderById);
      setFolderOpenState(nextFolderOpenState);
      setFolderInstructionsByName(nextLegacyInstructions);
      setWorkspaceSettingsByName(nextWorkspaceSettings);
      if (activeWorkspace === from) setActiveWorkspaceState(to);

      patchConfig({
        folders: nextFolders,
        sessionFolderById: nextSessionFolderById,
        folderOpenState: nextFolderOpenState,
        folderInstructionsByName: nextLegacyInstructions,
        workspaceSettingsByName: nextWorkspaceSettings,
        activeWorkspace: activeWorkspace === from ? to : activeWorkspace,
      }).catch(() => {});
    },
    [
      activeWorkspace,
      folderInstructionsByName,
      folderOpenState,
      folders,
      sessionFolderById,
      workspaceSettingsByName,
    ],
  );

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

    setWorkspaceSettingsByName((prev) => {
      const next = {
        ...prev,
        [trimmedFolder]: {
          ...(prev[trimmedFolder] ?? DEFAULT_WORKSPACE_SETTINGS),
          instructions: instructions.trim(),
        },
      };
      patchConfig({ workspaceSettingsByName: next }).catch(() => {});
      return next;
    });
  }, []);

  const updateWorkspaceSettings = useCallback(
    (folderName: string, settings: Partial<WorkspaceSettings>) => {
      const trimmedFolder = folderName.trim();
      if (!trimmedFolder) return;

      setWorkspaceSettingsByName((prev) => {
        const nextSettings: WorkspaceSettings = {
          ...(prev[trimmedFolder] ?? DEFAULT_WORKSPACE_SETTINGS),
          ...settings,
          type:
            settings.type === "vscode"
              ? "vscode"
              : (settings.type ?? prev[trimmedFolder]?.type ?? "standard"),
          instructions: settings.instructions ?? prev[trimmedFolder]?.instructions ?? "",
          vscodePath: settings.vscodePath ?? prev[trimmedFolder]?.vscodePath ?? "",
          vscodeCompanionEnabled:
            settings.vscodeCompanionEnabled ?? prev[trimmedFolder]?.vscodeCompanionEnabled ?? false,
          defaultAgent: settings.defaultAgent ?? prev[trimmedFolder]?.defaultAgent ?? null,
        };
        const next = { ...prev, [trimmedFolder]: nextSettings };

        const nextLegacyInstructions = {
          ...folderInstructionsByName,
          [trimmedFolder]: nextSettings.instructions,
        };
        setFolderInstructionsByName(nextLegacyInstructions);
        patchConfig({
          workspaceSettingsByName: next,
          folderInstructionsByName: nextLegacyInstructions,
        }).catch(() => {});
        return next;
      });
    },
    [folderInstructionsByName],
  );

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
    workspaceSettingsByName,
    setSelectedModel,
    setSelectedAgent,
    setSelectedVariant,
    toggleModelVisibility,
    toggleTheme,
    createFolder,
    renameFolder,
    assignSessionFolder,
    setActiveWorkspace,
    toggleFolderOpen,
    setPreferredStudioId,
    addKnownStudioId,
    setFolderInstructions,
    updateWorkspaceSettings,
  };

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
