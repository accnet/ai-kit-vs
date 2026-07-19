import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const TSX = join(REPO, ".ai/node/node_modules/tsx/dist/cli.mjs");
const CLI = join(REPO, ".ai/node/ai-kit.ts");

function runCli(project: string, work: string, args: string[]) {
  return spawnSync(process.execPath, [TSX, CLI, ...args], {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, AIKIT_ROOT: REPO, AIKIT_PROJECT_ROOT: project, AIKIT_WORK: work },
  });
}

function runProbe(project: string, work: string, source: string, args: string[] = []) {
  const probe = join(project, "probe.ts");
  writeFileSync(probe, source);
  return spawnSync(process.execPath, [TSX, probe, ...args], {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, AIKIT_ROOT: REPO, AIKIT_PROJECT_ROOT: project, AIKIT_WORK: work },
  });
}

test("project memory is isolated from the shared kit and other projects", () => {
  const first = mkdtempSync(join(tmpdir(), "aikit-memory-first-"));
  const second = mkdtempSync(join(tmpdir(), "aikit-memory-second-"));
  const probe = `import { addMemory, listMemory, MEMORY_DIR } from ${JSON.stringify(join(REPO, ".ai/node/memory.ts"))};
if (process.argv[2] === "add") addMemory({ kind: "decision", title: "First project decision" });
console.log(JSON.stringify({ directory: MEMORY_DIR, titles: listMemory().map((entry) => entry.title) }));
`;
  try {
    let result = runProbe(first, join(first, ".ai-work"), probe, ["add"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      directory: join(first, ".ai-memory"),
      titles: ["First project decision"],
    });
    result = runProbe(second, join(second, ".ai-work"), probe);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { directory: join(second, ".ai-memory"), titles: [] });
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

test("AIKIT_WORK refuses to serve a different project after binding", () => {
  const first = mkdtempSync(join(tmpdir(), "aikit-bound-first-"));
  const second = mkdtempSync(join(tmpdir(), "aikit-bound-second-"));
  const work = mkdtempSync(join(tmpdir(), "aikit-bound-work-"));
  try {
    let result = runCli(first, work, ["init", "--title", "First", "--workflow", "feature"]);
    assert.equal(result.status, 0, result.stderr);
    const currentPath = join(work, "state", "current.json");
    const legacyCurrent = JSON.parse(readFileSync(currentPath, "utf8")) as Record<string, unknown>;
    delete legacyCurrent.project_root;
    writeFileSync(currentPath, `${JSON.stringify(legacyCurrent)}\n`);
    result = runCli(first, work, ["bind"]);
    assert.equal(result.status, 0, result.stderr);
    result = runCli(second, work, ["status"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /work state belongs to/);
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});

test("project paths do not fall back to arbitrary files in the shared kit", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-path-isolation-"));
  try {
    const result = runProbe(
      project,
      join(project, ".ai-work"),
      `import { resolveProjectPath } from ${JSON.stringify(join(REPO, ".ai/node/engine.ts"))};
console.log(JSON.stringify({ project: resolveProjectPath("README.md"), shared: resolveProjectPath(".ai/engine/state-schema.md") }));
`,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      project: join(project, "README.md"),
      shared: join(REPO, ".ai/engine/state-schema.md"),
    });
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("project lock detects project configuration drift", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-project-lock-"));
  const work = join(project, ".ai-work");
  try {
    writeFileSync(join(project, "package.json"), '{"name":"project-lock-test"}\n');
    const config = join(project, ".ai-work", "project.yaml");
    mkdirSync(work, { recursive: true });
    writeFileSync(config, "project:\n  stack: [typescript]\n");

    let result = runCli(project, work, ["lock"]);
    assert.equal(result.status, 0, result.stderr);
    result = runCli(project, work, ["verify-lock"]);
    assert.equal(result.status, 0, result.stderr);
    writeFileSync(config, "project:\n  stack: [python]\n");
    result = runCli(project, work, ["verify-lock"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /project_config/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
