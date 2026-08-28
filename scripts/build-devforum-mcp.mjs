import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const EXPECTED_VERSION = "1.0.2";
const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryPath = require.resolve("roblox-devforum-mcp");
const packageRoot = path.resolve(path.dirname(entryPath), "..");
const manifestPath = path.join(packageRoot, "package.json");
const licensePath = path.join(packageRoot, "LICENSE");
const outputDir = path.join(projectRoot, "src-tauri", "resources", "devforum-mcp");
const outputPath = path.join(outputDir, "server.mjs");
const licensesDir = path.join(outputDir, "licenses");

async function findPackageRoot(resolvedPath, packageName) {
  let directory = path.dirname(resolvedPath);
  while (true) {
    try {
      const candidate = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
      if (candidate.name === packageName) return directory;
    } catch {
      // Keep walking until the package manifest is found.
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`Could not find the package root for ${packageName}`);
    }
    directory = parent;
  }
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.version !== EXPECTED_VERSION) {
  throw new Error(
    `Expected roblox-devforum-mcp ${EXPECTED_VERSION}, found ${String(manifest.version)}`,
  );
}

await mkdir(outputDir, { recursive: true });
await mkdir(licensesDir, { recursive: true });
await build({
  entryPoints: [entryPath],
  outfile: outputPath,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: false,
  legalComments: "eof",
  logLevel: "warning",
});
await copyFile(licensePath, path.join(outputDir, "LICENSE"));
const packageRequire = createRequire(entryPath);
for (const [packageName, resolutionName, outputName] of [
  [
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/server/mcp.js",
    "modelcontextprotocol-sdk.LICENSE",
  ],
  ["zod", "zod", "zod.LICENSE"],
]) {
  const dependencyRoot = await findPackageRoot(
    packageRequire.resolve(resolutionName),
    packageName,
  );
  await copyFile(
    path.join(dependencyRoot, "LICENSE"),
    path.join(licensesDir, outputName),
  );
}

process.stdout.write(`Bundled roblox-devforum-mcp ${EXPECTED_VERSION} to ${outputPath}\n`);
