# Provider Adapter Contract

The Provider Adapter is the single normalized boundary between the AI-Kit runtime
and any model/agent provider (Claude, Codex, Qwen, Gemini, a local script, ...).
The runtime never talks to a provider except through this contract, so providers
are fully replaceable via `models.yaml` without touching orchestration logic.

Implementation: `.ai/node/provider-adapter.ts`. Consumer: `.ai/node/run-plugin.ts`.

## Transport

A provider is an opaque **CLI process**. Its command comes from the plugin
manifest (`.ai-work/plugins/<role>/<id>.json`, then the device
`.ai/plugins/<role>/<id>.json`) and is rendered with three placeholders:

| Placeholder | Meaning |
|-------------|---------|
| `{input}`   | Path to the assignment JSON the provider must read |
| `{output}`  | Path where the provider must write exactly one artifact JSON |
| `{prompt}`  | Instruction string describing the role's job |

The process runs with `cwd = ROOT` (repo root) by default and inherits env unless
overridden. Arguments are passed directly to the child process. Windows `.cmd`
and `.bat` shims use a quoted `cmd.exe` launch, so provider prompts are not
treated as command syntax.

## Provider obligations

A well-behaved provider must:

1. Read the assignment at `{input}` (and any `context_manifest` it references).
2. Perform **only** its role's work (planner plans, executor implements, etc.).
3. Write **exactly one** schema-valid artifact JSON to `{output}`.
4. Exit `0` on success; exit non-zero on failure.

The adapter guarantees the file at `{output}` is cleared before each attempt, so a
leftover artifact from a previous run is never mistaken for success.

## Standardized Provider interface

Every provider implements the same four operations, all declared in its manifest,
so adding Cursor, Gemini, Qwen, ... is a manifest only — the Runtime never changes:

| Op | Manifest field | Meaning |
|----|----------------|---------|
| **invoke** | `command` (required) | Do the role's work. Runs through this adapter. |
| **init** | `init` (optional) | One-time prepare / auth. `runtime.providers.init(role, id)`. |
| **validate** | `validate` (optional) | Readiness check; exit 0 = ready. `runtime.providers.validate(role, id)`. |
| **capability** | `capabilities` (optional) | Declared `{ roles, features, auth }`. `runtime.providers.capability(role, id)`. |

CLI: `ai-kit provider <capability|validate|init> <role> <id>`. Any command in
`init`/`validate` is also subject to the device `.ai/security.yaml` allowlist
and any narrower project `.ai-work/security.yaml` policy.

Example manifest with the full interface:

```jsonc
{
  "version": 1,
  "id": "gemini",
  "role": "executor",
  "transport": "cli",
  "command": ["gemini", "-p", "{prompt}"],       // invoke
  "validate": ["gemini", "--version"],           // validate
  "capabilities": { "roles": ["executor"], "features": ["code"], "auth": true }
}
```

## Manifest tuning (optional, backward compatible)

```jsonc
{
  "version": 1,
  "id": "codex",
  "role": "executor",
  "transport": "cli",
  "command": ["codex", "run", "--in", "{input}", "--out", "{output}", "--prompt", "{prompt}"],
  "timeout_ms": 600000,   // optional, 1000..3_600_000 (default 600000)
  "retries": 1            // optional, 0..5 (default 0)
}
```

## Normalized result

`invokeProvider(plugin, options)` never throws for provider failure; it returns:

```ts
type AdapterOutcome = "ok" | "timeout" | "spawn-error" | "nonzero-exit" | "no-output";

type AdapterResult = {
  outcome: AdapterOutcome;
  ok: boolean;            // outcome === "ok"
  exit_code: number | null;
  signal: string | null;
  duration_ms: number;
  attempts: number;       // 1..(retries + 1)
  output_path: string;
  command: string[];
  stdout: string;
  stderr: string;
  error?: string;         // human-readable reason when ok === false
};
```

### Outcome taxonomy

| Outcome | Meaning | Retried? |
|---------|---------|----------|
| `ok` | Exit 0 **and** the artifact exists | — |
| `timeout` | Killed after exceeding `timeout_ms` | yes |
| `spawn-error` | Could not launch (missing binary, EACCES) | yes |
| `nonzero-exit` | Ran but returned non-zero status | yes |
| `no-output` | Exit 0 but wrote no artifact | **no** (contract violation) |

Retries use linear backoff (`RETRY_BACKOFF_MS * attempt`). Only transient
outcomes are retried; `no-output` signals a broken provider and fails fast.

## Downstream handling

`run-plugin.ts` branches on `result.ok`:

- **ok** → validate the artifact against its zod schema (`readArtifact`), then
  submit it through the board (`submitResultArtifact` / `submitQaArtifact` /
  `submitReviewArtifact` / `applyPlanArtifact`).
- **not ok** → for an executor attempt, mark the task `blocked` via
  `board.reportBlocked` with the normalized reason, then surface the error.

Schema validation is intentionally **not** the adapter's job: the adapter proves a
process ran and produced a file; the artifact layer proves the file is valid.

## Non-goals

- The adapter does not stream tokens or interpret model output.
- The adapter does not manage provider credentials (that is the provider's env).
- The adapter does not choose which provider to run (`models.yaml` + `models.ts`).
