import { LazyStore } from "@tauri-apps/plugin-store";

export type DictatorTaskStatus = "draft" | "approved" | "running" | "completed" | "blocked";

export interface DictatorSettings {
  maxWorkersPerTask: number;
  maxConcurrentWorkers: number;
  maxWriteWorkers: number;
  workerAgentAllowlist: string[];
  approvalRequired: boolean;
  autoDenyOverBudget: boolean;
  modelKey: string | null;
  workerModelKey: string | null;
}

export interface DictatorTask {
  id: string;
  dictatorId: string;
  title: string;
  status: DictatorTaskStatus;
  approvedAt: number | null;
  workerSessionIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DictatorProfile {
  id: string;
  name: string;
  parentSessionId: string;
  instructions: string;
  managedSessionIds: string[];
  createdAt: number;
  updatedAt: number;
  settings: DictatorSettings;
}

interface DictatorStoreData {
  profiles: DictatorProfile[];
  tasksByDictatorId: Record<string, DictatorTask[]>;
}

export const DEFAULT_DICTATOR_SETTINGS: DictatorSettings = {
  maxWorkersPerTask: 3,
  maxConcurrentWorkers: 3,
  maxWriteWorkers: 1,
  workerAgentAllowlist: ["dictator-worker", "dictator-explorer", "dictator-reviewer"],
  approvalRequired: true,
  autoDenyOverBudget: true,
  modelKey: null,
  workerModelKey: null,
};

const store = new LazyStore("bloxbot-dictators.json");
const STORE_KEY = "dictators";
const DEFAULT_STORE: DictatorStoreData = {
  profiles: [],
  tasksByDictatorId: {},
};

function normalizeProfile(profile: DictatorProfile): DictatorProfile {
  const managedSessionIds = Array.from(
    new Set([profile.parentSessionId, ...(profile.managedSessionIds ?? [])].filter(Boolean)),
  );
  return {
    ...profile,
    managedSessionIds,
    instructions: profile.instructions ?? "",
    settings: {
      ...DEFAULT_DICTATOR_SETTINGS,
      ...(profile.settings ?? {}),
      workerAgentAllowlist:
        profile.settings?.workerAgentAllowlist ?? DEFAULT_DICTATOR_SETTINGS.workerAgentAllowlist,
    },
  };
}

function normalizeStore(raw?: Partial<DictatorStoreData> | null): DictatorStoreData {
  if (!raw) return DEFAULT_STORE;
  return {
    profiles: (raw.profiles ?? []).map((profile) => normalizeProfile(profile as DictatorProfile)),
    tasksByDictatorId: raw.tasksByDictatorId ?? {},
  };
}

export async function loadDictatorStore(): Promise<DictatorStoreData> {
  try {
    const raw = await store.get<DictatorStoreData>(STORE_KEY);
    return normalizeStore(raw);
  } catch {
    return DEFAULT_STORE;
  }
}

async function saveDictatorStore(data: DictatorStoreData): Promise<void> {
  await store.set(STORE_KEY, data);
}

export async function listDictators(): Promise<DictatorProfile[]> {
  const data = await loadDictatorStore();
  return [...data.profiles].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listDictatorTasks(dictatorId: string): Promise<DictatorTask[]> {
  const data = await loadDictatorStore();
  return data.tasksByDictatorId[dictatorId] ?? [];
}

export async function upsertDictator(profile: DictatorProfile): Promise<DictatorProfile> {
  const data = await loadDictatorStore();
  const normalized = normalizeProfile(profile);
  const index = data.profiles.findIndex((item) => item.id === normalized.id);
  if (index >= 0) {
    data.profiles[index] = normalized;
  } else {
    data.profiles.push(normalized);
  }
  await saveDictatorStore(data);
  return normalized;
}

export async function deleteDictator(dictatorId: string): Promise<void> {
  const data = await loadDictatorStore();
  data.profiles = data.profiles.filter((profile) => profile.id !== dictatorId);
  delete data.tasksByDictatorId[dictatorId];
  await saveDictatorStore(data);
}

export async function updateDictatorTasks(
  dictatorId: string,
  tasks: DictatorTask[],
): Promise<DictatorTask[]> {
  const data = await loadDictatorStore();
  data.tasksByDictatorId[dictatorId] = tasks;
  await saveDictatorStore(data);
  return tasks;
}

export function createDictatorProfile(input: {
  id: string;
  name: string;
  parentSessionId: string;
  now: number;
  settings?: Partial<DictatorSettings>;
}): DictatorProfile {
  return {
    id: input.id,
    name: input.name,
    parentSessionId: input.parentSessionId,
    instructions: "",
    managedSessionIds: [input.parentSessionId],
    createdAt: input.now,
    updatedAt: input.now,
    settings: {
      ...DEFAULT_DICTATOR_SETTINGS,
      ...(input.settings ?? {}),
    },
  };
}

export function claimDictatorManagedSession(
  profiles: DictatorProfile[] | undefined,
  sessionId: string,
  parentSessionId?: string | null,
): DictatorProfile[] | undefined {
  if (!profiles || !parentSessionId) return profiles;
  let changed = false;
  const next = profiles.map((profile) => {
    if (profile.parentSessionId !== parentSessionId) return profile;
    if (profile.managedSessionIds.includes(sessionId)) return profile;
    changed = true;
    return {
      ...profile,
      managedSessionIds: [...profile.managedSessionIds, sessionId],
      updatedAt: Date.now(),
    };
  });
  return changed ? next : profiles;
}
