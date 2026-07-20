# Workflow State Schema

Each registered workflow is stored at `.ai-work/workflows/<workflow-id>/state/workflow.json`.
`.ai-work/registry.json` indexes its ID, title, workflow type, state path, and creation time.
The legacy `.ai-work/state/workflow.json` path is migrated by `bootstrap.sh` and
remains available only as an input to that migration.

`workflow.json` contains `version`, `title`, `workflow`, `tasks`, `phases`, and
append-only `events`. A task has `id`, `title`, `owner`, `phase`, `needs`, `status`,
`acceptance`, `files`, `attempts`, and `blocked_reason`. An in-progress task also has
`claim` (`client_id`, opaque `attempt_id`, timestamps, and lease expiry); completed
work records its implementation client and attempt for independent QA/review checks.
Phase state is derived:
`planned`, `open`, or `complete`.

Legal task statuses are `todo`, `in-progress`, `implementation-complete`,
`qa-passed`, `review-approved`, `done`, `replaced`, and `blocked`. A replaced
task is terminal and represents a review-rejected task superseded by a generated
remediation task; dependencies are rewired to that remediation task.

Legal actions are `start`, `complete`, `qa-pass`, `review-approve`, `close`,
`replace`, `block`, and `unblock`. A task is runnable only when it is `todo` and every
dependency is `done` or `replaced`. IDs must be unique and the dependency graph must be a
DAG. Events are append-only, monotonic per workflow (`seq`), and new records use
`schema_version: 1`, a unique `event_id`, `workflow_id`, timestamp, actor, action, task,
old status, new status, and detail. Older records without the additive metadata remain
readable. The state event array is canonical; `logs/events.jsonl` is rewritten from it
under the state lock with an atomic rename after each successful save. Clients resume
event polling with a non-negative `seq` cursor; replay returns events strictly after it
and preserves the last cursor when no new event exists.

`.ai-work/state/current.json` is a derived startup pointer maintained by State
Manager. It identifies the canonical workflow state and currently active tasks;
it is never an independent source of lifecycle truth. It is updated atomically
after each managed workflow state mutation; `active_tasks` contains tasks in
the `in-progress` state.
