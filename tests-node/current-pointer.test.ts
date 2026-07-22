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
    const selected = JSON.parse(readFileSync(join(work, "state/current.json"), "utf8"));
    assert.equal(selected.workflow_state, join(work, "workflows/beta/state/workflow.json"));

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

test("workflow use updates the pointer and refuses to hide a live claim", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-workflow-use-project-"));
  const work = mkdtempSync(join(tmpdir(), "aikit-workflow-use-work-"));
  try {
    for (const id of ["alpha", "beta"])
      assert.equal(run(project, work, ["workflow-create", id, "--title", id, "--workflow", "feature"]).status, 0);
    let result = run(project, work, ["workflow", "use", "beta", "--actor", "test"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).workflow_id, "beta");
    result = run(project, work, ["status"]);
    assert.equal(JSON.parse(result.stdout).title, "beta");

    addTask(project, work, "alpha");
    result = run(project, work, ["agent", "claim", "--workflow-id", "alpha", "--client-id", "client-alpha"]);
    assert.equal(result.status, 0, result.stderr);
    result = run(project, work, ["workflow", "use", "beta"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /active claims remain in alpha/);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});

test("add-task targets an explicit workflow id or state path", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-add-task-scope-project-"));
  const work = mkdtempSync(join(tmpdir(), "aikit-add-task-scope-work-"));
  try {
    for (const id of ["alpha", "beta"])
      assert.equal(run(project, work, ["workflow-create", id, "--title", id, "--workflow", "feature"]).status, 0);
    let result = run(project, work, [
      "add-task",
      "B1",
      "--workflow-id",
      "beta",
      "--title",
      "beta task",
      "--owner",
      "backend",
      "--phase",
      "build",
      "--acceptance",
      "scoped",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const beta = JSON.parse(readFileSync(join(work, "workflows/beta/state/workflow.json"), "utf8"));
    assert.equal(beta.tasks[0].id, "B1");
    const alphaState = join(work, "workflows/alpha/state/workflow.json");
    result = run(project, work, [
      "add-task",
      "A1",
      "--state",
      alphaState,
      "--title",
      "alpha task",
      "--owner",
      "backend",
      "--phase",
      "build",
      "--acceptance",
      "inline state",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const alpha = JSON.parse(readFileSync(alphaState, "utf8"));
    assert.equal(alpha.tasks[0].id, "A1");
    const current = JSON.parse(readFileSync(join(work, "state/current.json"), "utf8"));
    assert.equal(current.workflow_state, join(work, "workflows/beta/state/workflow.json"));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});
