import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("../src-tauri/resources/vscode-mcp/server.js", import.meta.url));
const child = spawn(process.argv[2] || process.execPath, [server], { stdio: ["pipe", "pipe", "pipe"] });
const lines = createInterface({ input: child.stdout });
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk; });
const responses = [];
let timer;
try {
  const done = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`VS Code MCP timed out: ${stderr}`)), 10_000);
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`VS Code MCP exited (${code}): ${stderr}`)));
    lines.on("line", (line) => {
      try {
        responses.push(JSON.parse(line));
        if (responses.length === 2) resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
  const initialize = Buffer.from(JSON.stringify({
    jsonrpc: "2.0", id: 0, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "BloxBot 🧪", version: "1" } },
  }) + "\n");
  // Split inside a UTF-8 character to exercise buffering across chunks.
  const split = initialize.indexOf(Buffer.from("🧪")) + 1;
  child.stdin.write(initialize.subarray(0, split));
  child.stdin.write(initialize.subarray(split));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n" +
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");
  await done;
  assert.equal(responses[0].id, 0);
  assert.equal(responses[0].result.serverInfo.name, "bloxbot-vscode");
  assert.equal(responses[1].id, 1);
  assert.ok(responses[1].result.tools.some((tool) => tool.name === "vscode_list_files"));
  console.log("Verified VS Code MCP startup, newline framing, UTF-8, request ID zero, and tool discovery");
} finally {
  clearTimeout(timer);
  lines.close();
  child.kill();
}
