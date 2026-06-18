import { vi } from "vitest";

export const invoke = vi.fn(async (command: string) => {
  if (command === "get_opencode_info") return [4096, ""];
  if (command === "get_vscode_bridge_info") return { port: 59300, token: "test-token" };
  if (command === "list_roblox_studios") return [];
  return undefined;
});
