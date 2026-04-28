import type { Session } from "@opencode-ai/sdk/v2/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";

import { fetchMessages } from "@/hooks/useMessages";
import { useSessions } from "@/hooks/useSessions";
import {
  createDictatorProfile,
  type DictatorProfile,
  type DictatorSettings,
  type DictatorTask,
  deleteDictator,
  listDictators,
  listDictatorTasks,
  updateDictatorTasks,
  upsertDictator,
} from "@/lib/dictators";
import { uniqueSessionsById } from "@/lib/dictatorWorkers";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function updateDictatorCache(
  profiles: DictatorProfile[] | undefined,
  updated: DictatorProfile,
): DictatorProfile[] {
  const previous = profiles ?? [];
  const exists = previous.some((profile) => profile.id === updated.id);
  const next = exists
    ? previous.map((profile) => (profile.id === updated.id ? updated : profile))
    : [updated, ...previous];
  return [...next].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function useDictators() {
  return useQuery<DictatorProfile[]>({
    queryKey: qk.dictators,
    queryFn: listDictators,
  });
}

export function useDictatorTasks(dictatorId: string | null) {
  return useQuery<DictatorTask[]>({
    queryKey: dictatorId ? qk.dictatorTasks(dictatorId) : ["dictators", "noop", "tasks"],
    queryFn: () => (dictatorId ? listDictatorTasks(dictatorId) : []),
    enabled: !!dictatorId,
  });
}

export function useManagedDictatorSessionIds(): Set<string> {
  const { data: dictators = [] } = useDictators();
  const { data: sessions = [] } = useSessions();
  return useMemo(() => {
    const ids = new Set<string>();
    const parentIds = new Set(dictators.map((dictator) => dictator.parentSessionId));
    for (const dictator of dictators) {
      ids.add(dictator.parentSessionId);
      for (const sessionId of dictator.managedSessionIds) ids.add(sessionId);
    }
    for (const session of sessions) {
      if (session.parentID && parentIds.has(session.parentID)) ids.add(session.id);
    }
    return ids;
  }, [dictators, sessions]);
}

export function useDictatorWorkerSessions(profile: DictatorProfile | null): Session[] {
  const { data: sessions = [] } = useSessions();
  const { data: children = [] } = useQuery<Session[]>({
    queryKey: profile
      ? qk.dictatorChildren(profile.parentSessionId)
      : ["dictators", "noop", "children"],
    queryFn: () => [],
    enabled: false,
  });

  return useMemo(() => {
    if (!profile) return [];
    const globalChildren = sessions.filter(
      (session) => session.parentID === profile.parentSessionId,
    );
    const managed = sessions.filter(
      (session) =>
        session.id !== profile.parentSessionId && profile.managedSessionIds.includes(session.id),
    );
    return uniqueSessionsById([...children, ...globalChildren, ...managed]).sort(
      (a, b) => b.time.updated - a.time.updated,
    );
  }, [children, profile, sessions]);
}

export function useCreateDictator() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      if (!client) throw new Error("No client");
      const now = Date.now();
      const trimmed = name.trim() || "New Dictator";
      const sessionRes = await client.session.create({ title: `Dictator: ${trimmed}` });
      if (!sessionRes.data) throw new Error("No session returned");
      const profile = createDictatorProfile({
        id: makeId("dictator"),
        name: trimmed,
        parentSessionId: sessionRes.data.id,
        now,
      });
      return upsertDictator(profile);
    },
    onSuccess: (profile) => {
      queryClient.setQueryData<DictatorProfile[]>(qk.dictators, (prev) =>
        updateDictatorCache(prev, profile),
      );
      queryClient.setQueryData<MessagesCache>(qk.messages(profile.parentSessionId), {
        messageIds: [],
        messagesById: {},
      });
      queryClient.setQueryData(qk.todos(profile.parentSessionId), []);
      queryClient.setQueryData(qk.question(profile.parentSessionId), null);
      queryClient.setQueryData(qk.permission(profile.parentSessionId), null);
    },
  });
}

export function useUpdateDictator() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (profile: DictatorProfile) =>
      upsertDictator({ ...profile, updatedAt: Date.now() }),
    onSuccess: (profile) => {
      queryClient.setQueryData<DictatorProfile[]>(qk.dictators, (prev) =>
        updateDictatorCache(prev, profile),
      );
    },
  });
}

export function useDeleteDictator() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteDictator,
    onSuccess: (_result, dictatorId) => {
      queryClient.setQueryData<DictatorProfile[]>(
        qk.dictators,
        (prev) => prev?.filter((profile) => profile.id !== dictatorId) ?? [],
      );
    },
  });
}

