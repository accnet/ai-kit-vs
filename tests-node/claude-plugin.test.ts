import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));

test("Claude executor has explicit non-interactive file and check permissions", () => {
  const plugin = JSON.parse(readFileSync(join(REPO, ".ai/plugins/executor/claude.json"), "utf8"));
  const command = plugin.command as string[];
  assert.equal(command[0], "claude");
  assert.ok(command.includes("--allowedTools"));
  for (const tool of ["Read", "Write", "Edit", "Bash(node --check *)", "Bash(npm *)"]) {
    assert.ok(command.includes(tool), `missing Claude tool permission: ${tool}`);
  }
  assert.ok(command.includes("-p"));
  assert.ok(command.includes("{prompt}"));
});

test("Claude planner can write its plan artifact", () => {
  const plugin = JSON.parse(readFileSync(join(REPO, ".ai/plugins/planner/claude.json"), "utf8"));
  const command = plugin.command as string[];
  assert.equal(command[0], "claude");
  assert.ok(command.includes("--allowedTools"));
  assert.ok(command.includes("Read"));
  assert.ok(command.includes("Write"));
});
