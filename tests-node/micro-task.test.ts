import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const TSX = join(REPO, ".ai/node/node_modules/tsx/dist/cli.mjs");
const CLI = join(REPO, ".ai/node/ai-kit.ts");
const GATE = join(REPO, ".ai/node/gate-runner.ts");

function run(project: string, args: string[]) {
  return spawnSync(process.execPath, [TSX, CLI, ...args], {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      AIKIT_ROOT: REPO,
      AIKIT_PROJECT_ROOT: project,
      AIKIT_WORK: join(project, ".ai-work"),
    },
  });
}

test("micro-task runs through CLI, independent QA, and policy close", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-micro-task-"));
  try {
    let result = run(project, ["setup"]);
    assert.equal(result.status, 0, result.stderr);
    writeFileSync(
      join(project, ".ai-work", "project.yaml"),
      [
        "workflow:",
        "  micro_tasks:",
        "    enabled: true",
        "    max_files: 2",
        "    require_qa: true",
        "    require_review: false",
        "verification:",
        "  test_command: node --version",
      ].join("\n") + "\n",
    );

    result = run(project, [
      "micro-task",
      "T1",
      "--title",
      "Fix a small defect",
      "--owner",
      "backend",
      "--workflow-id",
      "default",
      "--files",
      "src/example.ts",
      "--acceptance",
      "focused check passes",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).task.tags, ["micro"]);

    result = run(project, ["agent", "claim", "--workflow-id", "default", "--client-id", "codex-extension"]);
    assert.equal(result.status, 0, result.stderr);
    const claim = JSON.parse(result.stdout);
    assert.equal(claim.claimed, "T1");

    result = run(project, [
      "agent",
      "result",
      "--workflow-id",
      "default",
      "--task-id",
      "T1",
      "--client-id",
      "codex-extension",
      "--attempt-id",
      claim.claim.attempt_id,
      "--status",
      "pass",
      "--summary",
      "small defect fixed",
      "--changed-path",
      "src/example.ts",
      "--command",
      "node --version",
    ]);
    assert.equal(result.status, 0, result.stderr);

    result = spawnSync(process.execPath, [TSX, GATE, "default", "--once", "--verify"], {
      cwd: project,
      encoding: "utf8",
      env: {
        ...process.env,
        AIKIT_ROOT: REPO,
        AIKIT_PROJECT_ROOT: project,
        AIKIT_WORK: join(project, ".ai-work"),
      },
    });
    assert.equal(result.status, 0, result.stderr);

    const state = JSON.parse(
      readFileSync(join(project, ".ai-work", "workflows", "default", "state", "workflow.json"), "utf8"),
    );
    assert.equal(state.tasks[0].status, "done");
    assert.deepEqual(
      state.events
        .filter((event: { task?: string }) => event.task === "T1")
        .map((event: { action: string }) => event.action),
      ["add-task", "start", "complete", "qa-pass", "micro-close"],
    );
    assert.equal(
      state.events.some((event: { action: string }) => event.action === "review-approve"),
      false,
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
