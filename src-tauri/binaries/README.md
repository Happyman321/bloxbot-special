Place platform-specific sidecar binaries here with target-triple suffixes.

Get your target triple: `rustc --print host-tuple`

Required binaries:

- `opencode-<target-triple>` (from https://opencode.ai)

Example for Apple Silicon Mac:

- `opencode-aarch64-apple-darwin`

## Download Instructions

### OpenCode

Download from https://github.com/anomalyco/opencode/releases

### BloxBot title-routing build

BloxBot carries a small patch for its pinned OpenCode version so auto-generated
chat titles use lightweight models without changing the visible chat request:

- OpenAI titles use `gpt-5.6-luna-fast`.
- xAI titles use `grok-4.5`.

Run `powershell -ExecutionPolicy Bypass -File scripts/build-opencode-sidecar.ps1`
from the repository root to rebuild the Windows sidecar (requires Bun 1.3.14 on
`PATH`). The script checks that the matching versioned patch applies before
replacing the local binary. It builds OpenCode's regular Windows x64 binary;
the upstream baseline variant needs a second Bun runtime download and is not
needed for BloxBot's title routing. When upgrading OpenCode, add and review a
patch for the new version first.

## Node.js Runtime

Node.js is bundled as a resource (not a sidecar) in `resources/nodejs/`.
It includes the full Node.js runtime with npm and npx.

For local development, download from https://nodejs.org and extract to:
`src-tauri/resources/nodejs/` maintaining the `bin/` and `lib/` structure.

Example for macOS ARM64:
```bash
curl -fsSL https://nodejs.org/dist/v22.13.1/node-v22.13.1-darwin-arm64.tar.gz | tar -xz
mkdir -p ../resources/nodejs
cp -R node-v22.13.1-darwin-arm64/bin ../resources/nodejs/
mkdir -p ../resources/nodejs/lib/node_modules
cp -R node-v22.13.1-darwin-arm64/lib/node_modules/npm ../resources/nodejs/lib/node_modules/
rm -rf node-v22.13.1-darwin-arm64
```

These files are listed in `.gitignore` and not committed to the repository.
Tauri bundles them via the `externalBin` and `resources` config.
