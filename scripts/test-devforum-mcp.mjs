import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const EXPECTED_TOOLS = [
  "check_api_health",
  "get_engine_api",
  "get_replies",
  "get_thread",
  "get_weekly_recap",
  "get_whats_new",
  "list_categories",
  "list_recent",
  "search_bugs",
  "search_creator_docs",
  "search_devforum",
];

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(
  projectRoot,
  "src-tauri",
  "resources",
  "devforum-mcp",
  "server.mjs",
);
const licensePath = path.join(projectRoot, "src-tauri", "resources", "devforum-mcp", "LICENSE");
const dependencyLicensePaths = [
  path.join(
    projectRoot,
    "src-tauri",
    "resources",
    "devforum-mcp",
    "licenses",
    "modelcontextprotocol-sdk.LICENSE",
  ),
  path.join(
    projectRoot,
    "src-tauri",
    "resources",
    "devforum-mcp",
    "licenses",
    "zod.LICENSE",
  ),
];
const nodePath = process.argv[2] ? path.resolve(process.argv[2]) : process.execPath;

await Promise.all([
  access(serverPath),
  access(licensePath),
  ...dependencyLicensePaths.map((dependencyLicensePath) => access(dependencyLicensePath)),
]);

const child = spawn(nodePath, [serverPath], {
  cwd: projectRoot,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

let nextId = 1;
const pending = new Map();
let stdoutBuffer = "";

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  while (true) {
    const newline = stdoutBuffer.indexOf("\n");
    if (newline < 0) break;
    const line = stdoutBuffer.slice(0, newline).trim();
    stdoutBuffer = stdoutBuffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id === undefined) continue;
    const waiter = pending.get(message.id);
    if (!waiter) continue;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  }
});
child.on("exit", (code, signal) => {
  if (pending.size === 0) return;
  const error = new Error(
    `MCP server exited before responding (code ${String(code)}, signal ${String(signal)}). stderr:\n${stderr}`,
  );
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

function withTimeout(promise) {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for MCP server. stderr:\n${stderr}`));
    }, 10_000);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timeout));
}

try {
  await withTimeout(
    request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "bloxbot-devforum-smoke", version: "1.0.0" },
    }),
  );
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

  const result = await withTimeout(request("tools/list"));
  const tools = result.tools ?? [];
  const names = tools.map((tool) => tool.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_TOOLS)) {
    throw new Error(`Unexpected MCP tools: ${JSON.stringify(names)}`);
  }
  for (const tool of tools) {
    if (tool.inputSchema?.type !== "object") {
      throw new Error(`${tool.name} does not expose an object input schema`);
    }
    if (tool.annotations?.readOnlyHint !== true) {
      throw new Error(`${tool.name} is not marked read-only`);
    }
    if (!tool.description) {
      throw new Error(`${tool.name} is missing a description`);
    }
  }
  process.stdout.write(
    `Verified ${tools.length} roblox-devforum MCP tools with ${nodePath}\n`,
  );
} finally {
  child.stdin.end();
  child.kill();
}
