import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as agent from "../.ai/node/agent.js";
import * as board from "../.ai/node/board.js";
import { workspace, workflowStatePath } from "../.ai/node/engine.js";

test("agent client claims, loads context, submits evidence, and preserves gates", () => {
  const workflowId = `agent-client-${Date.now().toString(36)}`;
  board.createWorkflow("Agent client", "feature", workflowId, "planner");
  board.addTask({
    workflow_id: workflowId,
    id: "T1",
    title: "build",
    owner: "backend",
    phase: "build",
    acceptance: ["works"],
    files: ["tests-node"],
  });
  const workflowRoot = workspace(workflowStatePath(workflowId));
  assert.match(readFileSync(`${workflowRoot}/plan/plan.md`, "utf8"), /Agent client/);
  assert.match(readFileSync(`${workflowRoot}/tasks/tasks.md`, "utf8"), /T1 build/);

  const claim: any = agent.claim(workflowId, "codex-extension");
  assert.equal(claim.claimed, "T1");
  assert.ok(claim.assignment);
  assert.equal(JSON.parse(readFileSync(claim.assignment, "utf8")).kind, "assignment");
  const manifest = JSON.parse(readFileSync(claim.context_manifest, "utf8")) as {
    sources: { path: string; sha256: string | null }[];
  };
  assert.ok(manifest.sources.some((source) => source.path === "tests-node" && source.sha256));
  assert.equal(agent.context(workflowId, "T1", "codex-extension", claim.claim.attempt_id).task, "T1");

  agent.heartbeat(workflowId, "T1", "codex-extension", claim.claim.attempt_id);
  agent.submitResult(
    workflowId,
    "T1",
    "codex-extension",
    claim.claim.attempt_id,
    "implemented",
    "pass",
    ["src/example.ts"],
    ["npm test"],
  );
  agent.submitQa(workflowId, "T1", "local-qa", "pass", "verified", ["npm test"]);
  agent.submitReview(workflowId, "T1", "claude-extension", "approve", "approved");
  assert.equal(board.close(workflowId, "T1", "gatekeeper").status, "done");
});

test("agent claims accept an explicit longer lease for editor clients", () => {
  const workflowId = `agent-lease-${Date.now().toString(36)}`;
  board.createWorkflow("Agent lease", "feature", workflowId, "planner");
  board.addTask({
    workflow_id: workflowId,
    id: "T1",
    title: "long build",
    owner: "backend",
    phase: "build",
    acceptance: ["lease is configurable"],
  });
  const before = Date.now();
  const claim: any = agent.claim(workflowId, "codex-extension", undefined, 1200);
  const expires = Date.parse(claim.claim.lease_expires_at);
  assert.ok(expires - before >= 1199000);
  assert.ok(expires - before <= 1201000);
});

test("agent targeted claim selects the requested runnable task and preserves next-task claiming", () => {
  const workflowId = `agent-targeted-${Date.now().toString(36)}`;
  board.createWorkflow("Agent targeted claim", "feature", workflowId, "planner");
  for (const id of ["T1", "T2"])
    board.addTask({
      workflow_id: workflowId,
      id,
      title: id,
      owner: "backend",
      phase: "build",
      acceptance: ["claimable"],
    });

  const targeted: any = agent.claimTask(workflowId, "targeted-client", "T2");
  assert.equal(targeted.claimed, "T2");
  assert.equal(targeted.claim.attempt_id.startsWith("T2-1-"), true);
  const next: any = board.claimNext("queue-client", workflowId);
  assert.equal(next.claimed, "T1");
  assert.throws(() => agent.claimTask(workflowId, "targeted-client", "missing"), /unknown task: missing/);
});

test("Copilot finish discovers its active claim and submits implementation evidence", () => {
  const workflowId = `copilot-finish-${Date.now().toString(36)}`;
  board.createWorkflow("Copilot finish", "feature", workflowId, "planner");
  board.addTask({
    workflow_id: workflowId,
    id: "T1",
    title: "finishable task",
    owner: "backend",
    phase: "build",
    acceptance: ["finish submits result"],
  });
  const claim: any = agent.claim(workflowId, "copilot-extension");
  const result = agent.finish({
    workflowId,
    summary: "Copilot completed the implementation",
    changedPaths: ["src/example.ts"],
    commands: ["npm test"],
  });
  assert.equal(result.status, "implementation-complete");
  assert.equal(result.attempt_id, claim.claim.attempt_id);
  assert.equal(board.pendingReview(workflowId).awaiting_qa[0].id, "T1");
});
