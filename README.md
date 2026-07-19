# AI-Kit 1.0.0

AI-Kit is a repository-local, provider-neutral workflow engine for coding work. Its TypeScript control plane owns state, dependency scheduling, lifecycle gates, and audit history. AI tools participate through role-scoped plugins and JSON artifacts.

## Quick Start

1. Adapt `project` and `verification` in `.ai/kit.yaml` for the host project.
2. Run `bash .ai/scripts/bootstrap.sh` and `bash .ai/scripts/doctor.sh`.
3. Create a workflow and tasks with acceptance criteria.

When working from a cleaned kit checkout, install the local runtime first:

```bash
npm --prefix .ai/node install
```

```bash
bash .ai/scripts/ai-kit.sh init --title "My feature" --workflow feature --force
bash .ai/scripts/ai-kit.sh add-task T1 --title "Build" --owner backend --phase build --acceptance "Focused tests pass"
bash .ai/scripts/ai-kit.sh ready
bash .ai/scripts/ai-kit.sh route T1
```

The scheduler writes the default workflow state to `.ai-work/workflows/default/state/workflow.json`; each managed workflow gets its own state, artifacts, context, and audit log under `.ai-work/workflows/<workflow-id>/`.

## Role Plugins

Plugins live under `.ai/plugins/<role>/<id>.json`, where role is `planner`, `executor`, `qa`, or `reviewer`. A manifest declares a local command and supports `{input}`, `{output}`, and `{prompt}` placeholders.

```bash
node .ai/node/node_modules/tsx/dist/cli.mjs .ai/node/run-plugin.ts executor codex --workflow-id my-feature --once
node .ai/node/node_modules/tsx/dist/cli.mjs .ai/node/run-plugin.ts qa local --workflow-id my-feature --once
```

The runner writes `assignment.json`, invokes the plugin, validates its output artifact, then asks the State Manager to apply the legal lifecycle change. Plugins never modify state directly or call one another. See `.ai/plugins/README.md` and `.ai/engine/artifact-schema.md`.

## VS Code

Open the repository as a trusted VS Code workspace and install the recommended ChatGPT extension. Codex reads `AGENTS.md` for the repository contract. Run **Tasks: Run Task** from the Command Palette to validate a workflow, inspect ready work, route a task, or invoke the configured planner, executor, QA, or reviewer.

Configure role adapters in `.ai/models.yaml`:

```yaml
planner: codex
executor: codex
qa: local
reviewer: claude
```

The configured role tasks are headless CLI runs. In an interactive Codex IDE conversation, use the route task to load context and ask Codex to write the assigned artifact; do not invoke a nested Codex worker from that same conversation.

## Standard Device Install

The canonical device installer puts one shared runtime in `~/ai-kit` and keeps
each project's state in its own `.ai-work/` directory:

Run this once per device. After that, add the launcher directory to `PATH` and
run `ai-kit` from any project.

```bash
bash install.sh --dry-run
bash install.sh
export PATH="$HOME/ai-kit/bin:$PATH"
ai-kit version
```

On Windows:

```powershell
.\install.ps1 -DryRun
.\install.ps1
```

## Explicit Project-Local Install

Use project-local mode only when the runtime must live inside a project:

```bash
bash installer/install-project.sh --target <project-root> --dry-run
bash installer/install-project.sh --target <project-root>
```

On Windows PowerShell:

```powershell
.\installer\install-project.ps1 -DryRun
.\installer\install-project.ps1
```

Both modes require Node 22 or newer. Project-local mode preserves the host
`package.json` and installs the runtime only under `.ai/node/node_modules`; it
does not create a root `node_modules`.

## Layout

- `.ai/node/`: TypeScript control plane, local plugin runner, worker manager, and audit state.
- `.ai/plugins/`: provider-specific role adapters with a shared artifact contract.
- `.ai/agents/`: v2 role contracts, split into six concise documents.
- `.ai/skills/`: technology reference material, grouped by domain.
- `.ai/workflows/`: feature, bugfix, migration, release, and research paths.
- `.ai-work/`: disposable plans, task state, artifacts, evidence, logs, and worker records.

The Node runtime is interpreted through `tsx`; `npm run build` is a no-emit TypeScript validation build.

# ai-kit-vs
