import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const NODE_DIR = join(fileURLToPath(new URL("../.ai/node", import.meta.url)));
const CLI = join(NODE_DIR, "ai-kit.ts");
const TSX = join(NODE_DIR, "node_modules", "tsx", "dist", "cli.mjs");

const run = (state: string, args: string[]) =>
  spawnSync(process.execPath, [TSX, CLI, "--state", state, ...args], {
    encoding: "utf8",
  });

test("graph escapes quotes and backslashes so DOT stays valid", () => {
  const work = mkdtempSync(join(tmpdir(), "aikit-graph-"));
  const state = join(work, "workflow.json");
  assert.equal(run(state, ["init", "--title", "Demo", "--workflow", "feature"]).status, 0);
  const add = run(state, [
    "add-task",
    "T1",
    "--title",
    'He said "hi" \\ bye',
    "--owner",
    "qa",
    "--phase",
    "build",
    "--acceptance",
    "ok",
  ]);
  assert.equal(add.status, 0, add.stderr);
  const graph = run(state, ["graph"]);
  assert.equal(graph.status, 0, graph.stderr);
  const dot = JSON.parse(graph.stdout) as string;
  // Every double-quote inside the label must be backslash-escaped.
  assert.match(dot, /label="T1: He said \\"hi\\" \\\\ bye"/);
  // No raw unescaped quote sequence that would break Graphviz parsing.
  assert.ok(!/said "hi"/.test(dot), "label contains an unescaped quote");
});

test("CLI preserves repeated list options", () => {
  const work = mkdtempSync(join(tmpdir(), "aikit-cli-options-"));
  const state = join(work, "workflow.json");
  assert.equal(run(state, ["init", "--title", "Demo", "--workflow", "feature"]).status, 0);
  for (const id of ["T0", "T-1"]) {
    const dependency = run(state, [
      "add-task",
      id,
      "--title",
      id,
      "--owner",
      "backend",
      "--phase",
      "build",
      "--acceptance",
      "done",
    ]);
    assert.equal(dependency.status, 0, dependency.stderr);
  }
  const add = run(state, [
    "add-task",
    "T1",
    "--title",
    "multi-value task",
    "--owner",
    "backend",
    "--phase",
    "build",
    "--acceptance",
    "first criterion",
    "--acceptance",
    "second criterion",
    "--needs",
    "T0",
    "--needs",
    "T-1",
    "--files",
    "src/one.ts",
    "--files",
    "src/two.ts",
    "--tags",
    "api",
    "--tags",
    "security",
  ]);
  assert.equal(add.status, 0, add.stderr);
  const task = JSON.parse(add.stdout) as { acceptance: string[]; needs: string[]; files: string[]; tags: string[] };
  assert.deepEqual(task.acceptance, ["first criterion", "second criterion"]);
  assert.deepEqual(task.needs, ["T0", "T-1"]);
  assert.deepEqual(task.files, ["src/one.ts", "src/two.ts"]);
  assert.deepEqual(task.tags, ["api", "security"]);
});
