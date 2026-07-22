import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
    "-",
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
  assert.equal(plugin.prompt_transport, "stdin");
  assert.ok(plugin.command.includes("--output-last-message"));
  assert.ok(plugin.command.includes("-"));
  assert.equal(plugin.command.includes("{prompt}"), false);
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
  assert.match(value, /optional nullable branch/);
  assert.match(value, /Do not use completed, files_changed, acceptance/);
  assert.match(value, /wrapper writes the final response/);
});

test("planner prompt names the strict plan artifact schema", () => {
  const value = prompt("planner", "/tmp/assignment.json", "/tmp/plan.json");
  assert.match(value, /kind="plan"/);
  assert.match(value, /Each task must use id, title, owner, phase, needs, acceptance, files, and tags/);
  assert.match(value, /Never use generic owner names such as executor or implementer/);
});

test("prompt inlines the context manifest's already-selected sources instead of pointing at files to re-read", () => {
  const directory = mkdtempSync(join(tmpdir(), "aikit-prompt-context-"));
  try {
    const planDoc = join(directory, "plan.md");
    writeFileSync(planDoc, "# Plan\n\nBuild the thing.");
    const manifestPath = join(directory, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({ context: { included: [{ path: planDoc, tokens: 10 }] } }));

    const value = prompt("executor", "/tmp/assignment.json", "/tmp/result.json", manifestPath);
    assert.match(value, /do not re-read them/);
    assert.match(value, new RegExp(`--- ${planDoc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ---`));
    assert.match(value, /Build the thing\./);
    assert.doesNotMatch(value, /load only the sources listed under its/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("prompt falls back to pointing at the context manifest when none is inlined", () => {
  const value = prompt("executor", "/tmp/assignment.json", "/tmp/result.json");
  assert.match(value, /load only the sources listed under its `context.included`/);
});

test("prompt carries the completion reminder from an inlined context manifest", () => {
  const directory = mkdtempSync(join(tmpdir(), "aikit-prompt-reminder-"));
  try {
    const manifestPath = join(directory, "manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        context: { included: [] },
        completion: { reminder: "REMINDER: call ai-kit agent result." },
      }),
    );
    assert.match(
      prompt("executor", "/tmp/assignment.json", "/tmp/result.json", manifestPath),
      /call ai-kit agent result/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
