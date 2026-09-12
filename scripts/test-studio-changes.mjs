import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { capturePayload, captureTool, framing } from "../src-tauri/resources/studio-changes/proxy.mjs";

test("MCP framing handles split headers, newlines, UTF-8 and request ID zero", () => {
  const messages = [];
  const parse = framing(message => messages.push(message));
  const body = JSON.stringify({ id: 0, result: "🍎" });
  const bytes = Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}\n${body}\n`);
  for (const byte of bytes) parse(Buffer.from([byte]));
  assert.deepEqual(messages, [{ id: 0, result: "🍎" }, { id: 0, result: "🍎" }]);
});

test("capture payload unwraps native MCP output and rejects truncation", () => {
  const result = { content: [{ type: "text", text: JSON.stringify({ output: "BLOXBOT_CAPTURE_JSON{\"length\":52}\n" }) }] };
  assert.deepEqual(capturePayload(result), { length: 52 });
  assert.throws(() => capturePayload({ content: [{ text: "BLOXBOT_CAPTURE_JSON{\"length\":" }] }));
  assert.throws(() => capturePayload({ isError: true }));
});

async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "bloxbot-changes-"));
  const capture = { version: 1, scope: "studio-1", changes: [{ id: "1", after: { id: "1", path: "game/Workspace/🍎", className: "Script", source: "🍎".repeat(1100), properties: {} } }] };
  const encoded = Buffer.from(JSON.stringify(capture));
  let mutations = 0, cleanup = 0;
  const payload = value => ({ content: [{ type: "text", text: `BLOXBOT_CAPTURE_JSON${JSON.stringify(value)}` }] });
  const call = async (_name, { code }) => {
    if (code.includes('"begin"')) {
      if (options.failBefore) throw new Error("Disconnected");
      return payload({ scope: "studio-1" });
    }
    if (code.includes('"finish"')) {
      if (options.failAfter) throw new Error("Lost baseline");
      return payload({ length: encoded.length });
    }
    const chunk = /string.sub\(s.pending.encoded, (\d+), (\d+)\)/.exec(code);
    if (chunk) return payload(encoded.subarray(Number(chunk[1]) - 1, Number(chunk[2])).toString("hex"));
    cleanup++;
    return { content: [] };
  };
  try {
    let result, error;
    try {
      result = await captureTool({ call, directory, script: "__TOKEN__ __ACTION__", name: "multi_edit", args: {},
        invokeOriginal: async () => { mutations++; if (options.failTool) throw new Error("Partial edit failed"); return { content: [{ type: "text", text: "Edited" }] }; } });
    } catch (e) { error = e; }
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    return { result, error, saved: JSON.parse(await readFile(path.join(directory, files[0]), "utf8")), mutations, cleanup, expected: capture };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("saves paged unicode snapshots and attaches a small durable reference", async () => {
  const { result, saved, expected, mutations, cleanup } = await fixture();
  assert.equal(mutations, 1);
  assert.equal(cleanup, 1);
  assert.deepEqual(saved.changes[0], { ...expected.changes[0], before: null });
  assert.match(result.content[0].text, /^\[BloxBot capture: [0-9a-f-]+\]$/);
  assert.equal(result.content[1].text, "Edited");
});
test("capture failure never blocks or repeats the original edit", async () => {
  for (const options of [{ failBefore: true }, { failAfter: true }]) {
    const { result, saved, mutations } = await fixture(options);
    assert.equal(mutations, 1);
    assert.equal(result.content[1].text, "Edited");
    assert.ok(saved.warning);
    assert.deepEqual(saved.changes, []);
  }
});
test("partial failed edits retain their snapshots and error", async () => {
  const { saved, error, mutations } = await fixture({ failTool: true });
  assert.equal(mutations, 1);
  assert.equal(saved.changes.length, 1);
  assert.match(error.message, /BloxBot capture:.*\nPartial edit failed/);
});

test("the bundled proxy launches and completes a real stdio round trip", { timeout: 15000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bloxbot-proxy-"));
  const fake = path.join(directory, "studio.mjs");
  await writeFile(fake, `
    import { createInterface } from 'node:readline';
    const capture = JSON.stringify({version: 1, scope: 'native', changes: []});
    for await (const line of createInterface({input: process.stdin})) {
      const m = JSON.parse(line); if (m.id === undefined) continue;
      let result = {};
      const payload = value => ({content:[{type:'text',text:'BLOXBOT_CAPTURE_JSON'+JSON.stringify(value)}]});
      if (m.method === 'initialize') result = {protocolVersion:'2024-11-05', capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}};
      if (m.method === 'tools/list') result = {tools:[{name:'execute_luau'}, {name:'multi_edit'}]};
      if (m.method === 'tools/call') {
        const code = m.params.arguments.code || '';
        if (code.includes('local action = "begin"')) result = payload({scope:'native'});
        else if (code.includes('local action = "finish"')) result = payload({length:Buffer.byteLength(capture)});
        else if (code.includes('local bytes =')) result = payload(Buffer.from(capture).toString('hex'));
        else result = {content:[{type:'text',text:'OK'}]};
      }
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
    }
  `);
  const proxy = fileURLToPath(new URL("../src-tauri/resources/studio-changes/proxy.mjs", import.meta.url));
  const child = spawn(process.execPath, [proxy, path.join(directory, "captures"), JSON.stringify([process.execPath, fake])], { windowsHide: true });
  const waiters = new Map();
  let stderr = "";
  child.stderr.on("data", data => { stderr += data; });
  child.stdout.on("data", framing(message => { const resolve = waiters.get(message.id); if (resolve) { waiters.delete(message.id); resolve(message); } }));
  const request = (id, method, params = {}) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Proxy timeout: ${stderr}`)), 5000);
    waiters.set(id, message => { clearTimeout(timeout); resolve(message); });
    child.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params}) + "\n");
  });
  try {
    assert.equal((await request(0, "initialize")).result.serverInfo.name, "fake");
    assert.equal((await request("list", "tools/list")).result.tools.length, 2);
    const response = await request("edit", "tools/call", { name: "multi_edit", arguments: {} });
    assert.match(response.result.content[0].text, /BloxBot capture:/);
    const [file] = await readdir(path.join(directory, "captures"));
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, "captures", file), "utf8")), {version:1,scope:"native",changes:[]});
  } finally {
    child.stdin.end();
    await new Promise(resolve => child.once("exit", resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
