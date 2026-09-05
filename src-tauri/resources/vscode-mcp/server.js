#!/usr/bin/env node

const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const bridgeUrl = process.env.BLOXBOT_VSCODE_BRIDGE_URL || "http://127.0.0.1:59300";
const bridgeToken = process.env.BLOXBOT_VSCODE_BRIDGE_TOKEN || "";

let inputBuffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  drainInput();
});

function drainInput() {
  while (true) {
    // MCP stdio uses one JSON message per line, including notifications.
    const end = inputBuffer.indexOf("\n");
    if (end < 0) return;
    const body = inputBuffer.subarray(0, end).toString("utf8").trim();
    inputBuffer = inputBuffer.subarray(end + 1);
    if (!body) continue;
    handleMessage(body).catch((error) => {
      log(`Unhandled message error: ${error.stack || error}`);
    });
  }
}

async function handleMessage(raw) {
  const message = JSON.parse(raw);
  if (message.id === undefined || message.id === null) return;

  try {
    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "bloxbot-vscode", version: "0.1.0" },
        },
      });
      return;
    }

    if (message.method === "tools/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { tools } });
      return;
    }

    if (message.method === "tools/call") {
      const { name, arguments: args = {} } = message.params || {};
      const result = await callTool(name, args);
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: result }] },
      });
      return;
    }

    send({ jsonrpc: "2.0", id: message.id, result: {} });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32000, message: String(error.message || error) },
    });
  }
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function log(message) {
  process.stderr.write(`[bloxbot-vscode-mcp] ${message}\n`);
}

const tools = [
  {
    name: "vscode_list_files",
    description: "List files under the configured VS Code workspace folder.",
    inputSchema: {
      type: "object",
      properties: {
        workspacePath: { type: "string" },
        relativePath: { type: "string" },
        maxDepth: { type: "number" },
      },
      required: ["workspacePath"],
    },
  },
  {
    name: "vscode_read_file",
    description: "Read a UTF-8 text file under the configured VS Code workspace folder.",
    inputSchema: {
      type: "object",
      properties: {
        workspacePath: { type: "string" },
        relativePath: { type: "string" },
      },
      required: ["workspacePath", "relativePath"],
    },
  },
  {
    name: "vscode_search_files",
    description: "Search file names and text under the configured VS Code workspace folder.",
    inputSchema: {
      type: "object",
      properties: {
        workspacePath: { type: "string" },
        query: { type: "string" },
        maxResults: { type: "number" },
      },
      required: ["workspacePath", "query"],
    },
  },
  {
    name: "vscode_propose_file_changes",
    description:
      "Send complete proposed file contents to the VS Code companion for review and approval.",
    inputSchema: {
      type: "object",
      properties: {
        workspacePath: { type: "string" },
        summary: { type: "string" },
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              relativePath: { type: "string" },
              content: { type: "string" },
            },
            required: ["relativePath", "content"],
          },
        },
      },
      required: ["workspacePath", "summary", "changes"],
    },
  },
];

async function callTool(name, args) {
  if (name === "vscode_list_files") return listFiles(args);
  if (name === "vscode_read_file") return readFile(args);
  if (name === "vscode_search_files") return searchFiles(args);
  if (name === "vscode_propose_file_changes") return proposeFileChanges(args);
  throw new Error(`Unknown tool: ${name}`);
}

function resolveInside(workspacePath, relativePath = ".") {
  if (!workspacePath || typeof workspacePath !== "string") {
    throw new Error("workspacePath is required");
  }
  const root = path.resolve(workspacePath);
  const target = path.resolve(root, relativePath || ".");
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }
  return { root, target };
}

function shouldSkip(name) {
  return [".git", "node_modules", "dist", "build", ".next", ".turbo", "target"].includes(name);
}

