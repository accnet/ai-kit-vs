import { strict as assert } from "node:assert";
import { test } from "node:test";
import { loadPlugin, listPlugins } from "../.ai/node/plugins.js";
import { assertCommandAllowed, loadSecurityPolicy } from "../.ai/node/security.js";

test("Cursor uses the same plugin interface as Claude and Codex", () => {
  for (const role of ["planner", "executor", "reviewer"] as const) {
    const cursor = loadPlugin(role, "cursor");
    assert.equal(cursor.transport, "cli");
    assert.equal(cursor.command[0], "cursor-agent");
    // Same {prompt} placeholder contract as the other providers.
    assert.ok(cursor.command.includes("{prompt}"));
  }
});

test("cursor-agent is allowlisted so Cursor plugins can launch", () => {
  const policy = loadSecurityPolicy();
  assert.doesNotThrow(() => assertCommandAllowed(["cursor-agent", "-p", "x"], policy));
});

test("shipped plugins include cursor alongside claude and codex", () => {
  const ids = new Set(listPlugins().map((p) => p.id));
  for (const id of ["claude", "codex", "cursor"]) assert.ok(ids.has(id), `missing plugin id: ${id}`);
});
