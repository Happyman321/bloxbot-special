import { describe, expect, it } from "vitest";

import {
  buildSessionChanges,
  buildSessionChangesFromDiffs,
  buildTurnChanges,
  computeScriptDiff,
  getChangeTurns,
  type StudioCapture,
  type StudioObject,
} from "@/lib/changes";
import type { MessageWithParts } from "@/types";

function makeMessage(
  info: Record<string, unknown>,
  parts: Record<string, unknown>[],
): MessageWithParts {
  return {
    info: info as MessageWithParts["info"],
    parts: parts as MessageWithParts["parts"],
  };
}

describe("buildSessionChanges", () => {
  it("combines assistant steps using the first before-state and final after-state", () => {
    const messageIds = ["m1", "m2"];
    const messagesById: Record<string, MessageWithParts> = {
      m1: makeMessage({ id: "m1", role: "assistant" }, [
        {
          id: "p1",
          type: "patch",
          path: "game/ServerScriptService/Main.server.lua",
          before: "print('hello')",
          after: "print('hello world')",
        },
      ]),
      m2: makeMessage({ id: "m2", role: "assistant" }, [
        {
          id: "p2",
          type: "patch",
          path: "game/ServerScriptService/Main.server.lua",
          before: "print('hello world')",
          after: "print('final')",
        },
      ]),
    };

    const changes = buildSessionChanges(messageIds, messagesById);
    expect(changes).toHaveLength(1);
    expect(changes[0].path).toBe("game/ServerScriptService/Main.server.lua");
    expect(changes[0].after).toBe("print('final')");
    expect(changes[0].before).toBe("print('hello')");
  });

  it("falls back to the most recent assistant message that contains edits", () => {
    const messageIds = ["m1", "m2"];
    const messagesById: Record<string, MessageWithParts> = {
      m1: makeMessage({ id: "m1", role: "assistant" }, [
        {
          id: "p1",
          type: "patch",
          path: "game/ServerScriptService/Main.server.lua",
          before: "print('hello')",
          after: "print('hello world')",
        },
      ]),
      m2: makeMessage({ id: "m2", role: "assistant" }, [
        { id: "txt", type: "text", text: "Done! No further edits." },
      ]),
    };

    const changes = buildSessionChanges(messageIds, messagesById);
    expect(changes).toHaveLength(1);
    expect(changes[0].after).toBe("print('hello world')");
  });

  it("detects add and delete kinds", () => {
    const messageIds = ["m1"];
    const messagesById: Record<string, MessageWithParts> = {
      m1: makeMessage({ id: "m1", role: "assistant" }, [
        { id: "p1", type: "patch", path: "new.lua", before: "", after: "print('new')" },
        { id: "p2", type: "patch", path: "old.lua", before: "print('old')", after: "" },
      ]),
    };

    const changes = buildSessionChanges(messageIds, messagesById);
    const byPath = new Map(changes.map((change) => [change.path, change]));

    expect(byPath.get("new.lua")?.kind).toBe("add");
    expect(byPath.get("old.lua")?.kind).toBe("delete");
  });

  it("parses tool parts with nested files payload", () => {
    const messageIds = ["m1"];
    const messagesById: Record<string, MessageWithParts> = {
      m1: makeMessage({ id: "m1", role: "assistant" }, [
        {
          id: "tool1",
          type: "tool",
          tool: "edit",
          state: {
            status: "completed",
            input: {},
            output: JSON.stringify({
              files: [
                {
                  path: "ReplicatedStorage/Config.lua",
                  before: "return { enabled = false }",
                  after: "return { enabled = true }",
                },
              ],
            }),
          },
        },
      ]),
    };

    const changes = buildSessionChanges(messageIds, messagesById);
    expect(changes).toHaveLength(1);
    expect(changes[0].path).toBe("ReplicatedStorage/Config.lua");
    expect(changes[0].isScript).toBe(true);
    expect(changes[0].linesAdded).toBeGreaterThan(0);
  });

  it("builds change history from session diff API responses", () => {
    const changes = buildSessionChangesFromDiffs([
      {
        messageId: "u1",
        createdAt: 100,
        diffs: [
          {
            file: "game/ServerScriptService/Main.server.lua",
            before: "print(1)",
            after: "print(2)",
            additions: 1,
            deletions: 1,
          },
        ],
      },
      {
        messageId: "u2",
        createdAt: 200,
        diffs: [
          {
            file: "game/ReplicatedStorage/Config.lua",
            before: "return false",
            after: "return true",
            additions: 1,
            deletions: 1,
          },
        ],
      },
    ]);

    expect(changes).toHaveLength(2);
    expect(changes[0].path).toBe("game/ReplicatedStorage/Config.lua");
    expect(changes[0].sourceMessageId).toBe("u2");
    expect(changes[1].sourceMessageId).toBe("u1");
    expect(changes[0].before).toBe("return false");
    expect(changes[0].after).toBe("return true");
    expect(changes[0].diffLines.map((l) => l.type)).toEqual(["remove", "add"]);
  });
});

