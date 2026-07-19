# AI-Kit Global Runtime

This directory is the shared AI-Kit installation for the device. Install the
runtime once in `~/ai-kit`, then use it from any project. Project workflow
state is never stored here.

## First Use

```bash
source ~/.bashrc
ai-kit version
ai-kit home
```

The Bash installer persists the `PATH` export in `~/.bashrc`. Add the
equivalent export to `~/.zshrc` yourself when using zsh. In
PowerShell, add the equivalent `~/ai-kit/bin` directory to the user `Path`.

## Initialize A Project

Run setup from the project root, never from `~/ai-kit`:

```bash
cd /path/to/project
ai-kit setup
ai-kit validate
ai-kit status
```

Setup creates the project integration files and the complete `.ai-work/`
directory. It does not install `.ai/node`, `node_modules`, or another copy of
the runtime into the project.

Setup also creates two project configuration files:

```text
.ai-work/project.yaml   # stack, source directories, verification commands
.ai-work/models.yaml    # provider selection; defaults to off
```

AI providers are opt-in. A fresh setup disables Claude/Codex and keeps only
local QA enabled. Select providers once during setup:

```bash
ai-kit setup --planner claude --executor codex --qa local --reviewer codex
```

The equivalent project configuration is:

```yaml
planner: codex
executor: codex
qa: local
reviewer: codex
```

When a role is `off`, AI-Kit refuses to start that provider and reports an
actionable configuration error. Project settings take precedence over device
defaults.

Project plugin overrides go under `.ai-work/plugins/`. A project security file
at `.ai-work/security.yaml` may restrict the device allowlist, but cannot
expand it. These configuration files are kept separate from disposable
workflow state so they can be committed to the project.

Use `--force` to refresh managed bridge files after updating the kit:

```bash
ai-kit setup --force
```

This preserves the existing workflow state. It does not reset tasks or delete
project history.

## Natural-Language Setup

All generated agent bridge files point to the same bootstrap contract. You can
tell an agent:

```text
set up AI-Kit for this project
```

The agent should run `ai-kit setup`, `ai-kit validate`, and `ai-kit status` from
the project root. Claude Code also exposes `/setup-ai-kit`. The trigger does
not reset `.ai-work` unless explicitly requested.

## Daily Commands

```bash
ai-kit add-task T1 \
  --title "Build the feature" \
  --owner backend \
  --phase build \
  --acceptance "Focused tests pass"
ai-kit status
ai-kit ready
ai-kit route T1
ai-kit context T1
```

Run workers and gates after provider plugins are configured:

```bash
ai-kit-worker list --workflow-id default
ai-kit-worker start --workflow-id default --role executor
ai-kit-gate default --once --verify
```

Editor agents can act as AI-Kit clients without enabling a provider CLI:

```bash
ai-kit agent claim --workflow-id default --client-id codex-extension
ai-kit agent context --workflow-id default --task-id T1 --client-id codex-extension --attempt-id ATTEMPT
ai-kit agent result --workflow-id default --task-id T1 --client-id codex-extension --attempt-id ATTEMPT --status pass --summary "implemented"
```

`AGENTS.md` directs Codex, Claude, Cline, and other extensions through this
control-plane surface. Claims, context, evidence, and audit events remain in
`.ai-work`; extensions must not edit workflow JSON directly.

The state manager owns lifecycle transitions, claims, evidence, and audit
events. Agents should use the CLI rather than editing JSON directly.

## VS Code And Agent Bridges

The installed VS Code extension uses the global runtime when the project has
no local `.ai/node`. Open a project after running `ai-kit setup`; the AI-Kit
view reads the project's `.ai-work` state. The Bash installer has already
configured the launcher directory in `~/.bashrc`.

The generated `.vscode/tasks.json` provides tasks for validation, status, ready
work, routing, and gates. Ensure the launcher directory is visible to VS Code:

```bash
export PATH="$HOME/ai-kit/bin:$PATH"
```

The generated bridge files are also understood by GitHub Copilot, Claude Code,
Codex-compatible clients, Cursor, and Gemini.

## Intent Prompts

The generated `AGENTS.md` maps natural-language requests to the workflow:

```text
plan this feature
implement T1
run QA for T1
review this change
show progress
```

Agents load only the routed context and use the smallest applicable `ai-kit`
commands. They do not need an unscoped batch command and must not bypass the
State Manager.

## Verification And Maintenance

```bash
ai-kit verify-lock
ai-kit version
ai-kit home
```

The lock check detects modified runtime sources or plugin manifests. Refresh
the device installation from the original `ai-kit-mcp` source with:

```bash
bash install.sh --force
```

## Boundaries

```text
~/ai-kit/                  shared runtime, templates, plugins, launchers
/path/to/project/.ai-work  project config, state, tasks, artifacts, logs, workers
```

Never place project `.ai-work` data in `~/ai-kit`, and never copy the global
`.ai` runtime into a project when using the standard device installation.
