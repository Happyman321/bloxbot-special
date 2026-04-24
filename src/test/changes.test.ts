import { describe, expect, it } from "vitest";

import { buildSessionChanges } from "@/lib/changes";
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
  it("returns only changes from the latest assistant message with edits", () => {
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
      m2: makeMessage(
        { id: "m2", role: "assistant" },
        [{ id: "txt", type: "text", text: "Done! No further edits." }],
      ),
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
          input: {},
          output: {
            files: [
              {
                path: "ReplicatedStorage/Config.lua",
                before: "return { enabled = false }",
                after: "return { enabled = true }",
              },
            ],
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
});
