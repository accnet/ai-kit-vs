<# Install this nested AI-Kit into its parent project directory. #>
[CmdletBinding()]
param(
    [string]$Target = (Split-Path -Parent $PSScriptRoot),
    [switch]$Force,
    [switch]$DryRun
)

$source = (Resolve-Path $PSScriptRoot).Path
$targetPath = (Resolve-Path $Target).Path
if ($source -eq $targetPath) { throw 'Target cannot be the kit directory.' }
. (Join-Path $PSScriptRoot "installer\lib.ps1")

# Preflight: verify prerequisites BEFORE copying anything.
Assert-AiKitNode

$pm = if ($env:AIKIT_PM) { $env:AIKIT_PM }
      elseif (Test-Path -LiteralPath (Join-Path $targetPath 'pnpm-lock.yaml')) { 'pnpm' }
      elseif (Test-Path -LiteralPath (Join-Path $targetPath 'yarn.lock')) { 'yarn' }
      elseif ((Test-Path -LiteralPath (Join-Path $targetPath 'bun.lockb')) -or (Test-Path -LiteralPath (Join-Path $targetPath 'bun.lock'))) { 'bun' }
      else { 'npm' }
if (-not (Get-Command $pm -ErrorAction SilentlyContinue)) { throw "package manager '$pm' not found on PATH (set AIKIT_PM to override)." }

try {
    $probe = Join-Path $targetPath '.aikit-write-test'
    New-Item -ItemType File -Path $probe -Force | Out-Null
    Remove-Item -LiteralPath $probe -Force
} catch { throw "target directory is not writable: $targetPath" }

# AGENTS.md is written separately from the minimal project template below.
$items = @('CLAUDE.md','GEMINI.md','.ai','.claude','.cursor','.codex/config.toml','.githooks','.github/copilot-instructions.md','.github/workflows/gates.yml')
$files = foreach ($item in $items) {
    $path = Join-Path $source $item
    if (Test-Path -LiteralPath $path -PathType Container) { Get-ChildItem -LiteralPath $path -Recurse -File }
    elseif (Test-Path -LiteralPath $path -PathType Leaf) { Get-Item -LiteralPath $path }
}

# Never copy local secrets: .env stays per-project; only .env.example travels.
$files = $files | Where-Object {
    $n = $_.Name
    $relative = $_.FullName.Substring($source.Length).TrimStart('\','/')
    -not ($relative -match '(^|[\\/])node_modules([\\/]|$)') -and
    -not ($n -eq '.env' -or ($n -like '.env.*' -and $n -notlike '*.example' -and $n -notlike '*.sample'))
}

$conflicts = @()
foreach ($file in $files) {
    $relative = $file.FullName.Substring($source.Length).TrimStart('\','/')
    $destination = Join-Path $targetPath $relative
    if ((Test-Path -LiteralPath $destination) -and -not ((Get-FileHash -LiteralPath $file.FullName).Hash -eq (Get-FileHash -LiteralPath $destination).Hash)) { $conflicts += $relative }
}
if ($conflicts.Count -gt 0 -and -not $Force) {
    $conflicts | ForEach-Object { Write-Error "conflict: $_" }
    throw 'Installation stopped. Re-run with -Force to replace managed files.'
}

foreach ($file in $files) {
    $relative = $file.FullName.Substring($source.Length).TrimStart('\','/')
    $destination = Join-Path $targetPath $relative
    if ($DryRun) { Write-Output "copy: $relative"; continue }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
}

# The project's AGENTS.md is the minimal agent-orchestration guide, not the kit's full spec.
if ($DryRun) {
    Write-Output 'write: AGENTS.md (minimal project orchestration guide)'
} else {
    Copy-Item -LiteralPath (Join-Path $source '.ai/templates/AGENTS.project.md') -Destination (Join-Path $targetPath 'AGENTS.md') -Force
}

if (-not $DryRun) {
    $ignore = Join-Path $targetPath '.gitignore'
    $marker = '# AI-Kit runtime state'
    if (-not (Test-Path -LiteralPath $ignore) -or -not (Select-String -LiteralPath $ignore -SimpleMatch $marker -Quiet)) {
        Add-Content -LiteralPath $ignore -Value "`n$marker`n.ai-work/`nnode_modules/"
    } elseif (-not (Select-String -LiteralPath $ignore -Pattern '^node_modules/$' -Quiet)) {
        Add-Content -LiteralPath $ignore -Value "`nnode_modules/"
    }
    & node (Join-Path $targetPath '.ai/scripts/install-node-runtime.mjs') --root (Join-Path $targetPath '.ai/node') --pm $pm
    if ($LASTEXITCODE -ne 0) { throw "Node runtime dependency installation failed with exit code $LASTEXITCODE" }
}

Write-Output "AI-Kit installed into $targetPath"
if ($DryRun) { Write-Output "Node runtime dependencies will be installed into $(Join-Path $targetPath '.ai/node') on a non-dry run." }
Write-Output 'Next: bash .ai/scripts/bootstrap.sh; bash .ai/scripts/doctor.sh'
