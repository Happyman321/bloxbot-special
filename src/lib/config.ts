import { LazyStore } from "@tauri-apps/plugin-store";
import {
  type CompanionPreferences,
  DEFAULT_COMPANION_PREFERENCES,
  normalizeCompanionPreferences,
} from "@/lib/companion";
import { DEFAULT_THEME_ID, normalizeThemeId, type ThemeId } from "@/lib/themes";

export type WorkspaceType = "standard" | "vscode";

export interface WorkspaceSettings {
  type: WorkspaceType;
  instructions: string;
  vscodePath: string;
  vscodeCompanionEnabled: boolean;
  defaultAgent: string | null;
}

export interface AppConfig {
  lastModel: string | null;
  hiddenModels: string[];
  theme: ThemeId;
  companion: CompanionPreferences;
  folders: string[];
  sessionFolderById: Record<string, string>;
  favoriteSessionIdsByWorkspace: Record<string, string[]>;
  activeWorkspace: string;
  folderOpenState: Record<string, boolean>;
  folderInstructionsByName: Record<string, string>;
  workspaceSettingsByName: Record<string, WorkspaceSettings>;
}

const store = new LazyStore("bloxbot-store.json");
const CONFIG_KEY = "config";
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  type: "standard",
  instructions: "",
  vscodePath: "",
  vscodeCompanionEnabled: false,
  defaultAgent: null,
};

const DEFAULT_CONFIG: AppConfig = {
  lastModel: null,
  hiddenModels: [],
  theme: DEFAULT_THEME_ID,
  companion: DEFAULT_COMPANION_PREFERENCES,
  folders: [],
  sessionFolderById: {},
  favoriteSessionIdsByWorkspace: {},
  activeWorkspace: "all",
  folderOpenState: {},
  folderInstructionsByName: {},
  workspaceSettingsByName: {},
};

function normalizeWorkspaceSettings(
  folder: string,
  settings: Partial<WorkspaceSettings> | undefined,
  legacyInstructions: Record<string, string>,
): WorkspaceSettings {
  return {
    ...DEFAULT_WORKSPACE_SETTINGS,
    ...(settings ?? {}),
    type: settings?.type === "vscode" ? "vscode" : "standard",
    instructions:
      settings?.instructions ??
      legacyInstructions[folder] ??
      DEFAULT_WORKSPACE_SETTINGS.instructions,
    vscodePath: settings?.vscodePath ?? DEFAULT_WORKSPACE_SETTINGS.vscodePath,
    vscodeCompanionEnabled:
      settings?.vscodeCompanionEnabled ?? DEFAULT_WORKSPACE_SETTINGS.vscodeCompanionEnabled,
    defaultAgent: settings?.defaultAgent ?? DEFAULT_WORKSPACE_SETTINGS.defaultAgent,
  };
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await store.get<Partial<AppConfig> & { theme?: unknown; companion?: unknown }>(
      CONFIG_KEY,
    );
    if (raw) {
      const folders = raw.folders ?? [];
      const legacyInstructions = raw.folderInstructionsByName ?? {};
      const rawWorkspaceSettings = raw.workspaceSettingsByName ?? {};
      const workspaceSettingsByName: Record<string, WorkspaceSettings> = {};

      for (const folder of folders) {
        workspaceSettingsByName[folder] = normalizeWorkspaceSettings(
          folder,
          rawWorkspaceSettings[folder],
          legacyInstructions,
        );
      }

      return {
        ...DEFAULT_CONFIG,
        ...raw,
        hiddenModels: raw.hiddenModels ?? [],
        folders,
        sessionFolderById: raw.sessionFolderById ?? {},
        favoriteSessionIdsByWorkspace: raw.favoriteSessionIdsByWorkspace ?? {},
        activeWorkspace: raw.activeWorkspace ?? "all",
        theme: normalizeThemeId(raw.theme),
        companion: normalizeCompanionPreferences(raw.companion),
        folderOpenState: raw.folderOpenState ?? {},
        folderInstructionsByName: legacyInstructions,
        workspaceSettingsByName,
      };
    }
  } catch {
    // Corrupted data, start fresh
  }
  return DEFAULT_CONFIG;
}

export async function patchConfig(patch: Partial<AppConfig>): Promise<void> {
  const current = await loadConfig();
  await store.set(CONFIG_KEY, { ...current, ...patch });
}
