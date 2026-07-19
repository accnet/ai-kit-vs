# AGENTS.md

This project is orchestrated by **AI-Kit**. All processing logic lives in AI-Kit;
this repository only holds project **data** under `.ai-work/`. Do not run ad-hoc AI
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

## How to read your context

1. Read the assignment JSON whose path you are given.
2. If it references a `context_manifest`, open that JSON under the workflow's
   `.ai-work/workflows/<id>/context/`
   and read every source it lists (role contract, skills, plan, files) before acting.
3. Do only your role's work. Write exactly one artifact JSON to the output path you are given.

## How to drive AI-Kit (CLI)

Run from the project root; state stays in `.ai-work/`:

- `npm run ai-kit -- status` — workflow status and phases.
- `npm run ai-kit -- ready` — tasks ready to work on.
- `npm run ai-kit -- show` — full state.
- `npm run ai-kit -- route <task-id>` — role contract, skills, and context for a task.
- `npm run ai-kit -- timeline` — event history.
- `npm run ai-kit:worker -- start --workflow-id <id> --role executor` — run a provider worker.
- `npm run ai-kit:gate -- <workflow-id> --once` — run QA and close tasks after reviewer approval.

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

| User intent | Agent action |
| --- | --- |
| "plan this feature", "break this into tasks" | Read the planner contract, inspect `ai-kit status`, and create a scoped plan with acceptance criteria before editing code. |
| "implement T<n>", "build this task" | Run `ai-kit route <task-id>` and `ai-kit context <task-id>`, claim the task through the control plane, then implement and verify it. |
| "test this", "verify the change", "run QA" | Read the QA contract, run the declared focused and full verification, and record evidence in the task workflow. |
| "review this", "check the changes" | Read the reviewer contract, inspect the diff and evidence independently, and report findings without approving your own work. |
| "show progress", "what is the status" | Run `ai-kit status`, `ai-kit ready`, and `ai-kit timeline`; do not start implementation. |

For every trigger, load only the routed context, use the smallest applicable
CLI command, and preserve existing `.ai-work` state. Never invoke an unscoped
batch or bypass the State Manager with hand-edited lifecycle JSON.

## Rules

- Use AI-Kit for everything; never bypass it.
- Never hand-edit `.ai-work/workflows/` — change task state only through `ai-kit transition`.
- Providers (Claude, Codex, GPT, Qwen, …) are configured per project in
  `.ai-work/models.yaml`; omitted roles inherit the device defaults. Project
  plugin overrides belong in `.ai-work/plugins/`. Providers are interchangeable
  and must not be invoked directly.
