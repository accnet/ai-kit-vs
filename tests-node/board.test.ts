import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import * as board from "../.ai/node/board.js";
import { artifactPath, writeArtifact } from "../.ai/node/artifacts.js";
import { CURRENT, load, PROJECT_ROOT, save, workflowStatePath } from "../.ai/node/engine.js";

test("Node board enforces a claimed attempt and independent gates", () => {
  const workflowId = `node-board-${Date.now().toString(36)}`;
  board.createWorkflow("Node board", "feature", workflowId, "planner");
  board.addTask({
    workflow_id: workflowId,
    id: "T1",
    title: "build",
    owner: "backend",
    phase: "build",
    acceptance: ["works"],
    actor: "planner",
  });
  const claim = board.claimNext("codex-worker", workflowId) as any;
  assert.equal(claim.claimed, "T1");
  assert.throws(() => board.submitResult(workflowId, "T1", "other", claim.claim.attempt_id, "forged"));
  board.submitResult(workflowId, "T1", "codex-worker", claim.claim.attempt_id, "done");
  assert.equal(board.pendingReview(workflowId).awaiting_qa[0].phase, "build");
  assert.throws(() => board.submitQa(workflowId, "T1", "codex-worker", "pass", "self check"));
  board.submitQa(workflowId, "T1", "qa-worker", "pass", "independent check");
  board.submitReview(workflowId, "T1", "reviewer", "approve");
  assert.equal(board.close(workflowId, "T1", "release").status, "done");
});

test("Node board creates remediation work when review requests changes", () => {
  const workflowId = `node-remediation-${Date.now().toString(36)}`;
  board.createWorkflow("Node remediation", "feature", workflowId, "planner");
  board.addTask({
    workflow_id: workflowId,
    id: "T1",
    title: "build",
    owner: "backend",
    phase: "build",
    acceptance: ["works"],
  });
  board.addTask({
    workflow_id: workflowId,
    id: "T2",
    title: "follow up",
    owner: "backend",
    phase: "build",
    needs: ["T1"],
    acceptance: ["depends"],
  });
  const claim = board.claimNext("executor", workflowId) as any;
  board.submitResult(workflowId, "T1", "executor", claim.claim.attempt_id, "done");
  board.submitQa(workflowId, "T1", "qa", "pass", "verified");
  const remediation: any = board.submitReview(workflowId, "T1", "reviewer", "changes-requested", "add coverage");
  assert.equal(remediation.id, "T1-R1");
  assert.equal(
    board.ready(workflowId).some((task) => task.id === "T2"),
    false,
  );
});

test("Node board applies a plan atomically, including dependencies declared out of order", () => {
  const workflowId = `node-plan-${Date.now().toString(36)}`;
  board.createWorkflow("Node plan", "feature", workflowId, "planner");
  const output = artifactPath(workflowId, "plan", "planner");
  writeArtifact(output, "plan", {
    version: 1,
    kind: "plan",
    workflow_id: workflowId,
    actor: "planner",
    goal: "atomic plan",
    tasks: [
      { id: "T2", title: "second", owner: "backend", phase: "build", needs: ["T1"], acceptance: ["second"] },
      { id: "T1", title: "first", owner: "backend", phase: "build", needs: [], acceptance: ["first"] },
    ],
  });
  board.applyPlanArtifact(workflowId, "planner", output);
  assert.deepEqual(
    load<any>(workflowStatePath(workflowId)).tasks.map((task: any) => task.id),
    ["T2", "T1"],
  );

  const invalid = artifactPath(workflowId, "plan", "invalid");
  writeArtifact(invalid, "plan", {
    version: 1,
    kind: "plan",
    workflow_id: workflowId,
    actor: "planner",
    goal: "invalid plan",
    tasks: [
      { id: "T3", title: "partial", owner: "backend", phase: "build", needs: [], acceptance: ["partial"] },
      { id: "T3", title: "duplicate", owner: "backend", phase: "build", needs: [], acceptance: ["duplicate"] },
    ],
  });
  assert.throws(() => board.applyPlanArtifact(workflowId, "planner", invalid), /task already exists/);
  assert.equal(
    load<any>(workflowStatePath(workflowId)).tasks.some((task: any) => task.id === "T3"),
    false,
  );
});

test("Node board ready and claim share stable DAG ordering", () => {
  const workflowId = `node-dag-order-${Date.now().toString(36)}`;
  board.createWorkflow("Node DAG order", "feature", workflowId, "planner");
  board.addTask({
    workflow_id: workflowId,
    id: "T2",
    title: "branch two",
    owner: "backend",
    phase: "build",
    acceptance: ["parallel"],
  });
  board.addTask({
    workflow_id: workflowId,
    id: "T1",
    title: "branch one",
    owner: "backend",
    phase: "build",
    acceptance: ["parallel"],
  });
  board.addTask({
    workflow_id: workflowId,
    id: "T3",
    title: "dependent",
    owner: "backend",
    phase: "build",
    needs: ["T1"],
    acceptance: ["depends"],
  });
  assert.deepEqual(
    board.ready(workflowId).map((task) => task.id),
    ["T2", "T1"],
  );
  assert.equal((board.claimNext("codex-dag", workflowId) as any).claimed, "T2");
});

