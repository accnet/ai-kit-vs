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
