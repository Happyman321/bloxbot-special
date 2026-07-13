[CmdletBinding()]
param(
  [string]$Version = "1.17.18",
  [string]$BunPath = "bun",
  [switch]$KeepSource
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$patch = Join-Path $repoRoot "patches\\opencode\\$Version-title-model-routing.patch"
$source = Join-Path $env:TEMP "bloxbot-opencode-$Version"
$binary = Join-Path $repoRoot "src-tauri\\binaries\\opencode-x86_64-pc-windows-msvc.exe"
$bunCommand = (Get-Command $BunPath -ErrorAction Stop).Source
$bunDirectory = Split-Path -Parent $bunCommand

if (!(Test-Path $patch)) {
  throw "No BloxBot OpenCode title-routing patch exists for v$Version: $patch"
}

if (Test-Path $source) {
  Remove-Item -Recurse -Force $source
}

git clone --depth 1 --branch "v$Version" https://github.com/anomalyco/opencode.git $source
Push-Location $source
try {
  git apply --check $patch
  git apply $patch
  $env:PATH = "$bunDirectory;$env:PATH"
  $env:OPENCODE_VERSION = $Version
  & $bunCommand install --frozen-lockfile
  & $bunCommand run --cwd packages/opencode build -- --single --skip-install

  $built = Join-Path $source "packages\\opencode\\dist\\opencode-windows-x64\\bin\\opencode.exe"
  if (!(Test-Path $built)) {
    throw "OpenCode did not produce the expected Windows x64 sidecar: $built"
  }

  Copy-Item -Force $built $binary
  & $binary --version
} finally {
  Pop-Location
  if (!$KeepSource -and (Test-Path $source)) {
    Remove-Item -Recurse -Force $source
  }
}
