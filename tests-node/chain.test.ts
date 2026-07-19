import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as board from "../.ai/node/board.js";
import * as engine from "../.ai/node/engine.js";
import { runOnce } from "../.ai/node/run-plugin.js";

// Proof that the RUNTIME drives the full role chain — planner -> executor -> qa
// -> reviewer -> close — through the real run-plugin/adapter/board/gate code
// path. The provider *model* is stubbed by a fake CLI (so no network or real
// Claude/Codex needed), but every step is a genuine plugin invocation whose
// artifact advances real workflow state. This is the chain evidence; swapping
// the stub for `claude`/`codex` in models.yaml changes nothing but the binary.

// A single fake provider CLI that role-plays every role by reading the
// assignment JSON and writing the role-appropriate artifact.
function stubProvider(dir: string): string {
  const script = join(dir, "stub-provider.mjs");
  writeFileSync(
    script,
    [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "const [, , input, output] = process.argv;",
      "const a = JSON.parse(readFileSync(input, 'utf8'));",
      "const base = { version: 1, workflow_id: a.workflow_id, actor: a.actor };",
      "let art;",
      "if (a.role === 'planner')",
      "  art = { ...base, kind: 'plan', goal: 'stub goal', tasks: [",
      "    { id: 'T1', title: 'implement', owner: 'backend', phase: 'build', needs: [], acceptance: ['works'], files: [], tags: [] } ] };",
      "else if (a.role === 'executor')",
      "  art = { ...base, kind: 'result', task: a.task, attempt_id: a.attempt_id, status: 'pass', summary: 'implemented', changed_paths: [], commands: [] };",
      "else if (a.role === 'qa')",
      "  art = { ...base, kind: 'qa', task: a.task, status: 'pass', summary: 'qa ok', commands: [] };",
      "else",
      "  art = { ...base, kind: 'review', task: a.task, verdict: 'approve', notes: 'lgtm' };",
      "writeFileSync(output, JSON.stringify(art) + '\\n');",
    ].join("\n"),
    "utf8",
  );
  return script;
}

// Register a stub plugin for a role in the global home so loadPlugin finds it.
function stubPlugin(home: string, role: string, script: string): void {
  const dir = join(home, "plugins", role);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "stub.json"),
    JSON.stringify({
      version: 1,
      id: "stub",
      role,
      transport: "cli",
      command: ["node", script, "{input}", "{output}", "{prompt}"],
    }),
  );
}

test("runtime drives planner -> executor -> qa -> reviewer -> close as one chain", async () => {
  // Stub plugins live in a temp global home; AIKIT_HOME is read at call time so
  // loadPlugin resolves them. Workflow state uses the process's configured WORK.
  const home = mkdtempSync(join(tmpdir(), "chain-home-"));
  const prevHome = process.env.AIKIT_HOME;
  process.env.AIKIT_HOME = home;
  try {
    const script = stubProvider(home);
    for (const role of ["planner", "executor", "qa", "reviewer"]) stubPlugin(home, role, script);

    const wf = `chain-${Date.now().toString(36)}`;
    board.createWorkflow("Chain demo", "feature", wf, "planner");

    // 1) Planner: the plugin runs and its plan artifact adds tasks.
    await runOnce("planner", "stub", wf);
    let state = engine.load<engine.State>(engine.workflowStatePath(wf));
    assert.ok(
      state.tasks.some((t) => t.id === "T1"),
      "planner plugin did not add tasks to the workflow",
    );

    // 2) Executor: claims T1, runs the plugin, submits a passing result.
    await runOnce("executor", "stub", wf);
    const afterExec = engine.taskMap(engine.load<engine.State>(engine.workflowStatePath(wf))).get("T1");
    assert.equal(afterExec?.status, "implementation-complete", "executor did not complete the task");

    // 3) QA: a different actor verifies the attempt.
    await runOnce("qa", "stub", wf);
    assert.equal(
      engine.taskMap(engine.load<engine.State>(engine.workflowStatePath(wf))).get("T1")?.status,
      "qa-passed",
    );

    // 4) Reviewer: a different actor approves.
    await runOnce("reviewer", "stub", wf);
    assert.equal(
      engine.taskMap(engine.load<engine.State>(engine.workflowStatePath(wf))).get("T1")?.status,
      "review-approved",
    );
    const reviewAssignment = JSON.parse(
      readFileSync(
        join(engine.workspace(engine.workflowStatePath(wf)), "artifacts/assignment/reviewer-T1.json"),
        "utf8",
      ),
    );
    assert.deepEqual(reviewAssignment.input.acceptance, ["works"]);

    // 5) Close.
    board.close(wf, "T1", "closer");
    const final = engine.taskMap(engine.load<engine.State>(engine.workflowStatePath(wf))).get("T1");
    assert.equal(final?.status, "done", "workflow did not reach done");

    // The event log proves the whole chain ran in order.
    const actions = engine.load<engine.State>(engine.workflowStatePath(wf)).events.map((e) => e.action);
    for (const a of ["add-task", "start", "complete", "qa-pass", "review-approve", "close"])
      assert.ok(actions.includes(a), `missing chain step: ${a}`);
  } finally {
    if (prevHome === undefined) delete process.env.AIKIT_HOME;
    else process.env.AIKIT_HOME = prevHome;
  }
});
