<# Configure a workspace to use the shared AI-Kit device install. #>
[CmdletBinding()]
param(
    [string]$Target = (Get-Location).Path,
    [string]$Home_ = $(if ($env:AIKIT_HOME) { $env:AIKIT_HOME } else { Join-Path $env:USERPROFILE 'ai-kit' }),
    [switch]$Force,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$targetPath = (Resolve-Path $Target).Path
$kitHome = (Resolve-Path $Home_).Path
$launcher = Join-Path $kitHome 'bin\ai-kit.cmd'

if ($targetPath -eq $source) { throw 'Target cannot be the kit source directory.' }
if ($targetPath -eq $kitHome) { throw 'Target cannot be the AI-Kit home.' }
if (-not (Test-Path -LiteralPath $launcher)) { throw "AI-Kit launcher is missing: $launcher (run the device installer first)" }

$files = @(
    @{ Source = '.ai/templates/AGENTS.project.md'; Destination = 'AGENTS.md' },
    @{ Source = 'CLAUDE.md'; Destination = 'CLAUDE.md' },
    @{ Source = 'GEMINI.md'; Destination = 'GEMINI.md' },
    @{ Source = '.github/copilot-instructions.md'; Destination = '.github/copilot-instructions.md' },
    @{ Source = '.cursor/rules/ai-kit.mdc'; Destination = '.cursor/rules/ai-kit.mdc' },
    @{ Source = '.codex/config.toml'; Destination = '.codex/config.toml' },
    @{ Source = '.vscode/extensions.json'; Destination = '.vscode/extensions.json' },
    @{ Source = 'installer/templates/vscode-settings.json'; Destination = '.vscode/settings.json' },
    @{ Source = 'installer/templates/vscode-tasks.json'; Destination = '.vscode/tasks.json' }
)

$conflicts = @()
foreach ($file in $files) {
    $src = Join-Path $source ($file.Source -replace '/', '\')
    $dst = Join-Path $targetPath ($file.Destination -replace '/', '\')
    if ((Test-Path -LiteralPath $dst) -and ((Get-FileHash -LiteralPath $src).Hash -ne (Get-FileHash -LiteralPath $dst).Hash) -and -not $Force) {
        $conflicts += $file.Destination
    }
}
$claudeSource = Join-Path $source '.claude\commands'
if (Test-Path -LiteralPath $claudeSource) {
    foreach ($src in Get-ChildItem -LiteralPath $claudeSource -File) {
        $relative = ".claude/commands/$($src.Name)"
        $dst = Join-Path $targetPath ($relative -replace '/', '\')
        if ((Test-Path -LiteralPath $dst) -and ((Get-FileHash -LiteralPath $src.FullName).Hash -ne (Get-FileHash -LiteralPath $dst).Hash) -and -not $Force) {
            $conflicts += $relative
        }
    }
}
if ($conflicts.Count -gt 0) { $conflicts | ForEach-Object { Write-Error "conflict: $_" }; throw 'Installation stopped. Re-run with -Force.' }

if ($DryRun) {
    Write-Output "[dry-run] workspace: $targetPath"
    Write-Output "[dry-run] kit home: $kitHome"
    Write-Output '[dry-run] would copy agent bridge and VS Code files'
    Write-Output '[dry-run] would create .ai-work/{workflows,run,state} and default workflow state'
    exit 0
}

foreach ($file in $files) {
    $src = Join-Path $source ($file.Source -replace '/', '\')
    $dst = Join-Path $targetPath ($file.Destination -replace '/', '\')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Force
}
if (Test-Path -LiteralPath $claudeSource) {
    foreach ($src in Get-ChildItem -LiteralPath $claudeSource -File) {
        $dst = Join-Path $targetPath ".claude\commands\$($src.Name)"
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
        Copy-Item -LiteralPath $src.FullName -Destination $dst -Force
    }
}

$dirs = @(
    '.ai-work\state', '.ai-work\run\workers',
    '.ai-work\workflows\default\state', '.ai-work\workflows\default\plan',
    '.ai-work\workflows\default\roadmap', '.ai-work\workflows\default\tasks',
    '.ai-work\workflows\default\context', '.ai-work\workflows\default\artifacts',
    '.ai-work\workflows\default\logs'
)
foreach ($dir in $dirs) { New-Item -ItemType Directory -Force -Path (Join-Path $targetPath $dir) | Out-Null }

$registry = Join-Path $targetPath '.ai-work\registry.json'
if (-not (Test-Path -LiteralPath $registry)) { '{"version":1,"revision":0,"workflows":[]}' | Set-Content -Encoding utf8 $registry }
$state = Join-Path $targetPath '.ai-work\workflows\default\state\workflow.json'
if (-not (Test-Path -LiteralPath $state)) {
    Push-Location $targetPath
    try { & $launcher init --title 'Untitled workspace workflow' --workflow feature --actor planner | Out-Null }
    finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'AI-Kit default workflow initialization failed.' }
}

foreach ($template in @('plan', 'roadmap', 'tasks')) {
    $destination = Join-Path $targetPath ".ai-work\workflows\default\$template\$template.md"
    if (-not (Test-Path -LiteralPath $destination)) {
        Copy-Item -LiteralPath (Join-Path $source ".ai\templates\$template.md") -Destination $destination
    }
}

$gitignore = Join-Path $targetPath '.gitignore'
$marker = '# AI-Kit workspace state'
if (-not (Test-Path -LiteralPath $gitignore)) { "$marker`n.ai-work/" | Set-Content -Encoding utf8 $gitignore }
elseif (-not (Select-String -LiteralPath $gitignore -SimpleMatch $marker -Quiet)) { Add-Content -LiteralPath $gitignore -Value "`n$marker`n.ai-work/" }

Push-Location $targetPath
try { & $launcher --state '.ai-work\workflows\default\state\workflow.json' validate | Out-Null }
finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'AI-Kit workspace validation failed.' }

Write-Output "AI-Kit workspace configured at $targetPath"
Write-Output "Shared runtime: $kitHome"
Write-Output "Project state: $(Join-Path $targetPath '.ai-work')"
