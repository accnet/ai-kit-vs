import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import {
  addTask,
  EngineError,
  load,
  newState,
  replaceWithRemediation,
  routeTask,
  runnable,
  save,
  runnableTasks,
  topologicalOrder,
  transition,
  useWorkflow,
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
    assert.equal(current.events.at(-1).schema_version, 1);
    assert.match(current.events.at(-1).event_id, /^[0-9a-f-]{36}$/);
    assert.equal(current.events.at(-1).workflow_id, basename(directory));
    const logged = readFileSync(join(directory, "logs", "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(logged, current.events);
    assert.equal(new Set(current.events.map((event: any) => event.event_id)).size, current.events.length);
    validate(current);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Node engine rejects task IDs that could escape the workflow directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "aikit-node-"));
  try {
    const path = join(directory, "state", "workflow.json");
    save(newState("node", "feature"), path);
    for (const id of ["../../etc/evil", "a/b", "..", "T1\\x", ""]) {
      assert.throws(
        () => addTask(path, { id, title: "x", owner: "backend", phase: "build", acceptance: ["works"] }),
        EngineError,
        id,
      );
    }
    addTask(path, { id: "T1.retry-2", title: "ok", owner: "backend", phase: "build", acceptance: ["works"] });
    assert.equal(load<any>(path).tasks[0].id, "T1.retry-2");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("remediation of a near-limit task ID does not exceed the taskId length cap", () => {
  const directory = mkdtempSync(join(tmpdir(), "aikit-node-"));
  try {
    const path = join(directory, "state", "workflow.json");
    save(newState("node", "feature"), path);
    const longId = `t${"1".repeat(94)}`; // 95 chars, well under the 100-char cap
    addTask(path, { id: longId, title: "x", owner: "backend", phase: "build", acceptance: ["works"] });
    transition(path, longId, "start", "codex");
    transition(path, longId, "complete", "codex");
    const qaEvidence = join(directory, "qa.json");
    writeFileSync(qaEvidence, JSON.stringify({ kind: "qa", task: longId, status: "pass" }));
    transition(path, longId, "qa-pass", "gatekeeper", "", [qaEvidence]);
    const reviewEvidence = join(directory, "review.json");
    writeFileSync(reviewEvidence, JSON.stringify({ kind: "review", task: longId, verdict: "changes-requested" }));
    const remediation = replaceWithRemediation(path, longId, "reviewer", "needs changes", [reviewEvidence]);
    assert.equal(remediation.id, `${longId}-R1`);
    assert.equal(load<any>(path).tasks.find((t: any) => t.id === remediation.id)?.id, remediation.id);
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
  assert.equal(plugin.prompt_transport, "stdin");
  assert.equal(pluginCommand(plugin, "input.json", "output.json", "hello").includes("hello"), false);
  assert.ok(pluginCommand(plugin, "input.json", "output.json", "hello").includes("-"));
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
  assert.throws(() => validate(state), /dependency cycle detected/);

  state.tasks[1].needs = ["T1", "T1"];
  assert.throws(() => validate(state), /duplicate dependency/);
  state.tasks[1].needs = "T1" as any;
  assert.throws(() => validate(state), /needs must be an array/);
  state.tasks[1].needs = ["missing"];
  assert.throws(() => validate(state), /unknown dependency: missing/);
});

test("retire preserves task history and rejects active dependents", () => {
  const directory = mkdtempSync(join(tmpdir(), "aikit-retire-"));
  try {
    const path = join(directory, "state", "workflow.json");
    save(newState("retire", "feature"), path);
    addTask(path, { id: "MY1", title: "duplicate", owner: "devops", phase: "build", acceptance: ["obsolete"] });
    transition(path, "MY1", "retire", "planner", "superseded by SA36");
    assert.equal(load<any>(path).tasks[0].status, "retired");

    addTask(path, { id: "D1", title: "dependency", owner: "integration", phase: "build", acceptance: ["done"] });
    addTask(path, {
      id: "P2",
      title: "dependent",
      owner: "backend",
      phase: "build",
      needs: ["D1"],
      acceptance: ["done"],
    });
    transition(path, "D1", "start", "executor");
    transition(path, "D1", "complete", "executor");
    transition(path, "D1", "micro-close", "executor");
    assert.throws(
      () => transition(path, "D1", "retire", "planner", "legacy task"),
      /cannot retire D1; active dependents: P2/,
    );
    transition(path, "P2", "start", "executor");
    transition(path, "P2", "complete", "executor");
    transition(path, "P2", "micro-close", "executor");
    transition(path, "D1", "retire", "planner", "legacy task after dependent completion");
    assert.equal(load<any>(path).tasks.find((task: any) => task.id === "D1").status, "retired");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Node engine returns stable topological and runnable ordering", () => {
  const state: any = newState("ordered", "feature");
  state.tasks = [
    {
      id: "T3",
      title: "after first",
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
    {
      id: "T2",
      title: "independent",
      owner: "backend",
      phase: "build",
      needs: [],
      status: "todo",
      acceptance: ["ok"],
      files: [],
      tags: [],
      attempts: 0,
      evidence: [],
      blocked_reason: null,
    },
    {
      id: "T1",
      title: "first",
      owner: "backend",
      phase: "build",
      needs: [],
      status: "todo",
      acceptance: ["ok"],
      files: [],
      tags: [],
      attempts: 0,
      evidence: [],
      blocked_reason: null,
    },
  ];
  assert.deepEqual(
    topologicalOrder(state).map((task) => task.id),
    ["T2", "T1", "T3"],
  );
  assert.deepEqual(
    runnableTasks(state).map((task) => task.id),
    ["T2", "T1"],
  );
  state.tasks[2].status = "done";
  assert.deepEqual(
    runnableTasks(state).map((task) => task.id),
    ["T2", "T3"],
  );
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

test("Node engine does not publish an event for a stale state mutation", () => {
  const directory = mkdtempSync(join(tmpdir(), "aikit-node-events-"));
  try {
    const path = join(directory, "state", "workflow.json");
    save(newState("events", "feature"), path);
    addTask(path, { id: "T1", title: "first", owner: "backend", phase: "build", acceptance: ["works"] });
    addTask(path, { id: "T2", title: "second", owner: "backend", phase: "build", acceptance: ["works"] });
    const staleRevision = load<any>(path).revision;
    transition(path, "T1", "start", "first", "", [], staleRevision);
    const before = readFileSync(join(directory, "logs", "events.jsonl"), "utf8");
    assert.throws(() => transition(path, "T2", "start", "stale", "", [], staleRevision), /state changed concurrently/);
    const current = load<any>(path);
    assert.equal(current.tasks.find((task: any) => task.id === "T2").status, "todo");
    assert.equal(readFileSync(join(directory, "logs", "events.jsonl"), "utf8"), before);
    assert.equal(
      current.events.some((event: any) => event.task === "T2" && event.action === "start"),
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Node engine keeps legacy events readable", () => {
  const directory = mkdtempSync(join(tmpdir(), "aikit-node-legacy-events-"));
  try {
    const path = join(directory, "state", "workflow.json");
    const state: any = newState("legacy", "feature");
    state.events = [
      {
        seq: 1,
        ts: "2026-01-01T00:00:00Z",
        action: "init",
        task: null,
        actor: "planner",
        from: null,
        to: null,
        detail: "legacy",
      },
    ];
    save(state, path);
    assert.doesNotThrow(() => validate(load<any>(path)));
    assert.equal(load<any>(path).events[0].detail, "legacy");
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

test("Node router does not treat task tags as project stack selection", () => {
  const task: any = { id: "T1", owner: "backend", tags: ["backend", "database"], files: [] };
  const route = routeTask(task, join(tmpdir(), "aikit-routing-tags", "state", "workflow.json"));
  assert.ok(route.skills.includes(".ai/skills/core/api-contract/SKILL.md"));
  assert.ok(!route.skills.includes(".ai/skills/backend/laravel/overview.md"));
  assert.ok(!route.skills.includes(".ai/skills/database/mysql/overview.md"));
});
