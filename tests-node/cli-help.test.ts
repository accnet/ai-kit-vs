import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const TSX = join(REPO, ".ai/node/node_modules/tsx/dist/cli.mjs");
const CLI = join(REPO, ".ai/node/ai-kit.ts");

function run(project: string, args: string[]) {
  return spawnSync(process.execPath, [TSX, CLI, ...args], {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, AIKIT_ROOT: REPO, AIKIT_PROJECT_ROOT: project, AIKIT_WORK: join(project, ".ai-work") },
  });
}

test("CLI help exits successfully before validation or side effects", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-cli-help-"));
  try {
    const cases = [
      { args: ["--help"], marker: "Usage: ai-kit <command>" },
      { args: ["plan", "--help"], marker: "Usage: ai-kit plan" },
      { args: ["add-task", "--help"], marker: "--workflow-id <id>" },
      { args: ["workflow-create", "--help"], marker: "--title <text>" },
      { args: ["workflow", "use", "--help"], marker: "Usage: ai-kit workflow use" },
      { args: ["setup", "--help"], marker: "Usage: ai-kit setup" },
      { args: ["lock", "--help"], marker: "Usage: ai-kit lock" },
      { args: ["status", "--help"], marker: "Usage: ai-kit status" },
      { args: ["copilot", "finish", "--help"], marker: "Usage: ai-kit copilot finish" },
      { args: ["events", "--help"], marker: "--after-cursor <n>" },
      { args: ["watch", "--help"], marker: "newline-delimited" },
      { args: ["memory", "add", "--help"], marker: "Usage: ai-kit memory add" },
      { args: ["agent", "--help"], marker: "--attempt-id <id>" },
    ];
    for (const item of cases) {
      const result = run(project, item.args);
      assert.equal(result.status, 0, `${item.args.join(" ")}: ${result.stderr}`);
      assert.match(result.stdout, new RegExp(item.marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.equal(result.stderr, "");
    }
    assert.deepEqual(readdirSync(project), []);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("short help alias works and explicit state path does not create files", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-cli-help-state-"));
  try {
    const state = join(project, ".ai-work", "workflows", "x", "state", "workflow.json");
    const result = run(project, ["--state", state, "plan", "-h"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: ai-kit plan/);
    assert.deepEqual(readdirSync(project), []);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("roles distinguishes task owners from provider roles", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-cli-roles-"));
  try {
    const result = run(project, ["roles"]);
    assert.equal(result.status, 0, result.stderr);
    const roles = JSON.parse(result.stdout);
    assert.ok(roles.task_owners.includes("architect"));
    assert.ok(!roles.task_owners.includes("executor"));
    assert.deepEqual(roles.provider_roles, ["planner", "executor", "qa", "reviewer"]);
    assert.deepEqual(readdirSync(project), []);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("plan rejects a provider role with actionable task-owner guidance", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-cli-owner-"));
  try {
    const result = run(project, [
      "plan",
      "--idea",
      "Crawl web pages",
      "--owner",
      "executor",
      "--acceptance",
      "crawl completes",
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /valid task owners:/);
    assert.match(result.stderr, /provider roles such as executor belong in models\.yaml/);
    assert.deepEqual(readdirSync(project), []);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("status follows the active workflow pointer instead of always using default", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-cli-active-"));
  try {
    let result = run(project, ["workflow-create", "crawl", "--title", "Crawl workflow", "--workflow", "feature"]);
    assert.equal(result.status, 0, result.stderr);
    result = run(project, ["status"]);
    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.title, "Crawl workflow");
    assert.deepEqual(status.warnings, []);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("status warns when a dirty worktree has no active task claim", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-cli-status-warning-"));
  try {
    const init = spawnSync("git", ["init", "-q"], { cwd: project, encoding: "utf8" });
    assert.equal(init.status, 0, init.stderr);
    writeFileSync(join(project, "changed.txt"), "unclaimed work\n");
    let result = run(project, ["workflow-create", "guardrails", "--title", "Guardrails", "--workflow", "feature"]);
    assert.equal(result.status, 0, result.stderr);
    result = run(project, ["status"]);
    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.warnings[0].code, "worktree-changed-without-active-claim");
    assert.ok(status.warnings[0].changed.includes("?? changed.txt"));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
