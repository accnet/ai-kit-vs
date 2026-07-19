import { strict as assert } from "node:assert";
import { test } from "node:test";
import { listProviders } from "../.ai/node/models.js";

test("listProviders maps configured roles to their provider binary", () => {
  const source = ["planner: codex", "executor: codex", "qa: local", "reviewer: claude"].join("\n");
  const providers = listProviders(source);
  const byRole = Object.fromEntries(providers.map((p) => [p.role, p]));
  assert.deepEqual(
    providers.map((p) => p.role),
    ["planner", "executor", "qa", "reviewer"],
  );
  assert.equal(byRole.executor.plugin, "codex");
  assert.equal(byRole.executor.provider, "codex");
  assert.equal(byRole.reviewer.provider, "claude");
  assert.equal(byRole.qa.plugin, "local");
  assert.ok(byRole.qa.command.length > 0);
});

test("listProviders reports nulls for an unconfigured role", () => {
  const providers = listProviders("executor: codex");
  const planner = providers.find((p) => p.role === "planner")!;
  assert.equal(planner.plugin, null);
  assert.equal(planner.provider, null);
});
