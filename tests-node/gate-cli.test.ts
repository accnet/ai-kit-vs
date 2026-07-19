import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const TSX = join(REPO, ".ai/node/node_modules/tsx/dist/cli.mjs");
const CLI = join(REPO, ".ai/node/gate-runner.ts");

const envFor = (project: string, work: string) => ({
  ...process.env,
  AIKIT_ROOT: REPO,
  AIKIT_PROJECT_ROOT: project,
  AIKIT_WORK: work,
});

test("gate CLI rejects review because review is an agent artifact, not a gate-runner role", () => {
  const result = spawnSync(process.execPath, [TSX, CLI, "workflow", "--roles", "review", "--once"], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /review must be submitted through ai-kit agent review/);
});

test("gate CLI help documents verification defaults and explicit bypass", () => {
  const result = spawnSync(process.execPath, [TSX, CLI, "--help"], { cwd: REPO, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--skip-verify/);
  assert.match(result.stdout, /--roles qa,release/);
});

test("gate CLI blocks a task when the default verification command fails", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-gate-failing-project-"));
  const work = join(project, ".ai-work");
  try {
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, "project.yaml"), 'verification:\n  test_command: node -e "process.exit(7)"\n');
    const probe = join(project, "seed.ts");
    writeFileSync(
      probe,
      `import * as board from ${JSON.stringify(join(REPO, ".ai/node/board.ts"))};
const workflow = "failing-gate";
board.createWorkflow("Failing gate", "feature", workflow, "planner");
board.addTask({ workflow_id: workflow, id: "T1", title: "build", owner: "backend", phase: "build", acceptance: ["works"], actor: "planner" });
const claim = board.claimNext("executor", workflow) as { claim: { attempt_id: string } };
board.submitResult(workflow, "T1", "executor", claim.claim.attempt_id, "implemented");
`,
    );
    let result = spawnSync(process.execPath, [TSX, probe], {
      cwd: project,
      env: envFor(project, work),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    result = spawnSync(process.execPath, [TSX, CLI, "failing-gate", "--once"], {
      cwd: project,
      env: envFor(project, work),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /qa-fail/);
    const state = JSON.parse(readFileSync(join(work, "workflows/failing-gate/state/workflow.json"), "utf8"));
    assert.equal(state.tasks[0].status, "blocked");
    assert.match(state.tasks[0].blocked_reason, /verification failed/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
