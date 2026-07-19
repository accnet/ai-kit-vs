# AI-Kit Plugins

Each manifest belongs to one role: `planner`, `executor`, `qa`, or `reviewer`.
The runner replaces `{input}`, `{output}`, `{prompt}`, and `{runtime}` in
`command`; the plugin reads the assignment JSON and writes one versioned output
JSON to `{output}`. `{runtime}` is the AI-Kit installation root, so commands
continue to work when the runtime is installed globally. Plugins must not
modify workflow state.

The current runtime supports local CLI adapters. A future REST or WebSocket adapter must preserve these artifact schemas and state-manager boundary.

`run-plugin.ts <role> --workflow-id <id> --once` resolves the plugin ID from `.ai/models.yaml`. Pass an explicit plugin ID after the role to override the configured adapter for one run.
