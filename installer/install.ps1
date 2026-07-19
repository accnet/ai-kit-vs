<#
  Global AI-Kit installer (Windows, PowerShell).
  Installs the shared runtime, knowledge, and config into C:\Users\<user>\ai-kit
  and creates launchers for the CLI, workers, gates, and plugins. Per-project
  .ai-work\.
#>
[CmdletBinding()]
param(
  [string]$Home_ = $(if ($env:AIKIT_HOME) { $env:AIKIT_HOME } else { Join-Path $env:USERPROFILE "ai-kit" }),
  [switch]$Force,
  [switch]$DryRun,
  [switch]$NoDeps
)
$ErrorActionPreference = "Stop"

$InstallerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Source = (Resolve-Path (Join-Path $InstallerDir "..")).Path
$Target = $Home_
. (Join-Path $InstallerDir "lib.ps1")

# --- Preflight: require Node >= 22. ---
Assert-AiKitNode

# Shared runtime + knowledge + config that belong in the global home.
$Payload = @("AGENTS.md", "CLAUDE.md", "GEMINI.md", "README.md", "package.json", "tsconfig.json", ".prettierrc.json", ".ai", ".githooks")
$Exclude = @("node_modules", ".ai-work", ".git")

Write-Host "AI-Kit installer"
Write-Host "  source: $Source"
Write-Host "  target: $Target"

if ((Test-Path (Join-Path $Target ".ai")) -and (-not $Force) -and (-not $DryRun)) {
  Write-Error "An install already exists at $Target. Use -Force to replace it."; exit 1
}
if ($DryRun) {
  Write-Host "[dry-run] would copy: $($Payload -join ', ')"
  Write-Host "[dry-run] would create home skeleton and bin\ai-kit.cmd launcher"
  exit 0
}

New-Item -ItemType Directory -Force -Path $Target | Out-Null

# Recursive copy that skips excluded directories anywhere in the tree.
function Copy-Payload($item) {
  $src = Join-Path $Source $item
  if (-not (Test-Path $src)) { return }
  robocopy $src (Join-Path $Target $item) /MIR /XD $Exclude /NFL /NDL /NJH /NJS /NP | Out-Null
}
foreach ($item in $Payload) {
  if (Test-Path (Join-Path $Source $item) -PathType Container) { Copy-Payload $item }
  else { Copy-Item (Join-Path $Source $item) (Join-Path $Target $item) -Force }
}

# Flat home skeleton for user extensions.
foreach ($dir in @("plugins", "prompts", "workflows", "models", "templates", "config", "cache", "logs", "bin")) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Target $dir) | Out-Null
}

# --- Launchers: keep runtime files in the home and project state in the CWD. ---
function Write-Launcher($name, $target) {
  $launcher = Join-Path $Target "bin\$name.cmd"
  @"
@echo off
setlocal
set "HOME_DIR=%~dp0.."
if "%AIKIT_HOME%"=="" set "AIKIT_HOME=%HOME_DIR%"
if "%AIKIT_ROOT%"=="" set "AIKIT_ROOT=%HOME_DIR%"
if "%AIKIT_PROJECT_ROOT%"=="" set "AIKIT_PROJECT_ROOT=%CD%"
if "%AIKIT_WORK%"=="" set "AIKIT_WORK=%CD%\.ai-work"
node "%HOME_DIR%\.ai\node\node_modules\tsx\dist\cli.mjs" "%HOME_DIR%\.ai\node\$target" %*
"@ | Set-Content -Encoding ascii $launcher
}
Write-Launcher "ai-kit" "ai-kit.ts"
Write-Launcher "ai-kit-worker" "worker-manager.ts"
Write-Launcher "ai-kit-gate" "gate-runner.ts"
Write-Launcher "ai-kit-plugin" "run-plugin.ts"

# --- Node runtime dependencies (esbuild binary is per-platform). ---
if (-not $NoDeps) {
  Write-Host "Installing Node runtime dependencies..."
  Push-Location (Join-Path $Target ".ai\node")
  try { & npm install --no-audit --no-fund | Out-Null }
  catch { Write-Error "npm install failed — rerun with network access, or use -NoDeps and install manually."; exit 1 }
  finally { Pop-Location }
}

Write-Host "AI-Kit installed into $Target"
Write-Host "Add it to your PATH (PowerShell profile):"
Write-Host "  `$env:Path = `"$Target\bin;`" + `$env:Path"
Write-Host "Then run:  ai-kit version"
