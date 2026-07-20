import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const TSX = join(REPO, ".ai/node/node_modules/tsx/dist/cli.mjs");
const CLI = join(REPO, ".ai/node/ai-kit.ts");

function run(project: string, work: string, args: string[]) {
  return spawnSync(process.execPath, [TSX, CLI, ...args], {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, AIKIT_ROOT: REPO, AIKIT_PROJECT_ROOT: project, AIKIT_WORK: work },
  });
}

test("CLI copilot finish auto-discovers the active claim", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-copilot-finish-project-"));
  const work = mkdtempSync(join(tmpdir(), "aikit-copilot-finish-work-"));
  try {
    let result = run(project, work, ["workflow-create", "demo", "--title", "Copilot demo", "--workflow", "feature"]);
    assert.equal(result.status, 0, result.stderr);
    const state = join(work, "workflows", "demo", "state", "workflow.json");
    result = run(project, work, [
      "--state",
      state,
      "add-task",
      "T1",
      "--title",
      "Finish task",
      "--owner",
      "backend",
      "--phase",
      "build",
      "--acceptance",
      "result is submitted",
    ]);
    assert.equal(result.status, 0, result.stderr);
    result = run(project, work, ["agent", "claim", "--workflow-id", "demo", "--client-id", "copilot-extension"]);
    assert.equal(result.status, 0, result.stderr);
    const claim = JSON.parse(result.stdout);
    result = run(project, work, ["copilot", "finish", "--summary", "Copilot finished the task"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).attempt_id, claim.claim.attempt_id);
    const finalState = JSON.parse(readFileSync(state, "utf8"));
    assert.equal(finalState.tasks[0].status, "implementation-complete");
    assert.equal(finalState.tasks[0].claim, null);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});
