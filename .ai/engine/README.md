# AI-Kit 1.0 Control Plane

The control plane is a Node.js TypeScript CLI for multi-agent workflow
coordination. It is intentionally deterministic: Markdown describes work for
humans, while `.ai-work/workflows/<workflow-id>/state/workflow.json` is the
canonical runtime state.

## Commands

```bash
bash .ai/scripts/ai-kit.sh init --title "Add audit trail" --workflow feature
bash .ai/scripts/ai-kit.sh plan --idea "Add audit trail" --owner backend --acceptance "Audit event is persisted"
bash .ai/scripts/ai-kit.sh add-task T1 --title "Design state" --owner planner --phase plan --acceptance "schema approved"
bash .ai/scripts/ai-kit.sh add-task T2 --title "Implement engine" --owner backend --phase build --needs T1 --acceptance "tests pass"
bash .ai/scripts/ai-kit.sh validate
bash .ai/scripts/ai-kit.sh ready
bash .ai/scripts/ai-kit.sh route T1
bash .ai/scripts/ai-kit.sh status
bash .ai/scripts/ai-kit.sh graph
bash .ai/scripts/ai-kit.sh timeline
bash .ai/scripts/ai-kit.sh blocked
bash .ai/scripts/ai-kit.sh onboard
bash .ai/scripts/ai-kit.sh transition T1 start --actor planner
bash .ai/scripts/ai-kit.sh transition T1 complete --actor planner --detail "Plan approved"
```

`complete` means implementation complete. A task becomes `done` only after
`qa-pass`, `review-approve`, and `close`. QA and review actions require an
existing JSON evidence artifact. QA requires `{"kind":"qa","task":"T1","status":"pass"}`;
review requires `{"kind":"review","task":"T1","verdict":"approve"}`. All state mutations append an event
to `.ai-work/workflows/<workflow-id>/logs/events.jsonl`.

`onboard` previews detected host stack, source directories, and verification
commands. Use `onboard --apply` only after reviewing the output; it backs up
`.ai/kit.yaml` before updating it. A custom `--state /path/name.json` uses
`/path/name/` as its isolated artifact and audit workspace.
