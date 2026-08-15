import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { useAgents } from "@/hooks/useAgents";
import { useConnectedProviders } from "@/hooks/useProviders";
import { type CompanionPreferences, DEFAULT_COMPANION_PREFERENCES } from "@/lib/companion";
import {
  type AppConfig,
  DEFAULT_WORKSPACE_SETTINGS,
  loadConfig,
  patchConfig,
  type WorkspaceSettings,
} from "@/lib/config";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import {
  applyTheme,
  DEFAULT_THEME_ID,
  THEME_BY_ID,
  type ThemeDefinition,
  type ThemeId,
} from "@/lib/themes";

interface PreferencesContextValue {
  selectedModel: string | null;
  selectedAgent: string | null;
  selectedVariant: string | null;
  hiddenModels: Set<string>;
  theme: ThemeId;
  themeDefinition: ThemeDefinition;
  companion: CompanionPreferences;
  folders: string[];
  sessionFolderById: Record<string, string>;
  favoriteSessionIdsByWorkspace: Record<string, string[]>;
  activeWorkspace: string;
  folderOpenState: Record<string, boolean>;
  preferredStudioId: string | null;
  folderInstructionsByName: Record<string, string>;
  workspaceSettingsByName: Record<string, WorkspaceSettings>;
  setSelectedModel: (modelID: string) => void;
  setSelectedAgent: (name: string) => void;
  setSelectedVariant: (variant: string | null) => void;
  toggleModelVisibility: (modelKey: string) => void;
  setTheme: (theme: ThemeId) => void;
  updateCompanion: (patch: Partial<CompanionPreferences>) => void;
  resetCompanion: () => void;
  createFolder: (name: string) => void;
  renameFolder: (oldName: string, newName: string) => void;
  assignSessionFolder: (sessionId: string, folderName: string | null) => void;
  toggleFavoriteSession: (sessionId: string) => void;
  setActiveWorkspace: (workspace: string) => void;
  toggleFolderOpen: (folderKey: string) => void;
  setPreferredStudioId: (studioId: string | null) => void;
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
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME_ID);
  const [companion, setCompanionState] = useState<CompanionPreferences>(
    DEFAULT_COMPANION_PREFERENCES,
  );
  const [folders, setFolders] = useState<string[]>([]);
  const [sessionFolderById, setSessionFolderById] = useState<Record<string, string>>({});
  const [favoriteSessionIdsByWorkspace, setFavoriteSessionIdsByWorkspace] = useState<
    Record<string, string[]>
  >({});
  const [activeWorkspace, setActiveWorkspaceState] = useState("all");
  const [folderOpenState, setFolderOpenState] = useState<Record<string, boolean>>({});
  const [preferredStudioId, setPreferredStudioIdState] = useState<string | null>(null);
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
    setThemeState(configData.theme ?? DEFAULT_THEME_ID);
    setCompanionState(configData.companion ?? DEFAULT_COMPANION_PREFERENCES);
    setFolders(configData.folders ?? []);
    setSessionFolderById(configData.sessionFolderById ?? {});
    setFavoriteSessionIdsByWorkspace(configData.favoriteSessionIdsByWorkspace ?? {});
    setActiveWorkspaceState(configData.activeWorkspace ?? "all");
    setFolderOpenState(configData.folderOpenState ?? {});
    setFolderInstructionsByName(configData.folderInstructionsByName ?? {});
    setWorkspaceSettingsByName(configData.workspaceSettingsByName ?? {});
  }, [configData]);

  useEffect(() => {
    applyTheme(theme);
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

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    patchConfig({ theme: next }).catch(() => {});
  }, []);

  const updateCompanion = useCallback((patch: Partial<CompanionPreferences>) => {
    setCompanionState((previous) => {
      const next = { ...previous, ...patch };
      patchConfig({ companion: next }).catch(() => {});
      return next;
    });
  }, []);

  const resetCompanion = useCallback(() => {
    const next = { ...DEFAULT_COMPANION_PREFERENCES };
    setCompanionState(next);
    patchConfig({ companion: next }).catch(() => {});
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
      const nextFavorites = { ...favoriteSessionIdsByWorkspace };
      if (from in nextFavorites) {
        nextFavorites[to] = Array.from(
          new Set([...(nextFavorites[to] ?? []), ...nextFavorites[from]]),
        );
        delete nextFavorites[from];
      }

      setFolders(nextFolders);
      setSessionFolderById(nextSessionFolderById);
      setFavoriteSessionIdsByWorkspace(nextFavorites);
      setFolderOpenState(nextFolderOpenState);
      setFolderInstructionsByName(nextLegacyInstructions);
      setWorkspaceSettingsByName(nextWorkspaceSettings);
      if (activeWorkspace === from) setActiveWorkspaceState(to);

      patchConfig({
        folders: nextFolders,
        sessionFolderById: nextSessionFolderById,
        favoriteSessionIdsByWorkspace: nextFavorites,
        folderOpenState: nextFolderOpenState,
        folderInstructionsByName: nextLegacyInstructions,
        workspaceSettingsByName: nextWorkspaceSettings,
        activeWorkspace: activeWorkspace === from ? to : activeWorkspace,
      }).catch(() => {});
    },
    [
      activeWorkspace,
      favoriteSessionIdsByWorkspace,
      folderInstructionsByName,
      folderOpenState,
      folders,
      sessionFolderById,
      workspaceSettingsByName,
    ],
  );

  const assignSessionFolder = useCallback((sessionId: string, folderName: string | null) => {
    setSessionFolderById((prev) => {
      const oldWorkspace = prev[sessionId] ?? "unfiled";
      const newWorkspace = folderName?.trim() || "unfiled";
      const next = { ...prev };
      if (folderName?.trim()) {
        next[sessionId] = folderName.trim();
      } else {
        delete next[sessionId];
      }

      setFavoriteSessionIdsByWorkspace((favoritesPrev) => {
        if (
          oldWorkspace === newWorkspace ||
          !(favoritesPrev[oldWorkspace] ?? []).includes(sessionId)
        ) {
          patchConfig({ sessionFolderById: next }).catch(() => {});
          return favoritesPrev;
        }

        const favoritesNext = {
          ...favoritesPrev,
          [oldWorkspace]: (favoritesPrev[oldWorkspace] ?? []).filter((id) => id !== sessionId),
          [newWorkspace]: Array.from(new Set([...(favoritesPrev[newWorkspace] ?? []), sessionId])),
        };
        patchConfig({
          sessionFolderById: next,
          favoriteSessionIdsByWorkspace: favoritesNext,
        }).catch(() => {});
        return favoritesNext;
      });
      return next;
    });
  }, []);

  const toggleFavoriteSession = useCallback(
    (sessionId: string) => {
      const workspace = sessionFolderById[sessionId] ?? "unfiled";
      setFavoriteSessionIdsByWorkspace((prev) => {
        const current = prev[workspace] ?? [];
        const next = {
          ...prev,
          [workspace]: current.includes(sessionId)
            ? current.filter((id) => id !== sessionId)
            : [...current, sessionId],
        };
        patchConfig({ favoriteSessionIdsByWorkspace: next }).catch(() => {});
        return next;
      });
    },
    [sessionFolderById],
  );

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
    themeDefinition: THEME_BY_ID[theme],
    companion,
    folders,
    sessionFolderById,
    favoriteSessionIdsByWorkspace,
    activeWorkspace,
    folderOpenState,
    preferredStudioId,
    folderInstructionsByName,
    workspaceSettingsByName,
    setSelectedModel,
    setSelectedAgent,
    setSelectedVariant,
    toggleModelVisibility,
    setTheme,
    updateCompanion,
    resetCompanion,
    createFolder,
    renameFolder,
    assignSessionFolder,
    toggleFavoriteSession,
    setActiveWorkspace,
    toggleFolderOpen,
    setPreferredStudioId,
    setFolderInstructions,
    updateWorkspaceSettings,
  };

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