export function useRefreshDictatorChildren() {
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (profile: DictatorProfile) => {
      if (!client || !ready) return { children: [] as Session[], updated: profile };
      const res = await client.session.children({ sessionID: profile.parentSessionId });
      const apiChildren = res.data ?? [];
      const globalSessions = queryClient.getQueryData<Session[]>(qk.sessions) ?? [];
      const globalChildren = globalSessions.filter(
        (session) => session.parentID === profile.parentSessionId,
      );
      const children = uniqueSessionsById([...apiChildren, ...globalChildren]);
      const managedSessionIds = Array.from(
        new Set([
          profile.parentSessionId,
          ...profile.managedSessionIds,
          ...children.map((c) => c.id),
        ]),
      );
      const updated =
        managedSessionIds.length === profile.managedSessionIds.length
          ? profile
          : await upsertDictator({ ...profile, managedSessionIds, updatedAt: Date.now() });

      await Promise.allSettled(
        children.map(async (child) => {
          const [messages, todos] = await Promise.all([
            fetchMessages(client, child.id),
            client.session.todo({ sessionID: child.id }).then((todoRes) => todoRes.data ?? []),
          ]);
          queryClient.setQueryData(qk.messages(child.id), messages);
          queryClient.setQueryData(qk.todos(child.id), todos);
        }),
      );

      return { children, updated };
    },
    onSuccess: (result, profile) => {
      if (!result) return;
      queryClient.setQueryData<Session[]>(
        qk.dictatorChildren(profile.parentSessionId),
        result.children,
      );
      queryClient.setQueryData<DictatorProfile[]>(qk.dictators, (prev) =>
        updateDictatorCache(prev, result.updated),
      );
    },
  });
}

export function useApproveDictatorPlan() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (profile: DictatorProfile) => {
      if (!client) throw new Error("No client");
      const settings = profile.settings;
      const text = [
        "[Dictator Plan Approved]",
        "You may now dispatch worker subagents for the approved plan.",
        "Launch independent worker subagents in parallel whenever their ownership scopes are disjoint. Do not wait for one read-only explorer to finish before starting another independent read-only explorer.",
        `Hard limits: max ${settings.maxWorkersPerTask} workers per task, ${settings.maxConcurrentWorkers} concurrent workers, ${settings.maxWriteWorkers} write-capable worker at a time.`,
        `Allowed worker agents: ${settings.workerAgentAllowlist.join(", ")}.`,
        "Assign disjoint ownership before each worker starts. Treat Roblox Studio/DataModel mutation as the single write lane unless explicitly approved later.",
        "Use dictator-explorer for read-only investigation, dictator-worker for scoped implementation, and dictator-reviewer for final review.",
        "Give every subtask a specific description such as `Inspect Studio hierarchy`, `Build shared inventory module`, or `Review final integration`; do not use generic names like `dictator-worker` as the task description.",
      ].join("\n");

      const opts: Record<string, unknown> = {
        sessionID: profile.parentSessionId,
        agent: "dictator",
        tools: { task: true },
        parts: [{ type: "text", text }],
      };

      const modelKey = settings.modelKey;
      if (modelKey) {
        const [providerID, modelID] = splitModelKey(modelKey);
        if (providerID && modelID) opts.model = { providerID, modelID };
      }

      await client.session.promptAsync(opts as Parameters<typeof client.session.promptAsync>[0]);

      const now = Date.now();
      const task: DictatorTask = {
        id: makeId("dictator_task"),
        dictatorId: profile.id,
        title: "Approved plan",
        status: "approved",
        approvedAt: now,
        workerSessionIds: [],
        createdAt: now,
        updatedAt: now,
      };
      const existing = await listDictatorTasks(profile.id);
      return updateDictatorTasks(profile.id, [task, ...existing]);
    },
    onSuccess: (tasks, profile) => {
      queryClient.setQueryData(qk.dictatorTasks(profile.id), tasks);
      toast.success("Dictator plan approved", {
        description: "Worker dispatch is now allowed within the configured limits.",
      });
    },
  });
}

export function useSendDictatorMessage() {
  const { client } = useOpenCodeClient();

  return useMutation({
    mutationFn: async ({ profile, text }: { profile: DictatorProfile; text: string }) => {
      if (!client) throw new Error("No client");
      const trimmed = text.trim();
      if (!trimmed) return;
      const settings: DictatorSettings = profile.settings;
      const prefix = [
        "[Dictator Mode Request]",
        `Dictator name: ${profile.name}`,
        "You are the orchestrator. First produce a concrete plan, task list, worker allocation, file/Studio ownership boundaries, risks, and approval request.",
        "Do not create worker subagents until the user approves the plan through the UI.",
        `Default limits: max ${settings.maxWorkersPerTask} workers per task, ${settings.maxConcurrentWorkers} concurrent workers, ${settings.maxWriteWorkers} write-capable worker at a time.`,
        profile.instructions.trim() ? `Standing instructions:\n${profile.instructions.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const opts: Record<string, unknown> = {
        sessionID: profile.parentSessionId,
        agent: "dictator",
        tools: { task: false },
        parts: [{ type: "text", text: `${prefix}\n\n${trimmed}` }],
      };

      if (settings.modelKey) {
        const [providerID, modelID] = splitModelKey(settings.modelKey);
        if (providerID && modelID) opts.model = { providerID, modelID };
      }

      await client.session.promptAsync(opts as Parameters<typeof client.session.promptAsync>[0]);
    },
  });
}

export function useAbortDictatorSession() {
  const { client } = useOpenCodeClient();

  return useMutation({
    mutationFn: async (sessionID: string) => {
      if (!client) throw new Error("No client");
      await client.session.abort({ sessionID });
    },
  });
}
