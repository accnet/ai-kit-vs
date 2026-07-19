import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addTask,
  EngineError,
  load,
  newState,
  routeTask,
  runnable,
  save,
  transition,
  validate,
} from "../.ai/node/engine.js";
import * as board from "../.ai/node/board.js";
import { listPlugins, pluginCommand } from "../.ai/node/plugins.js";

test("Node engine persists and transitions an evidence-gated workflow", () => {
  const directory = mkdtempSync(join(tmpdir(), "aikit-node-"));
  try {
    const path = join(directory, "state", "workflow.json");
    const state = newState("node", "feature");
    save(state, path);
    addTask(path, {
      id: "T1",
      title: "build",
      owner: "backend",
      phase: "build",
      acceptance: ["works"],
      actor: "planner",
    });
    transition(path, "T1", "start", "codex");
    transition(path, "T1", "complete", "codex");
    const current = load<any>(path);
    assert.equal(current.tasks[0].status, "implementation-complete");
    assert.equal(current.events.at(-1).action, "complete");
    validate(current);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Node plugin contract discovers role-scoped manifests", () => {
  assert.deepEqual(
    new Set(listPlugins("executor").map((plugin) => plugin.id)),
    new Set(["claude", "claude-code", "codex", "cursor", "gemini", "qwen"]),
  );
  const plugin = listPlugins("executor").find((item) => item.id === "codex")!;
  assert.ok(pluginCommand(plugin, "input.json", "output.json", "hello").includes("hello"));
  assert.ok(pluginCommand(plugin, "input.json", "output.json", "hello").includes("{work}") === false);
  const local = listPlugins("qa").find((item) => item.id === "local")!;
  assert.ok(pluginCommand(local, "input.json", "output.json", "hello")[1].startsWith("/"));
});

test("Node engine rejects invalid dependency graphs", () => {
  const state: any = newState("cycle", "feature");
  state.tasks = [
    {
      id: "T1",
      title: "one",
      owner: "backend",
      phase: "build",
      needs: ["T2"],
      status: "todo",
      acceptance: ["ok"],
      files: [],
      tags: [],
      attempts: 0,
      evidence: [],
      blocked_reason: null,
    },
    {
      id: "T2",
      title: "two",
      owner: "backend",
      phase: "build",
      needs: ["T1"],
      status: "todo",
      acceptance: ["ok"],
      files: [],
      tags: [],
      attempts: 0,
      evidence: [],
      blocked_reason: null,
    },
  ];
  assert.throws(() => validate(state), EngineError);
});

test("Node engine recovers an expired lock file", () => {
  const directory = mkdtempSync(join(tmpdir(), "aikit-node-lock-"));
  try {
    const path = join(directory, "state", "workflow.json");
    save(newState("locked", "feature"), path);
    writeFileSync(`${path}.lock`, JSON.stringify({ pid: 999999, created_at: "2000-01-01T00:00:00Z" }));
    const state = load<any>(path);
    state.title = "recovered";
    save(state, path, state.revision);
    assert.equal(load<any>(path).title, "recovered");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Node engine rejects missing or mismatched lifecycle evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "aikit-node-evidence-"));
  try {
    const path = join(directory, "state", "workflow.json");
    save(newState("evidence", "feature"), path);
    addTask(path, { id: "T1", title: "build", owner: "backend", phase: "build", acceptance: ["works"] });
    transition(path, "T1", "start", "codex");
    transition(path, "T1", "complete", "codex");
    assert.throws(() => transition(path, "T1", "qa-pass", "qa"), /requires at least one/);
    const evidence = join(directory, "wrong.json");
    writeFileSync(evidence, JSON.stringify({ kind: "qa", task: "other", status: "pass" }));
    assert.throws(() => transition(path, "T1", "qa-pass", "qa", "", [evidence]), /does not match/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Node router returns scoped core knowledge and state context", () => {
  const state = newState("routing", "feature"),
    task: any = { id: "T1", owner: "backend", tags: [], files: ["src/api.ts"] };
  const route = routeTask(task, join(tmpdir(), "aikit-routing", "state", "workflow.json"));
  assert.ok(route.skills.includes(".ai/skills/core/api-contract/SKILL.md"));
  assert.ok(route.context.includes(".ai/engine/state-schema.md"));
});