async function listFiles(args) {
  const { root, target } = resolveInside(args.workspacePath, args.relativePath || ".");
  const maxDepth = Number.isFinite(args.maxDepth) ? Math.max(0, Math.min(args.maxDepth, 8)) : 4;
  const files = [];

  async function walk(dir, depth) {
    if (depth > maxDepth || files.length >= 500) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldSkip(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        files.push(`${rel}/`);
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        files.push(rel);
      }
      if (files.length >= 500) break;
    }
  }

  await walk(target, 0);
  return files.join("\n") || "(no files)";
}

async function readFile(args) {
  const { target } = resolveInside(args.workspacePath, args.relativePath);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("Target is not a file");
  if (stat.size > 1024 * 1024) throw new Error("File is too large to read through this tool");
  return fs.readFile(target, "utf8");
}

async function searchFiles(args) {
  const { root } = resolveInside(args.workspacePath, ".");
  const query = String(args.query || "").toLowerCase();
  if (!query) throw new Error("query is required");
  const maxResults = Number.isFinite(args.maxResults)
    ? Math.max(1, Math.min(args.maxResults, 100))
    : 50;
  const results = [];

  async function walk(dir, depth) {
    if (depth > 8 || results.length >= maxResults) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldSkip(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (entry.name.toLowerCase().includes(query)) {
          results.push(`${rel}: filename match`);
        } else {
          await maybeSearchFile(full, rel, query, results, maxResults);
        }
      }
      if (results.length >= maxResults) break;
    }
  }

  await walk(root, 0);
  return results.join("\n") || "(no matches)";
}

async function maybeSearchFile(full, rel, query, results, maxResults) {
  const ext = path.extname(full).toLowerCase();
  if (
    ![
      ".lua",
      ".luau",
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".json",
      ".md",
      ".txt",
      ".css",
      ".html",
      ".rs",
      ".toml",
      ".yml",
      ".yaml",
    ].includes(ext)
  ) {
    return;
  }
  const stat = await fs.stat(full);
  if (stat.size > 256 * 1024) return;
  const text = await fs.readFile(full, "utf8").catch(() => "");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].toLowerCase().includes(query)) {
      results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 180)}`);
      if (results.length >= maxResults) return;
    }
  }
}

async function proposeFileChanges(args) {
  if (!bridgeToken) {
    throw new Error("BloxBot VS Code bridge token is missing");
  }
  const workspacePath = String(args.workspacePath || "");
  const summary = String(args.summary || "Proposed VS Code workspace changes");
  const changes = Array.isArray(args.changes) ? args.changes : [];
  if (changes.length === 0) throw new Error("changes must include at least one file");

  for (const change of changes) {
    resolveInside(workspacePath, change.relativePath);
    if (typeof change.content !== "string") {
      throw new Error(`Change for ${change.relativePath} is missing string content`);
    }
  }

  const create = await bridgeRequest("POST", "/proposals", {
    workspacePath,
    summary,
    changes,
  });
  const id = create.id;
  if (!id) throw new Error("Bridge did not return a proposal id");

  for (let attempt = 0; attempt < 600; attempt += 1) {
    await sleep(1000);
    const status = await bridgeRequest("GET", `/proposals/${encodeURIComponent(id)}`);
    const proposal = status.proposal;
    if (!proposal) continue;
    if (proposal.status === "approved") {
      return proposal.result || `Approved and applied in VS Code: ${id}`;
    }
    if (proposal.status === "denied") {
      return proposal.result || `Denied in VS Code: ${id}`;
    }
    if (proposal.status !== "pending") {
      return proposal.result || `VS Code proposal ${id} finished with status ${proposal.status}`;
    }
  }

  throw new Error(`Timed out waiting for VS Code approval: ${id}`);
}

function bridgeRequest(method, requestPath, body) {
  const url = new URL(requestPath, bridgeUrl);
  url.searchParams.set("token", bridgeToken);
  const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : null;

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: payload
          ? { "content-type": "application/json", "content-length": String(payload.length) }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = {};
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch (error) {
            reject(new Error(`Invalid bridge JSON: ${text}`));
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(parsed.error || `Bridge returned HTTP ${res.statusCode}`));
            return;
          }
          resolve(parsed);
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
