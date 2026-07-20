import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function addTask(project: string, work: string, workflowId: string) {
  const state = join(work, "workflows", workflowId, "state", "workflow.json");
  const result = run(project, work, [
    "--state",
    state,
    "add-task",
    "T1",
    "--title",
    `${workflowId} task`,
    "--owner",
    "backend",
    "--phase",
    "build",
    "--acceptance",
    "task is claimable",
  ]);
  assert.equal(result.status, 0, result.stderr);
}

test("current pointer merges parallel workflows and rejects ambiguous reads", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-current-pointer-project-"));
  const work = mkdtempSync(join(tmpdir(), "aikit-current-pointer-work-"));
  try {
    for (const id of ["alpha", "beta"]) {
      const created = run(project, work, ["workflow-create", id, "--title", id, "--workflow", "feature"]);
      assert.equal(created.status, 0, created.stderr);
      addTask(project, work, id);
      const claim = run(project, work, ["agent", "claim", "--workflow-id", id, "--client-id", `client-${id}`]);
      assert.equal(claim.status, 0, claim.stderr);
    }

    const current = JSON.parse(readFileSync(join(work, "state/current.json"), "utf8"));
    assert.deepEqual(Object.keys(current.active_workflows).sort(), ["alpha", "beta"]);

    let result = run(project, work, ["status"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /multiple active workflows/);
    assert.match(result.stderr, /--state/);
    result = run(project, work, ["ready"]);
    assert.equal(result.status, 2);

    for (const id of ["alpha", "beta"]) {
      result = run(project, work, ["--state", join(work, "workflows", id, "state", "workflow.json"), "status"]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).title, id);
    }

    // A legacy pointer without active_workflows remains readable.
    writeFileSync(
      join(work, "state/current.json"),
      JSON.stringify({ workflow_state: "workflows/alpha/state/workflow.json" }),
    );
    result = run(project, work, ["status"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).title, "alpha");
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});
