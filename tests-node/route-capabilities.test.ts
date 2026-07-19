import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as board from "../.ai/node/board.js";
import { seedWorkflow } from "./helpers.js";

test("board.route surfaces capabilities whose role contract covers the task owner", () => {
  const id = seedWorkflow({ owner: "backend" });
  const routed = board.route(id, "T1") as { owner: string; skills: string[]; capabilities: string[] };
  assert.equal(routed.owner, "backend");
  assert.ok(Array.isArray(routed.capabilities));
  // The shipped "backend" capability references the backend agent.
  assert.ok(routed.capabilities.includes("backend"), JSON.stringify(routed.capabilities));
});

test("board.route reports no capabilities for an owner none reference", () => {
  const id = seedWorkflow({ owner: "planner" });
  const routed = board.route(id, "T1") as { capabilities: string[] };
  assert.deepEqual(routed.capabilities, []);
});
