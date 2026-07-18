import assert from "node:assert/strict";
import test from "node:test";
import * as board from "../.ai/node/board.js";
import { runGateCycle } from "../.ai/node/gate-runner.js";
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

test("gate-runner drives an independent QA, review, and close for another client", () => {
  const workflowId = `node-gate-${Date.now().toString(36)}`;
  seed(workflowId, "codex");
  const acted = runGateCycle(workflowId, "gatekeeper");
  assert.deepEqual(
    acted.map((entry) => entry.action),
    ["qa-pass", "review-approve", "close"],
  );
  assert.equal(statusOf(workflowId, "T1"), "done");
});

test("gate-runner refuses to gate the client's own attempt", () => {
  const workflowId = `node-gate-self-${Date.now().toString(36)}`;
  seed(workflowId, "codex");
  const acted = runGateCycle(workflowId, "codex");
  assert.deepEqual(acted, []);
  assert.equal(statusOf(workflowId, "T1"), "implementation-complete");
});
