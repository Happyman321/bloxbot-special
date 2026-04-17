import { LazyStore } from "@tauri-apps/plugin-store";

export interface AppConfig {
  lastModel: string | null;
  hiddenModels: string[];
  theme: "light" | "dark";
  folders: string[];
  sessionFolderById: Record<string, string>;
  activeWorkspace: string;
  folderOpenState: Record<string, boolean>;
}

const store = new LazyStore("bloxbot-store.json");
const CONFIG_KEY = "config";
const DEFAULT_CONFIG: AppConfig = {
  lastModel: null,
  hiddenModels: [],
  theme: "light",
  folders: [],
  sessionFolderById: {},
  activeWorkspace: "all",
  folderOpenState: {},
};

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await store.get<AppConfig>(CONFIG_KEY);
    if (raw) {
      return {
        ...DEFAULT_CONFIG,
        ...raw,
        hiddenModels: raw.hiddenModels ?? [],
        folders: raw.folders ?? [],
        sessionFolderById: raw.sessionFolderById ?? {},
        activeWorkspace: raw.activeWorkspace ?? "all",
        theme: raw.theme ?? "light",
        folderOpenState: raw.folderOpenState ?? {},
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