test("Node board event polling returns after a bounded empty wait", async () => {
  const workflowId = `node-poll-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  board.createWorkflow("event polling", "feature", workflowId);
  const started = Date.now(),
    result = await board.waitForEvents(workflowId, 1, 25);
  assert.deepEqual(result.events, []);
  assert.ok(Date.now() - started >= 20);
  const replay = board.events(workflowId, 0);
  assert.ok(replay.events.length > 0);
  assert.equal(board.events(workflowId, replay.cursor).events.length, 0);
  assert.throws(() => board.events(workflowId, -1), /non-negative integer/);
});

test("Node state manager refreshes the startup pointer after a claim", () => {
  const workflowId = `node-current-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  board.createWorkflow("current pointer", "feature", workflowId);
  board.addTask({
    workflow_id: workflowId,
    id: "T1",
    title: "active",
    owner: "backend",
    phase: "build",
    acceptance: ["pointer is current"],
  });
  board.claimNext("codex", workflowId);
  const pointer = JSON.parse(readFileSync(CURRENT, "utf8"));
  assert.match(pointer.workflow_state, /workflows\/[^/]+\/state\/workflow\.json$/);
  assert.ok(Array.isArray(pointer.active_tasks));
});

test("Node claim reads routed skill sources and persists a scoped context manifest", () => {
  const workflowId = `node-context-${Date.now().toString(36)}`;
  board.createWorkflow("Node context", "feature", workflowId, "planner");
  board.addTask({
    workflow_id: workflowId,
    id: "T1",
    title: "context",
    owner: "backend",
    phase: "build",
    acceptance: ["context is persisted"],
    files: ["package.json"],
  });
  const claim = board.claimNext("context-executor", workflowId) as any;
  const manifest = JSON.parse(readFileSync(claim.context_manifest, "utf8"));
  const skill = manifest.sources.find((item: any) => item.path === ".ai/skills/core/api-contract/SKILL.md");
  assert.ok(skill);
  const source = readFileSync(join(process.cwd(), skill.path));
  assert.equal(skill.sha256, createHash("sha256").update(source).digest("hex"));
  assert.ok(manifest.sources.some((item: any) => item.path === ".ai/skills/core/observability/SKILL.md"));
  assert.equal(
    manifest.sources.some((item: any) => item.path.startsWith(".ai/skills/backend/")),
    false,
  );
  // Context Engine: the manifest carries a ranked, token-budgeted selection.
  assert.ok(Array.isArray(manifest.context.included) && manifest.context.included.length > 0);
  assert.equal(manifest.context.included[0].path, ".ai/engine/state-schema.md");
  assert.ok(typeof manifest.context.total_tokens === "number");
  assert.deepEqual(board.getContext(workflowId, "T1", "context-executor", claim.claim.attempt_id), manifest);
  const legacy = { ...manifest };
  delete (legacy as any).completion;
  writeFileSync(claim.context_manifest, `${JSON.stringify(legacy)}\n`);
  assert.equal(
    board.getContext(workflowId, "T1", "context-executor", claim.claim.attempt_id).completion.required_action,
    "ai-kit agent result",
  );
});

test("retry result rejects completion when no declared file changed", () => {
  const workflowId = `node-retry-noop-${Date.now().toString(36)}`;
  board.createWorkflow("retry guard", "feature", workflowId, "planner");
  board.addTask({
    workflow_id: workflowId,
    id: "T1",
    title: "retry without a change",
    owner: "backend",
    phase: "build",
    files: [".aikit-noop-file.txt"],
    acceptance: ["must change a file"],
  });
  let claim = board.claimNext("retry-executor", workflowId) as any;
  const path = workflowStatePath(workflowId);
  const state = load<any>(path);
  state.tasks[0].claim.lease_expires_at = "2000-01-01T00:00:00Z";
  save(state, path, state.revision);
  claim = board.claimNext("retry-executor", workflowId) as any;
  assert.equal(load<any>(path).tasks[0].attempts, 2);
  assert.throws(
    () => board.submitResult(workflowId, "T1", "retry-executor", claim.claim.attempt_id, "reported pass"),
    /no declared file changed/,
  );
  assert.equal(load<any>(path).tasks[0].status, "in-progress");
});

test("status recovers an expired claim to todo", () => {
  const workflowId = `node-lease-recovery-${Date.now().toString(36)}`;
  board.createWorkflow("lease recovery", "feature", workflowId, "planner");
  board.addTask({
    workflow_id: workflowId,
    id: "T1",
    title: "expired",
    owner: "backend",
    phase: "build",
    acceptance: ["recovered"],
  });
  board.claimNext("dead-worker", workflowId);
  const path = workflowStatePath(workflowId);
  const state = load<any>(path);
  state.tasks[0].claim.lease_expires_at = "2000-01-01T00:00:00Z";
  save(state, path, state.revision);
  assert.equal(board.status(workflowId).counts.todo, 1);
  assert.equal(load<any>(path).tasks[0].claim, null);
});

test("status warns about dirty work without a claim and clears it for an active claim", () => {
  const workflowId = `node-status-warning-${Date.now().toString(36)}`;
  const marker = join(PROJECT_ROOT, `.aikit-status-warning-${Date.now().toString(36)}`);
  board.createWorkflow("status guardrail", "feature", workflowId, "planner");
  board.addTask({
    workflow_id: workflowId,
    id: "T1",
    title: "guard",
    owner: "backend",
    phase: "build",
    acceptance: ["warns"],
  });
  writeFileSync(marker, "unclaimed\n");
  try {
    const warning = board.status(workflowId);
    assert.equal(warning.warnings[0].code, "worktree-changed-without-active-claim");
    const claim = board.claimNext("copilot-extension", workflowId) as any;
    assert.deepEqual(board.status(workflowId).warnings, []);
    assert.equal(claim.client_id, "copilot-extension");
  } finally {
    rmSync(marker, { force: true });
  }
});
