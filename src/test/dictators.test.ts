import { __resetStores } from "@tauri-apps/plugin-store";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDictatorProfile,
  DEFAULT_DICTATOR_SETTINGS,
  deleteDictator,
  listDictators,
  loadDictatorStore,
  upsertDictator,
} from "@/lib/dictators";
import {
  cleanWorkerTitle,
  deriveWorkerDisplayName,
  getDictatorWorkerRole,
} from "@/lib/dictatorWorkers";
import type { MessagesCache } from "@/lib/sseDispatch";

describe("dictator store", () => {
  beforeEach(() => {
    __resetStores();
  });

  it("loads an empty store by default", async () => {
    const store = await loadDictatorStore();

    expect(store.profiles).toEqual([]);
    expect(store.tasksByDictatorId).toEqual({});
  });

  it("creates profiles with safe default limits and managed parent session", () => {
    const profile = createDictatorProfile({
      id: "d1",
      name: "Boss",
      parentSessionId: "s-parent",
      now: 123,
    });

    expect(profile.settings).toEqual(DEFAULT_DICTATOR_SETTINGS);
    expect(profile.managedSessionIds).toEqual(["s-parent"]);
  });

  it("upserts, normalizes, sorts, and deletes profiles", async () => {
    const older = createDictatorProfile({
      id: "d1",
      name: "Older",
      parentSessionId: "s1",
      now: 100,
    });
    const newer = createDictatorProfile({
      id: "d2",
      name: "Newer",
      parentSessionId: "s2",
      now: 200,
    });

    await upsertDictator(older);
    await upsertDictator(newer);
    await upsertDictator({
      ...older,
      name: "Updated",
      updatedAt: 300,
      managedSessionIds: ["s-child", "s1"],
    });

    const profiles = await listDictators();
    expect(profiles.map((profile) => profile.name)).toEqual(["Updated", "Newer"]);
    expect(profiles[0].managedSessionIds).toEqual(["s1", "s-child"]);

    await deleteDictator("d1");

    expect((await listDictators()).map((profile) => profile.id)).toEqual(["d2"]);
  });
});

describe("dictator worker helpers", () => {
  it("cleans generic agent names from worker titles", () => {
    expect(cleanWorkerTitle("@dictator-worker Build shared inventory module")).toBe(
      "Build shared inventory module",
    );
    expect(cleanWorkerTitle("dictator-explorer: Inspect Studio hierarchy")).toBe(
      "Inspect Studio hierarchy",
    );
  });

  it("derives role and display name from title, transcript, and fallback", () => {
    const session = {
      id: "worker123456",
      title: "@dictator-reviewer Review final integration",
      time: { created: 1, updated: 1 },
    } as never;
    expect(getDictatorWorkerRole(session)).toBe("reviewer");
    expect(deriveWorkerDisplayName(session)).toBe("Review final integration");

    const cache: MessagesCache = {
      messageIds: ["m1"],
      messagesById: {
        m1: {
          info: { id: "m1", role: "user" } as never,
          parts: [{ id: "p1", type: "text", text: "Inspect Studio visibility" } as never],
        },
      },
    };
    expect(deriveWorkerDisplayName({ ...session, title: "Untitled" }, cache)).toBe(
      "Inspect Studio visibility",
    );
    expect(deriveWorkerDisplayName({ ...session, title: "" }, undefined, "Build framework")).toBe(
      "Build framework",
    );
  });
});
