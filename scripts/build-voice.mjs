import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "src-tauri/resources/voice");
const packageRoot = path.dirname(require.resolve("sherpa-onnx-node/package.json"));
const engineRequire = createRequire(path.join(packageRoot, "package.json"));
const platform = process.platform === "win32" ? "win" : process.platform;
const nativeName = `sherpa-onnx-${platform}-${process.arch}`;
const nativeRoot = path.dirname(engineRequire.resolve(`${nativeName}/package.json`));
for (const [name, directory] of [["sherpa-onnx-node", packageRoot], [nativeName, nativeRoot]]) {
  const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  if (manifest.version !== "1.13.8") throw new Error(`Unexpected ${name} version: ${manifest.version}`);
  await cp(directory, path.join(output, "node_modules", name), {
    recursive: true, dereference: true,
    // Loaded Windows DLLs cannot be replaced. Also avoid triggering dev watchers
    // just because the same runtime is bundled a second time.
    filter: async (source, destination) => {
      if ((await stat(source)).isDirectory()) return true;
      const existing = await readFile(destination).catch(() => null);
      return !existing || !existing.equals(await readFile(source));
    },
  });
}

const revision = "52056fdc070914a48dcd68b31b44d6a6f5b85902";
const modelUrl = `https://huggingface.co/csukuangfj2/sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25/resolve/${revision}`;
const models = [
  ["encoder.int8.onnx", "encoder.onnx", "7d932213491ad355c6e5576705dc3494731a52af87d7a1b954559340147909d8"],
  ["decoder.int8.onnx", "decoder.onnx", "0be9702c2f427a2b6bb241d298e0d3836a558de1f5b9fd3018f1cce6e2b3fa98"],
  ["joiner.int8.onnx", "joiner.onnx", "a35eac38a22ebceb04d230ed7afe0d68f446ba6914a036b97f14fece95967e23"],
  ["tokens.txt", "tokens.txt", "dc0b4584ab2e4ddbf888425c076c61b736e7356a015250db7d307e6f1a8188ff"],
  ["README.md", "MODEL.md", "ff55e0c15ea58f392f153e63a805e902b7836dce9ecf22634eb30f50a9dd6f4c"],
];
await mkdir(path.join(output, "model"), { recursive: true });
for (const [source, name, digest] of models) {
  const destination = path.join(output, "model", name);
  const hash = (data) => createHash("sha256").update(data).digest("hex");
  const existing = await readFile(destination).catch(() => null);
  if (existing && (digest ? hash(existing) === digest : existing.length > 0)) continue;
  console.log(`Downloading speech model asset: ${name}`);
  const response = await fetch(`${modelUrl}/${source}`, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Speech model download failed: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (digest && hash(data) !== digest) throw new Error(`Speech model checksum mismatch: ${name}`);
  await writeFile(`${destination}.partial`, data);
  await rename(`${destination}.partial`, destination);
}
const licensePath = path.join(output, "LICENSE");
if (!(await readFile(licensePath).catch(() => null))) {
  const response = await fetch("https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v1.13.8/LICENSE");
  if (!response.ok) throw new Error("Unable to fetch speech engine license");
  await writeFile(licensePath, await response.text());
}
console.log("Bundled local streaming voice engine and English model.");
