# AGENTS.md

This project is orchestrated by **AI-Kit**. All processing logic lives in AI-Kit;
this repository only holds project **data** under `.ai-work/`. Do not run ad-hoc AI
workflows or call another agent directly — everything goes through the AI-Kit CLI.

## Where the data is (`.ai-work/`)

Every workflow — including the default one — lives under `.ai-work/workflows/<id>/`
(the quick `ai-kit init` flow uses the id `default`):

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

## Rules

- Use AI-Kit for everything; never bypass it.
- Never hand-edit `.ai-work/workflows/` — change task state only through `ai-kit transition`.
- Providers (Claude, Codex, GPT, Qwen, …) are configured in `.ai/models.yaml`; they are
  interchangeable and must not be invoked directly.
