[CmdletBinding()]
param(
  [string]$Version = "1.18.27",
  [string]$BunPath = "bun",
  [string]$PythonPath = $env:PYTHON,
  [switch]$KeepSource
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$patches = @(
  (Join-Path $repoRoot "patches\\opencode\\$Version-title-model-routing.patch"),
  (Join-Path $repoRoot "patches\\opencode\\$Version-studio-picker.patch"),
  (Join-Path $repoRoot "patches\\opencode\\$Version-astra.patch")
)
$source = Join-Path $env:TEMP "bloxbot-opencode-$Version"
$tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
$source = [IO.Path]::GetFullPath($source)
if ($Version -notmatch '^\d+\.\d+\.\d+$' -or !$source.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Invalid OpenCode version or temporary source path: $source"
}
$binary = Join-Path $repoRoot "src-tauri\\binaries\\opencode-x86_64-pc-windows-msvc.exe"
$bunCommand = (Get-Command $BunPath -ErrorAction Stop).Source
$bunDirectory = Split-Path -Parent $bunCommand
if ($PythonPath) {
  $pythonCommand = (Get-Command $PythonPath -ErrorAction Stop).Source
  $env:PYTHON = $pythonCommand
  $env:npm_config_python = $pythonCommand
}

function Assert-NativeSuccess([string]$Action) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Action failed with exit code $LASTEXITCODE"
  }
}

foreach ($patch in $patches) {
  if (!(Test-Path $patch)) {
    throw "Missing BloxBot OpenCode patch for v${Version}: $patch"
  }
}

if (Test-Path $source) {
  Remove-Item -LiteralPath $source -Recurse -Force
}

git clone --depth 1 --branch "v$Version" https://github.com/anomalyco/opencode.git $source
Assert-NativeSuccess "Cloning OpenCode v$Version"
Push-Location $source
try {
  foreach ($patch in $patches) {
    git apply --check $patch
    Assert-NativeSuccess "Checking BloxBot OpenCode patch $patch"
    git apply $patch
    Assert-NativeSuccess "Applying BloxBot OpenCode patch $patch"
  }
  $env:PATH = "$bunDirectory;$env:PATH"
  $env:OPENCODE_VERSION = $Version
  & $bunCommand install --frozen-lockfile
  Assert-NativeSuccess "Installing OpenCode dependencies"
  & $bunCommand --cwd packages/opencode test test/plugin/codex.test.ts test/provider/transform.test.ts test/session/title-model-routing.test.ts test/server/httpapi-mcp-oauth.test.ts
  Assert-NativeSuccess "Testing OpenCode OAuth models, title routing, and Studio picker bridge"
  & $bunCommand run --cwd packages/opencode build -- --single --skip-install --skip-embed-web-ui
  Assert-NativeSuccess "Building the OpenCode Windows x64 sidecar"

  $built = Join-Path $source "packages\\opencode\\dist\\opencode-windows-x64\\bin\\opencode.exe"
  if (!(Test-Path $built)) {
    throw "OpenCode did not produce the expected Windows x64 sidecar: $built"
  }

  Copy-Item -Force $built $binary
  $reportedVersion = (& $binary --version | Out-String).Trim()
  Assert-NativeSuccess "Reading the built OpenCode version"
  if ($reportedVersion -ne $Version) {
    throw "Built OpenCode reported $reportedVersion instead of $Version"
  }
  Write-Host $reportedVersion
} finally {
  Pop-Location
  if (!$KeepSource -and (Test-Path $source)) {
    Remove-Item -LiteralPath $source -Recurse -Force
  }
}
