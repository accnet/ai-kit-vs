# AI-Kit 1.0 for GitHub Copilot

Read and follow `AGENTS.md` before responding or editing. It is the canonical
source for workflow state, planning gates, role contracts, skills, and
verification. Do not create a separate Copilot workflow or duplicate rules.

## Copilot Client Lifecycle

Use `copilot-extension` as the AI-Kit client id. For tracked implementation
work, claim the next task with `ai-kit agent claim`, read the returned context
manifest, and use its attempt id for heartbeats and exactly one
`ai-kit agent result` submission. At the end of a claimed task, prefer
`ai-kit copilot finish --summary "..."`; it discovers the active claim and
submits the same result safely. Run from the project root and let AI-Kit own
workflow state, artifacts, QA, review, and gate transitions.

Copilot does not need Claude or Codex CLI enabled. A fresh project keeps those
provider roles off and can still use Copilot as the editor client with local
QA. Never edit `.ai-work/workflows/` JSON directly.

## Completion Checklist

- Read `AGENTS.md` and the claimed context manifest before editing.
- Verify the declared acceptance criteria and record the commands that passed.
- Run `ai-kit copilot finish --summary "..."` after implementation work.
- Submit exactly one `ai-kit agent result` for every claimed implementation task.
- Do not report completion because code compiles alone; the AI-Kit result and
  independent QA/review gates are required.
