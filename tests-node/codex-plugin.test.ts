import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { prompt } from "../.ai/node/run-plugin.js";

const REPO = fileURLToPath(new URL("..", import.meta.url));

test("Codex reviewer writes the final JSON artifact without project write access", () => {
  const plugin = JSON.parse(readFileSync(join(REPO, ".ai/plugins/reviewer/codex.json"), "utf8"));
  assert.deepEqual(plugin.command, [
    "codex",
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--add-dir",
    "{work}",
    "-c",
    "model_reasoning_effort=low",
    "--output-last-message",
    "{output}",
    "{prompt}",
  ]);
});

test("Codex planner writes a low-reasoning plan artifact", () => {
  const plugin = JSON.parse(readFileSync(join(REPO, ".ai/plugins/planner/codex.json"), "utf8"));
  assert.ok(plugin.command.includes("model_reasoning_effort=low"));
  assert.ok(plugin.command.includes("--output-last-message"));
  assert.ok(plugin.command.includes("--add-dir"));
  assert.ok(plugin.command.includes("{work}"));
  assert.ok(plugin.command.includes("{output}"));
});

test("Codex executor writes its result artifact", () => {
  const plugin = JSON.parse(readFileSync(join(REPO, ".ai/plugins/executor/codex.json"), "utf8"));
  assert.ok(plugin.command.includes("--output-last-message"));
  assert.ok(plugin.command.includes("--add-dir"));
  assert.ok(plugin.command.includes("{work}"));
  assert.ok(plugin.command.includes("{output}"));
});

test("reviewer prompt names the strict review artifact schema", () => {
  const value = prompt("reviewer", "/tmp/assignment.json", "/tmp/review.json");
  assert.match(value, /verdict must be exactly "approve" or "changes-requested"/);
  assert.match(value, /Do not use status, summary, findings, or evidence/);
});

test("executor prompt names the strict result artifact schema", () => {
  const value = prompt("executor", "/tmp/assignment.json", "/tmp/result.json");
  assert.match(value, /status must be exactly "pass" or "fail"/);
  assert.match(value, /Do not use completed, files_changed, acceptance/);
  assert.match(value, /wrapper writes the final response/);
});

test("planner prompt names the strict plan artifact schema", () => {
  const value = prompt("planner", "/tmp/assignment.json", "/tmp/plan.json");
  assert.match(value, /kind="plan"/);
  assert.match(value, /Each task must use id, title, owner, phase, needs, acceptance, files, and tags/);
  assert.match(value, /Never use generic owner names such as executor or implementer/);
});
