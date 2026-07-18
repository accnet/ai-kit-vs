import assert from "node:assert/strict";
import test from "node:test";
import { createWorkflow } from "../.ai/node/board.js";
import { listWorkers, startWorker, stopWorker, workerStatus } from "../.ai/node/worker-manager.js";

test("Node worker manager starts and gracefully stops a whitelisted idle worker", async () => {
  const workflowId = `node-worker-${Date.now().toString(36)}`;
  createWorkflow("Node worker", "feature", workflowId, "planner");
  const worker = startWorker("codex", workflowId);
  assert.equal(worker.status, "running");
  assert.ok(listWorkers(workflowId).some((item) => item.id === worker.id));
  stopWorker(worker.id);
  let current = workerStatus(worker.id);
  for (let attempt = 0; attempt < 40 && current.status === "stopping"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    current = workerStatus(worker.id);
  }
  assert.equal(current.status, "stopped");
  assert.equal(stopWorker(worker.id).status, "stopped");
});
