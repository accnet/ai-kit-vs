import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as board from "../.ai/node/board.js";
import { seedWorkflow } from "./helpers.js";

test("planContext gives the planner a ranked, budgeted context manifest", () => {
  const wf = seedWorkflow();
  const path = board.planContext(wf, "planner:stub");
  const manifest = JSON.parse(readFileSync(path, "utf8"));

  // Routed to the planner role contract.
  assert.equal(manifest.route.owner, "planner");
  assert.equal(manifest.route.role_contract, ".ai/agents/planner");

  // Context Engine ran: a ranked, token-budgeted selection is present.
  assert.ok(Array.isArray(manifest.context.included) && manifest.context.included.length > 0);
  assert.equal(manifest.context.included[0].path, ".ai/engine/state-schema.md");
  assert.ok(typeof manifest.context.total_tokens === "number");
});
