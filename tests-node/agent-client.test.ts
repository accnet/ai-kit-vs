import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as agent from "../.ai/node/agent.js";
import * as board from "../.ai/node/board.js";

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
    files: ["package.json"],
  });

  const claim: any = agent.claim(workflowId, "codex-extension");
  assert.equal(claim.claimed, "T1");
  assert.ok(claim.assignment);
  assert.equal(JSON.parse(readFileSync(claim.assignment, "utf8")).kind, "assignment");
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
