import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import readline from "node:readline";

const require = createRequire(import.meta.url);
const { readWave } = require("sherpa-onnx-node");
const fixture = path.resolve(".tmp-voice-test/0.wav");
const expectedHash = "6bc58a4efdf20daac252b6b1502632601a71efe0308f6757dc1eda34891a7e4f";
await mkdir(path.dirname(fixture), { recursive: true });
let data = await readFile(fixture).catch(() => null);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (!data || hash(data) !== expectedHash) {
  const url = "https://huggingface.co/csukuangfj2/sherpa-onnx-nemotron-speech-streaming-en-0.6b-160ms-int8-2026-04-25/resolve/237e551abd7a411ef92d3595454d9f6ab5fe7d6c/test_wavs/0.wav";
  const response = await fetch(url);
  assert.ok(response.ok, `Speech fixture download: HTTP ${response.status}`);
  data = Buffer.from(await response.arrayBuffer());
  assert.equal(hash(data), expectedHash);
  await writeFile(fixture, data);
}
const worker = spawn(process.env.VOICE_NODE || process.execPath, [process.env.VOICE_WORKER || "src-tauri/resources/voice/worker.cjs"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
const lines = readline.createInterface({ input: worker.stdout })[Symbol.asyncIterator]();
let diagnostics = "";
worker.stderr.on("data", (data) => { diagnostics = (diagnostics + data).slice(-4000); });
async function read() {
  let timer;
  try {
    const line = await Promise.race([lines.next(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Voice worker timed out")), 15000); })]);
    assert.ok(!line.done, `Voice worker exited: ${diagnostics}`);
    return JSON.parse(line.value);
  } finally { clearTimeout(timer); }
}
async function request(value) { worker.stdin.write(`${JSON.stringify(value)}\n`); return read(); }
try {
  assert.equal((await read()).ready, true);
  const wave = readWave(fixture);
  const expected = "after early nightfall the yellow lamps would light up here and there the squalid quarter of the brothels";
  const normalize = (text) => text.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  for (const session of ["first", "second"]) {
    await request({ op: "start", session });
    // A late cleanup from another session must not cancel the current recording.
    await request({ op: "cancel", session: "stale" });
    const started = performance.now();
    let text = "";
    let partials = 0;
    let firstPartialAudioSeconds;
    const audioRequestTimes = [];
    for (let i = 0; i < wave.samples.length; i += 2048) {
      const requestStarted = performance.now();
      const result = await request({ op: "audio", session, sampleRate: wave.sampleRate, samples: Array.from(wave.samples.subarray(i, i + 2048)) });
      audioRequestTimes.push(performance.now() - requestStarted);
      assert.ok(!result.error, result.error);
      if (result.partial) {
        partials++;
        firstPartialAudioSeconds ??= Math.min(i + 2048, wave.samples.length) / wave.sampleRate;
      }
      if (result.finalText) text += ` ${result.finalText}`;
    }
    const final = await request({ op: "finish", session });
    text += ` ${final.finalText}`;
    assert.equal(normalize(text), expected);
    assert.ok(partials > 1, "Expected live partial text before recording ends");
    console.log(`${session}: ${partials} partial updates; ${(wave.samples.length / wave.sampleRate).toFixed(2)}s human speech decoded in ${((performance.now() - started) / 1000).toFixed(2)}s, transcript matches reference.`);
    audioRequestTimes.sort((a, b) => a - b);
    console.log(`First partial at ${firstPartialAudioSeconds.toFixed(3)}s of input audio; p95 audio request ${audioRequestTimes[Math.floor(audioRequestTimes.length * 0.95)].toFixed(1)}ms.`);
  }
  await request({ op: "start", session: "silence" });
  await request({ op: "audio", session: "silence", sampleRate: 16000, samples: Array(16000).fill(0) });
  assert.equal((await request({ op: "finish", session: "silence" })).finalText, "");
  console.log("Silence produces no invented text; repeated sessions and stale cancellation passed.");
  await request({ op: "start", session: "pauses" });
  let longText = "";
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < wave.samples.length; i += 2048) {
      const result = await request({ op: "audio", session: "pauses", sampleRate: wave.sampleRate, samples: Array.from(wave.samples.subarray(i, i + 2048)) });
      assert.ok(!result.error, result.error);
      if (result.finalText) longText += ` ${result.finalText}`;
    }
    for (let i = 0; i < 32; i++) {
      const result = await request({ op: "audio", session: "pauses", sampleRate: 16000, samples: Array(2048).fill(0) });
      assert.ok(!result.error, result.error);
      if (result.finalText) longText += ` ${result.finalText}`;
    }
    console.log(`Long recording: speech/pause cycle ${round + 1} passed.`);
  }
  const longFinal = await request({ op: "finish", session: "pauses" });
  assert.ok(!longFinal.error);
  longText += ` ${longFinal.finalText}`;
  const actualWords = normalize(longText).split(" ");
  const expectedWords = Array(4).fill(expected).join(" ").split(" ");
  // Endpoint context can change individual ASR words. Check bounded word error
  // as well as every sentence boundary so lost utterances still fail this test.
  let distances = Array.from({ length: expectedWords.length + 1 }, (_, i) => i);
  for (let i = 0; i < actualWords.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < expectedWords.length; j++) {
      next.push(Math.min(next[j] + 1, distances[j + 1] + 1,
        distances[j] + (actualWords[i] === expectedWords[j] ? 0 : 1)));
    }
    distances = next;
  }
  const wordErrorRate = distances[expectedWords.length] / expectedWords.length;
  assert.ok(wordErrorRate <= 0.05, `Long recording lost or changed too many words: ${longText}`);
  assert.equal(normalize(longText).match(/after early nightfall/g)?.length, 4);
  assert.equal(normalize(longText).match(/quarter of the brothels/g)?.length, 4);
  console.log(`Four speech/pause cycles retained all sentence boundaries; word error ${(wordErrorRate * 100).toFixed(1)}%.`);
} finally {
  worker.stdin.end();
  worker.kill();
}
