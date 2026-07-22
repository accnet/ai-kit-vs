import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as engine from "../.ai/node/engine.js";
import { buildBundle } from "../.ai/node/context-builder.js";
import { seedWorkflow } from "./helpers.js";

function firstTask(wf: string) {
  const state = engine.load<engine.State>(engine.workflowStatePath(wf));
  return { task: engine.taskMap(state).get("T1")!, statePath: engine.workflowStatePath(wf) };
}

test("buildBundle gathers all source groups plus a budgeted context", () => {
  const wf = seedWorkflow({ owner: "backend" });
  const { task, statePath } = firstTask(wf);
  const bundle = buildBundle(task, statePath);

  assert.equal(bundle.task, "T1");
  assert.ok(Array.isArray(bundle.workspace));
  assert.ok("branch" in bundle.git && Array.isArray(bundle.git.changed));
  assert.ok(bundle.architecture.includes(".ai/engine/state-schema.md"), "architecture must include the state contract");
  assert.deepEqual(bundle.requirement.acceptance, ["done"]);
  assert.ok(bundle.requirement.docs.some((d) => d.endsWith("plan/plan.md")));
  assert.equal(
    bundle.context.included.some((item) => item.path.endsWith("tasks/tasks.md")),
    false,
  );
  assert.ok(bundle.requirement.docs.some((d) => d.endsWith("T1-requirements.md")));
  assert.ok(Array.isArray(bundle.memory));
  // Context Engine ran over the gathered files.
  assert.ok(bundle.context.included.length > 0);
  assert.equal(bundle.context.included[0].path, ".ai/engine/state-schema.md");
});

test("the same bundle serves any role (planner and executor use it identically)", () => {
  const wf = seedWorkflow({ owner: "planner" });
  const { task, statePath } = firstTask(wf);
  const bundle = buildBundle(task, statePath);
  assert.equal(bundle.task, "T1");
  // Independent of role: still gathers architecture + requirement.
  assert.ok(bundle.architecture.includes(".ai/engine/state-schema.md"));
  assert.ok(bundle.context.total_tokens > 0);
});
