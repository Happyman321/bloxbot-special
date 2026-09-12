import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// MCP stdio uses newline JSON. Also accept Content-Length from older Studio builds.
export function framing(onMessage) {
  let buffer = Buffer.alloc(0);
  return chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length) {
      if (buffer.toString("utf8", 0, 15).toLowerCase().startsWith("content-length:")) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) return;
        const length = Number(/content-length:\s*(\d+)/i.exec(buffer.toString("utf8", 0, end))?.[1]);
        if (!Number.isSafeInteger(length) || length < 0) throw new Error("Invalid MCP frame");
        if (buffer.length < end + 4 + length) return;
        const body = buffer.subarray(end + 4, end + 4 + length);
        buffer = buffer.subarray(end + 4 + length);
        onMessage(JSON.parse(body.toString()), "headers");
      } else {
        const end = buffer.indexOf("\n");
        if (end < 0) return;
        const body = buffer.subarray(0, end).toString().trim();
        buffer = buffer.subarray(end + 1);
        if (body) onMessage(JSON.parse(body), "lines");
      }
    }
  };
}

export function capturePayload(result) {
  if (result?.isError) {
    const detail = (result.content ?? []).filter(item => item.type === "text").map(item => item.text).join(" ").slice(0, 500);
    throw new Error(detail || "Studio could not capture this change");
  }
  function find(value, depth = 0) {
    if (depth > 12 || value == null) return undefined;
    if (typeof value === "string") {
      try { const nested = find(JSON.parse(value), depth + 1); if (nested !== undefined) return nested; } catch {}
      const marker = "BLOXBOT_CAPTURE_JSON";
      const offset = value.indexOf(marker);
      if (offset >= 0) {
        const line = value.slice(offset + marker.length).split("\n")[0];
        try { return JSON.parse(line); } catch {}
      }
    } else if (typeof value === "object") {
      for (const entry of Object.values(value)) { const found = find(entry, depth + 1); if (found !== undefined) return found; }
    }
  }
  const data = find(result);
  if (data === undefined) throw new Error("Studio snapshot output was missing or truncated");
  return data;
}