describe("request boundaries and real tool states", () => {
  const user = (id: string) =>
    makeMessage({ id, role: "user", time: { created: 1 } }, [
      { type: "text", text: "Fix the door" },
    ]);
  const edit = (id: string, before: string, after: string, status = "completed") =>
    makeMessage({ id, role: "assistant" }, [
      {
        type: "tool",
        tool: "edit",
        state: {
          status,
          input: { path: "door.lua", before, after },
          output: JSON.stringify({
            content: [
              {
                type: "text",
                text: JSON.stringify({ files: [{ path: "door.lua", before, after }] }),
              },
            ],
          }),
        },
      },
    ]);
  it("does not leak a previous request into a request without edits", () => {
    const data = { u1: user("u1"), a1: edit("a1", "old", "new"), u2: user("u2") };
    expect(buildSessionChanges(Object.keys(data), data)).toEqual([]);
    expect(getChangeTurns(Object.keys(data), data)).toHaveLength(2);
  });
  it("combines all steps and removes net-zero edits", () => {
    const data = { u: user("u"), a: edit("a", "old", "middle"), b: edit("b", "middle", "old") };
    expect(buildSessionChanges(Object.keys(data), data)).toEqual([]);
  });
  it.each([
    "running",
    "error",
    "pending",
  ])("does not report %s tool inputs as changes", (status) => {
    const data = { u: user("u"), a: edit("a", "old", "new", status) };
    expect(buildSessionChanges(Object.keys(data), data)).toEqual([]);
  });
  it("associates delayed assistant events with their parent request", () => {
    const a = edit("a", "old", "new");
    a.info = { ...a.info, parentID: "u1" } as typeof a.info;
    const data = { u1: user("u1"), u2: user("u2"), a };
    const turns = getChangeTurns(Object.keys(data), data);
    expect(turns[0].messages).toHaveLength(1);
    expect(turns[1].messages).toHaveLength(0);
  });
});

describe("Studio final states", () => {
  const object = (
    source: string,
    properties = { Color: "red" },
    path = "game/Workspace/Door",
  ): StudioObject => ({
    id: "1",
    path,
    className: "Script",
    source,
    properties,
  });
  const turn = { id: "u", label: "Request", messages: [], captureIds: ["a", "b"], studioCalls: 2 };
  const capture = (
    before: StudioObject | null,
    after: StudioObject | null,
    scope = "studio1",
  ): StudioCapture => ({ version: 1, scope, changes: [{ id: "1", before, after }] });
  it("collapses edits and renames into one object with source and property diffs", () => {
    const a = object("old"),
      b = object("middle"),
      c = object("final", { Color: "blue" }, "game/Workspace/NewDoor");
    const [change] = buildTurnChanges(turn, { a: capture(a, b), b: capture(b, c) });
    expect(change.before).toBe("old");
    expect(change.after).toBe("final");
    expect(change.isScript).toBe(true);
    expect(change.properties).toContainEqual({ name: "Color", before: "red", after: "blue" });
    expect(change.properties).toContainEqual({ name: "Path", before: a.path, after: c.path });
  });
  it("omits objects created then deleted and edits restored to the original", () => {
    expect(
      buildTurnChanges(turn, { a: capture(null, object("new")), b: capture(object("new"), null) }),
    ).toEqual([]);
    expect(
      buildTurnChanges(turn, {
        a: capture(object("old"), object("new")),
        b: capture(object("new"), object("old")),
      }),
    ).toEqual([]);
  });
  it("preserves addition status through later edits, including empty scripts", () => {
    const changes = buildTurnChanges(turn, {
      a: capture(null, object("new")),
      b: capture(object("new"), object("")),
    });
    expect(changes[0].kind).toBe("add");
    expect(changes[0].isScript).toBe(true);
  });
  it("does not merge different Studios with identical object IDs", () => {
    expect(
      buildTurnChanges(turn, {
        a: capture(null, object("a")),
        b: capture(null, object("b"), "studio2"),
      }),
    ).toHaveLength(2);
  });
  it("finds capture references in failed tools too", () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    const data = {
      a: makeMessage({ id: "a", role: "assistant" }, [
        {
          type: "tool",
          tool: "roblox-studio_execute_luau",
          state: { status: "error", error: `[BloxBot capture: ${id}]\nFailure` },
        },
      ]),
    };
    expect(getChangeTurns(["a"], data)[0].captureIds).toEqual([id]);
  });
});

describe("line alignment", () => {
  it("aligns insertions without marking the rest of the script replaced", () => {
    const lines = computeScriptDiff("a\nb\nc", "a\ninsert\nb\nc");
    expect(lines.map((l) => l.type)).toEqual(["context", "add", "context", "context"]);
    expect(lines[2]).toMatchObject({ oldLineNumber: 2, newLineNumber: 3 });
  });
  it("does not create phantom removed lines for an added script", () => {
    expect(computeScriptDiff("", "print(1)")).toEqual([
      { type: "add", text: "print(1)", oldLineNumber: null, newLineNumber: 1 },
    ]);
    expect(computeScriptDiff("", "")).toEqual([]);
  });
  it("reconstructs both inputs for many deterministic edits", () => {
    let seed = 13;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed;
    };
    for (let i = 0; i < 300; i++) {
      const a = Array.from({ length: (random() % 40) + 1 }, () => String(random() % 8));
      const b = Array.from({ length: (random() % 40) + 1 }, () => String(random() % 8));
      const lines = computeScriptDiff(a.join("\n"), b.join("\n"));
      expect(lines.filter((l) => l.type !== "add").map((l) => l.text)).toEqual(a);
      expect(lines.filter((l) => l.type !== "remove").map((l) => l.text)).toEqual(b);
    }
  });
  it("parses actual unified patches with original hunk line numbers", () => {
    const [change] = buildSessionChangesFromDiffs([
      {
        messageId: "u",
        diffs: [
          {
            file: "door.luau",
            additions: 1,
            deletions: 1,
            status: "modified",
            patch: "--- a/door.luau\n+++ b/door.luau\n@@ -20,2 +20,2 @@\n same\n-old\n+new\n",
          },
        ],
      },
    ]);
    expect(change.kind).toBe("modify");
    expect(change.diffLines[2]).toMatchObject({ type: "remove", text: "old", oldLineNumber: 21 });
    expect(change.diffLines[3]).toMatchObject({ type: "add", text: "new", newLineNumber: 21 });
    expect(change.linesAdded).toBe(1);
  });
});
