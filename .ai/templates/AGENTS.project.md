# AGENTS.md

This project is orchestrated by **AI-Kit**. All processing logic lives in AI-Kit;
this repository only holds project **data** under `.ai-work/` and `.ai-memory/`. Do not run ad-hoc AI
workflows or call another agent directly — everything goes through the AI-Kit CLI.

## Where the data is (`.ai-work/`)

Every workflow — including the default one — lives under `.ai-work/workflows/<id>/`
(`ai-kit setup` creates the initial workflow with the id `default`):

- `workflows/<id>/state/workflow.json` — that workflow's state (tasks, phases, events). **Source of truth.**
- `workflows/<id>/plan/plan.md`, `roadmap/roadmap.md`, `tasks/tasks.md` — planning documents.
- `workflows/<id>/context/` — per-task context manifests: the exact sources to read before working.
- `workflows/<id>/artifacts/` — `result`, `qa`, `review`, and `plan` artifacts.
- `workflows/<id>/logs/events.jsonl` — append-only event log.

Top level:

- `state/current.json` — pointer to the active workflow.
- `registry.json` — the list of registered workflows.
- `run/workers/` — background provider-worker records.

Project-specific durable knowledge belongs in `.ai-memory/`. It is isolated from
the shared runtime memory under `~/ai-kit/.ai/memory/` and is loaded only for
this project.

## How to read your context

1. Read the assignment JSON whose path you are given.
2. If it references a `context_manifest`, open that JSON under the workflow's
   `.ai-work/workflows/<id>/context/`
   and read every source it lists (role contract, skills, plan, files) before acting.
3. Do only your role's work. Write exactly one artifact JSON to the output path you are given.

## How to drive AI-Kit (CLI)

Run from the project root; state stays in `.ai-work/`:

- `ai-kit --help` or `ai-kit <command> --help` — inspect the CLI without running the command.
- `ai-kit roles` — list valid task owners and provider roles.
- `ai-kit status` — workflow status and phases.
- `ai-kit bind` — bind an existing external `.ai-work` directory to this project.
- `ai-kit ready` — tasks ready to work on.
- `ai-kit show` — full state.
- `ai-kit route <task-id>` — role contract, skills, and context for a task.
- `ai-kit agent claim --workflow-id <id> --client-id <extension-id>` — claim the next task through the State Manager.
- `ai-kit agent context --workflow-id <id> --task-id <task> --client-id <client> --attempt-id <attempt>` — load the claimed context.
- `ai-kit agent result --workflow-id <id> --task-id <task> --client-id <client> --attempt-id <attempt> --status pass --summary "..."` — submit implementation evidence.
- `ai-kit timeline` — event history.
- `ai-kit events --workflow-id <id> --after-cursor <n> --wait-ms 30000` — poll
  for new workflow events with a bounded wait.
- `ai-kit watch --workflow-id <id> --after-cursor <n>` — stream newline-delimited
  event records for an editor bridge; persist the returned `cursor` and pass it
  on the next watch/poll so Codex does not replay Copilot events.
- `ai-kit-worker start --workflow-id <id> --role executor` — run a provider worker.
- `ai-kit-gate <workflow-id> --once` — run QA and close tasks after reviewer approval.

## Natural-Language Setup Trigger

When the user says **"set up AI-Kit for this project"**, **"setup AI-Kit for
this project"**, or **"initialize this project with AI-Kit"**, treat it as the
workspace bootstrap request. From the project root, run:

```bash
ai-kit setup
ai-kit validate
ai-kit status
```

Do not use `--force` unless the user explicitly asks to refresh managed bridge
files. Do not delete or reset existing `.ai-work` state as part of setup.

## Natural-Language Workflow Triggers

Use the following intent map instead of asking the user to run a batch command:

| User intent                                  | Agent action                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| "plan this feature", "break this into tasks" | Read the planner contract, inspect `ai-kit status`, and create a scoped plan with acceptance criteria before editing code.           |
| "implement T<n>", "build this task"          | Run `ai-kit route <task-id>` and `ai-kit context <task-id>`, claim the task through the control plane, then implement and verify it. |
| "test this", "verify the change", "run QA"   | Read the QA contract, run the declared focused and full verification, and record evidence in the task workflow.                      |
| "review this", "check the changes"           | Read the reviewer contract, inspect the diff and evidence independently, and report findings without approving your own work.        |
| "show progress", "what is the status"        | Run `ai-kit status`, `ai-kit ready`, and `ai-kit timeline`; do not start implementation.                                             |
| "small fix", "minor bug", "bounded change"   | If `workflow.micro_tasks.enabled` is true, create a bounded `ai-kit micro-task`; otherwise use the normal task flow.                 |

For every trigger, load only the routed context, use the smallest applicable
CLI command, and preserve existing `.ai-work` state. Status and read commands
follow the active workflow pointer; use `--state <path>` when an explicit
workflow is required. When multiple agents have active claims in different
workflows, unscoped status/read commands fail intentionally; use each workflow's
explicit `--state` path. Never invoke an unscoped
batch or bypass the State Manager with hand-edited lifecycle JSON.

## Agent Client Mode

Codex, Claude, Cline, and other editor agents are clients of AI-Kit. They must
use `ai-kit agent claim` before editing, read the returned context manifest,
send periodic heartbeats for long work, and submit exactly one result through
`ai-kit agent result`. Editor claims last 900 seconds by default; use
`--lease-seconds <n>` or `AIKIT_LEASE_SECONDS` when a task needs a different
duration. They may edit project files, but must never edit
`.ai-work/workflows/` directly. QA, review, and release gates remain owned by
independent AI-Kit clients.

No silent completion: a task is NEVER complete just because code compiles. You
MUST submit through `ai-kit agent result` before reporting implementation work
as done; QA, independent review, and gate closure still have to pass.

For a small, bounded fix, a project may enable the shortened micro-task policy
in `.ai-work/project.yaml`. It still creates a tracked task and requires an
independent QA gate, but it can skip a separate plan and reviewer:

```bash
ai-kit micro-task T1 \
  --title "Fix the small defect" \
  --owner backend \
  --workflow-id default \
  --files src/example.ts \
  --acceptance "focused test passes"
ai-kit agent claim --workflow-id default --client-id codex-extension
ai-kit-gate default --once
```

The policy is disabled by default and limits the number of declared files.
Natural-language discussion, brainstorming, and read-only status checks do not
need any CLI call; code changes should use either the normal workflow or this
explicit micro-task path.

## Rules

- Use AI-Kit for everything; never bypass it.
- Never hand-edit `.ai-work/workflows/` — change task state only through `ai-kit transition`.
- Providers (Claude, Codex, GPT, Qwen, …) are configured per project in
  `.ai-work/models.yaml`; fresh projects default AI roles to `off` and keep
  only local QA enabled. Select providers during `ai-kit setup` or edit the
  project mapping explicitly. Project plugin overrides belong in
  `.ai-work/plugins/`. Providers are interchangeable and must not be invoked directly.

Editor bridge example after Copilot submits a result:

```bash
ai-kit watch --workflow-id <id> --after-cursor <last-seen-cursor>
```

The stream reports `implementation-complete`, `qa-pass`, `review-approve`, and
`close` events. It observes state only; it never changes task lifecycle state.