export async function captureTool({ call, script, directory, name, args, invokeOriginal }) {
  const id = randomUUID();
  const run = async code => capturePayload(await call("execute_luau", { code }));
  const snapshot = action => run(script.replace("__TOKEN__", JSON.stringify(id)).replace("__ACTION__", JSON.stringify(action)));
  let baseline = false;
  let scope = "unavailable";
  let warning;
  try {
    scope = (await snapshot("begin")).scope;
    if (typeof scope !== "string" || !scope) throw new Error("Invalid Studio capture scope");
    baseline = true;
  }
  catch (error) { warning = `Before-state capture failed: ${error.message}`; }
  // Never retry a mutation, including when capture fails.
  let result, failure;
  try { result = await invokeOriginal(name, args); } catch (error) { failure = error; }
  let capture = { version: 1, scope, changes: [] };
  if (baseline) {
    try {
      const { length } = await snapshot("finish");
      if (!Number.isSafeInteger(length) || length < 0 || length > 32 * 1024 * 1024) throw new Error("Invalid capture size");
      const chunks = [];
      for (let offset = 1; offset <= length; offset += 1500) {
        // Hex transports bytes safely even when a chunk splits a UTF-8 character.
        const chunk = await run(`local s = shared.__BloxBotChangesV1; assert(s and s.pending and s.pending.token == ${JSON.stringify(id)}, "Capture lost"); local bytes = string.sub(s.pending.encoded, ${offset}, ${offset + 1499}); local hex = bytes:gsub(".", function(c) return string.format("%02x", string.byte(c)) end); print("BLOXBOT_CAPTURE_JSON" .. game:GetService("HttpService"):JSONEncode(hex))`);
        if (typeof chunk !== "string" || !/^(?:[0-9a-f]{2})*$/.test(chunk)) throw new Error("Invalid capture chunk");
        chunks.push(Buffer.from(chunk, "hex"));
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length !== length) throw new Error("Incomplete capture");
      capture = JSON.parse(bytes.toString("utf8"));
      // Luau omits nil object fields and encodes an empty table as an object.
      if (capture.version !== 1 || !capture.changes || typeof capture.changes !== "object") throw new Error("Invalid Studio capture");
      if (!Array.isArray(capture.changes) && Object.keys(capture.changes).length) throw new Error("Invalid changes list");
      capture.changes = Array.isArray(capture.changes) ? capture.changes.map(c => ({ ...c, before: c.before ?? null, after: c.after ?? null })) : [];
      if (capture.scope !== scope) throw new Error("Studio changed during capture");
    } catch (error) { warning = `After-state capture failed: ${error.message}`; capture = { version: 1, scope, changes: [] }; }
    finally {
      try { await call("execute_luau", { code: `local s = shared.__BloxBotChangesV1; if s and s.pending and s.pending.token == ${JSON.stringify(id)} then s.pending = nil end` }); }
      catch (error) { process.stderr.write(`Changes cleanup: ${error.message}\n`); }
    }
  }
  if (warning) capture.warning = warning;
  let marker;
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${id}.json`), JSON.stringify(capture), { flag: "wx" });
    marker = `[BloxBot capture: ${id}]`;
  } catch (error) { marker = `[BloxBot capture unavailable: ${error.message}]`; }
  if (failure) throw Object.assign(new Error(`${marker}\n${failure.message}`), { code: failure.code });
  return { ...result,
    ...(result?.structuredContent ? { structuredContent: { ...result.structuredContent, bloxbotCapture: marker } } : {}),
    content: [{ type: "text", text: marker }, ...(result?.content ?? [])] };
}

export async function main() {
  const [directory, commandJson] = process.argv.slice(2);
  const command = JSON.parse(commandJson);
  const script = await readFile(new URL("./snapshot.luau", import.meta.url), "utf8");
  const child = spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
  const pending = new Map();
  const tools = new Map();
  let serial = 0, queue = Promise.resolve(), parentFormat = "lines", childFormat = "lines", activeParent;
  const cancelled = new Set();
  const write = (stream, message, format) => {
    const body = JSON.stringify(message);
    stream.write(format === "headers" ? `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}` : `${body}\n`);
  };
  const send = message => write(process.stdout, message, parentFormat);
  const request = (method, params, timeout = 10 * 60 * 1000) => new Promise((resolve, reject) => {
    const id = `bloxbot-${++serial}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      write(child.stdin, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "Timed out" } }, childFormat);
      reject(new Error(`Studio ${method} timed out`));
    }, timeout);
    pending.set(id, { resolve, reject, timer, parent: activeParent });
    write(child.stdin, { jsonrpc: "2.0", id, method, params }, childFormat);
  });
  child.stdout.on("data", framing((message, format) => {
    childFormat = format;
    const waiter = pending.get(message.id);
    if (waiter && !message.method) {
      clearTimeout(waiter.timer); pending.delete(message.id);
      if (message.error) waiter.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      else waiter.resolve(message.result);
    } else send(message);
  }));
  const call = (name, args) => request("tools/call", { name, arguments: args }, 30_000);
  async function handle(message) {
    if (!message.method || message.id === undefined) { write(child.stdin, message, childFormat); return; }
    try {
      activeParent = message.id;
      if (cancelled.has(message.id)) throw new Error("Request cancelled");
      let result;
      if (message.method === "tools/call") {
        const { name, arguments: args = {} } = message.params;
        const readOnly = tools.get(name)?.annotations?.readOnlyHint === true || /^(list_roblox_studios|set_active_studio|get_studio_state|script_read|script_search|search_game_tree|inspect_instance|screen_capture|http_get|start_stop_play|start_playtest|stop_playtest)$/.test(name);
        result = readOnly || !tools.has("execute_luau") ? await request(message.method, message.params)
          : await captureTool({ call, script, directory, name, args,
            invokeOriginal: () => {
              if (cancelled.has(message.id)) throw new Error("Request cancelled");
              return request(message.method, message.params);
            } });
      } else {
        result = await request(message.method, message.params);
        if (message.method === "tools/list") for (const tool of result.tools ?? []) tools.set(tool.name, tool);
      }
      send({ jsonrpc: "2.0", id: message.id, result });
    } catch (error) { send({ jsonrpc: "2.0", id: message.id, error: { code: error.code ?? -32603, message: error.message } }); }
    finally { activeParent = undefined; cancelled.delete(message.id); }
  }
  process.stdin.on("data", framing((message, format) => {
    parentFormat = format;
    if (message.method === "notifications/cancelled") {
      cancelled.add(message.params?.requestId);
      for (const [id, waiter] of pending) if (waiter.parent === message.params?.requestId) {
        write(child.stdin, { ...message, params: { ...message.params, requestId: id } }, childFormat);
      }
      return;
    }
    // Client replies/progress must bypass the queue to avoid deadlocking a tool.
    if (!message.method || message.id === undefined) { write(child.stdin, message, childFormat); return; }
    queue = queue.then(() => handle(message)).catch(error => process.stderr.write(`${error.stack}\n`));
  }));
  child.on("error", error => { process.stderr.write(`${error.message}\n`); process.exit(1); });
  child.on("exit", code => process.exit(code ?? 1));
  process.stdin.on("end", () => { child.kill(); });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
