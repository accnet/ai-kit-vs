# AI-Kit MCP Installer

`ai-kit-mcp` is the one-time device installer for AI-Kit. It installs one
shared runtime into `~/ai-kit`; it is not copied into each project and it does
not own project workflow state.

After installation, new projects are initialized with the global command:

```text
ai-kit setup
```

## Requirements

- Node.js 22 or newer
- npm
- Bash on Linux/macOS, or PowerShell on Windows
- A writable user home directory

Check Node before installing:

```bash
node --version
npm --version
```

## Install Once Per Device

Linux or macOS:

```bash
cd /path/to/ai-kit-mcp
bash install.sh --dry-run
bash install.sh
export PATH="$HOME/ai-kit/bin:$PATH"
ai-kit version
```

Add the `PATH` export to `~/.bashrc` or `~/.zshrc` for future shells.

Windows PowerShell:

```powershell
Set-Location C:\path\to\ai-kit-mcp
.\install.ps1 -DryRun
.\install.ps1
$env:Path = "$env:USERPROFILE\ai-kit\bin;" + $env:Path
ai-kit version
```

The installer is idempotent only with explicit `--force` / `-Force` when an
existing installation must be refreshed:

```bash
bash install.sh --force
```

Use `--home <dir>` or `AIKIT_HOME` when testing an alternate device home.

## Initialize A New Project

Run the installed runtime from the new project's root:

```bash
cd /path/to/project
ai-kit setup
ai-kit validate
ai-kit status
```

`ai-kit setup` creates project-owned files and state:

```text
project/
├── .ai-work/
│   ├── registry.json
│   ├── state/current.json
│   ├── run/workers/
│   ├── project.yaml
│   ├── models.yaml
│   └── workflows/default/
│       ├── artifacts/
│       ├── context/
│       ├── logs/
│       ├── plan/plan.md
│       ├── roadmap/roadmap.md
│       ├── state/workflow.json
│       └── tasks/tasks.md
├── AGENTS.md
├── CLAUDE.md
├── GEMINI.md
├── .claude/commands/
├── .codex/config.toml
├── .cursor/rules/ai-kit.mdc
├── .github/copilot-instructions.md
└── .vscode/
```

The project gets no `.ai/node` runtime and no root `node_modules`. The runtime
and templates remain in `~/ai-kit`. `ai-kit setup --force` refreshes managed
bridge files without deleting the project's workflow state.

Project configuration is kept in `.ai-work/` and can be committed separately
from disposable workflow state. `project.yaml` declares stack, source
directories, and verification commands. `models.yaml` overrides provider
assignments for this project; omitted roles inherit the device defaults.
Project plugins and security restrictions use `.ai-work/plugins/` and
`.ai-work/security.yaml`. A project security file can restrict the global
allowlist but cannot expand it.

## Natural-Language Setup

After setup, the project `AGENTS.md` maps these requests to the same
deterministic bootstrap flow:

- `set up AI-Kit for this project`
- `setup AI-Kit for this project`
- `initialize this project with AI-Kit`

An agent with terminal access should run `ai-kit setup`, `ai-kit validate`, and
`ai-kit status`. Claude Code also has the `/setup-ai-kit` command. The trigger
never resets `.ai-work` unless the user explicitly asks for that operation.

The same project contract provides intent triggers for planning, implementation,
QA, review, and status. Agents route these requests through `ai-kit route`,
`ai-kit context`, `ai-kit status`, `ai-kit ready`, and `ai-kit timeline` as
appropriate; users do not need to invoke a batch command.

## Daily Workflow

Create a task with an explicit owner, phase, and acceptance criterion:

```bash
ai-kit add-task T1 \
  --title "Build the feature" \
  --owner backend \
  --phase build \
  --acceptance "Focused tests pass"
```

Inspect and route work:

```bash
ai-kit ready
ai-kit status
ai-kit route T1
ai-kit context T1
ai-kit show
ai-kit timeline
```

Run workers and gates when provider plugins are configured:

```bash
ai-kit-worker list --workflow-id default
ai-kit-worker start --workflow-id default --role executor
ai-kit-gate default --once --verify
```

Use the state manager for lifecycle transitions. Do not hand-edit workflow
JSON under `.ai-work/workflows/`.

## VS Code And Agent Bridges

The VS Code extension reads the global runtime when the project has no local
runtime. `ai-kit setup` also creates:

- `.vscode/settings.json` with `aiKit.home: ~/ai-kit`
- `.vscode/tasks.json` for status, validation, routing, and gates
- `.github/copilot-instructions.md` for GitHub Copilot
- `CLAUDE.md` and `.claude/commands/` for Claude Code
- `AGENTS.md` and `.codex/config.toml` for Codex-compatible workflows

The launcher directory must be on `PATH` for VS Code shell tasks:

```bash
export PATH="$HOME/ai-kit/bin:$PATH"
```

## Device Layout

The global home contains reusable runtime assets:

```text
~/ai-kit/
├── .ai/                  # control plane, agents, skills, plugins, templates
├── bin/                  # ai-kit, worker, gate, and plugin launchers
├── plugins/ prompts/ workflows/ models/
└── config/ cache/ logs/
```

Project state is always resolved from the current working directory:
`<project>/.ai-work`. The global home must never contain project workflow
state. Project configuration under `.ai-work/` is the exception: it is intended
to be versioned with the project while workflow state, artifacts, and logs stay
ignored.

## Verify And Repair

```bash
ai-kit home
ai-kit version
ai-kit verify-lock
ai-kit setup --force
```

If a project has a bridge conflict, inspect the existing file and rerun with
`--force` only when the AI-Kit version should replace it. Existing project
state is preserved by setup.

## Development Checks

The installer source keeps its tests and source templates, but generated
dependencies are intentionally not part of the installer payload. To run the
source checks after a clean checkout:

```bash
node .ai/scripts/install-node-runtime.mjs --root .ai/node
npm test
```

The release contract is described in `installer/manifest.json`. The canonical
device entrypoints are `install.sh` and `install.ps1`.
