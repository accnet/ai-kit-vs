import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as board from "../.ai/node/board.js";
import { runGateCycle, verify, verifyTask } from "../.ai/node/gate-runner.js";
import type { VerificationCheck } from "../.ai/node/config.js";
import { load, taskMap, workflowStatePath } from "../.ai/node/engine.js";

const seed = (workflowId: string, implementer: string) => {
  board.createWorkflow("Node gate", "feature", workflowId, "planner");
  board.addTask({
    workflow_id: workflowId,
    id: "T1",
    title: "build",
    owner: "backend",
    phase: "build",
    acceptance: ["works"],
    actor: "planner",
  });
  const claim = board.claimNext(implementer, workflowId) as { claim: { attempt_id: string } };
  board.submitResult(workflowId, "T1", implementer, claim.claim.attempt_id, "done");
};
const statusOf = (workflowId: string, id: string) => taskMap(load(workflowStatePath(workflowId))).get(id)!.status;

test("gate-runner performs QA but requires a reviewer artifact before close", () => {
  const workflowId = `node-gate-${Date.now().toString(36)}`;
  seed(workflowId, "codex");
  const acted = runGateCycle(workflowId, "gatekeeper", undefined, false);
  assert.deepEqual(
    acted.map((entry) => entry.action),
    ["qa-pass"],
  );
  assert.equal(statusOf(workflowId, "T1"), "qa-passed");

  board.submitReview(workflowId, "T1", "reviewer", "approve", "reviewed");
  const released = runGateCycle(workflowId, "gatekeeper", undefined, false);
  assert.deepEqual(
    released.map((entry) => entry.action),
    ["close"],
  );
  assert.equal(statusOf(workflowId, "T1"), "done");
});

test("gate-runner refuses to gate the client's own attempt", () => {
  const workflowId = `node-gate-self-${Date.now().toString(36)}`;
  seed(workflowId, "codex");
  const acted = runGateCycle(workflowId, "codex", undefined, false);
  assert.deepEqual(acted, []);
  assert.equal(statusOf(workflowId, "T1"), "implementation-complete");
});

test("gate verification runs declared checks in the configured cwd", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-gate-verify-"));
  const cwd = join(project, "app");
  mkdirSync(cwd);
  const checks: VerificationCheck[] = [
    { name: "test_command", command: "node -e \"process.cwd().endsWith('/app') || process.exit(1)\"" },
    { name: "typecheck_command", command: "node --version" },
  ];
  const passed = verify(checks, cwd);
  assert.equal(passed.passed, true, passed.summary);
  assert.deepEqual(
    passed.commands,
    checks.map((check) => check.command),
  );
  const failed = verify([{ name: "test_command", command: 'node -e "process.exit(3)"' }], cwd);
  assert.equal(failed.passed, false);
  assert.match(failed.summary, /verification failed: test_command/);
});

test("gate verification does not execute shell chaining from project config", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-gate-shell-"));
  const command = "node -e \"process.exit(0)\" && node -e \"require('fs').writeFileSync('pwned', 'x')\"";
  const result = verify([{ name: "test_command", command }], project);
  assert.equal(result.passed, true, result.summary);
  assert.equal(existsSync(join(project, "pwned")), false);
});

test("gate classifies named migration and live failures for structured QA evidence", () => {
  const migration = verify([{ name: "migration", command: 'node -e "process.exit(3)"' }], process.cwd());
  assert.equal(migration.passed, false);
  assert.equal(migration.failure_code, "needs-migration");
  assert.equal(migration.checks[0].failure_code, "needs-migration");

  const live = verify([{ name: "live-smoke", command: 'node -e "process.exit(3)"' }], process.cwd());
  assert.equal(live.failure_code, "environment-unavailable");
});

test("gate errors are recorded as observable workflow events", () => {
  const workflowId = `node-gate-error-${Date.now().toString(36)}`;
  seed(workflowId, "codex");
  board.recordGateError(workflowId, "T1", "gatekeeper", "qa", "synthetic gate failure");
  const event = load<any>(workflowStatePath(workflowId)).events.at(-1);
  assert.equal(event.action, "gate-error");
  assert.match(event.detail, /synthetic gate failure/);
});

test("planning tasks pass QA without project verification commands", () => {
  const result = verifyTask({ phase: "plan" }, [], process.cwd());
  assert.equal(result.passed, true);
  assert.deepEqual(result.commands, []);
  assert.match(result.summary, /planning task/);
});

test("implementation tasks still fail closed without project verification commands", () => {
  const result = verifyTask({ phase: "build" }, [], process.cwd());
  assert.equal(result.passed, false);
  assert.match(result.summary, /no verification commands are configured/);
});

test("default gate reports an explicit verification bypass", () => {
  const workflowId = `node-gate-default-${Date.now().toString(36)}`;
  seed(workflowId, "codex");
  const previous = process.env.AIKIT_SKIP_VERIFY;
  process.env.AIKIT_SKIP_VERIFY = "1";
  try {
    const acted = runGateCycle(workflowId, "gatekeeper");
    assert.deepEqual(
      acted.map((entry) => entry.action),
      ["qa-pass"],
    );
    const state = load<any>(workflowStatePath(workflowId));
    assert.equal(state.tasks[0].status, "qa-passed");
    assert.match(state.events.at(-1).detail, /verification skipped by AIKIT_SKIP_VERIFY/);
  } finally {
    if (previous === undefined) delete process.env.AIKIT_SKIP_VERIFY;
    else process.env.AIKIT_SKIP_VERIFY = previous;
  }
});
