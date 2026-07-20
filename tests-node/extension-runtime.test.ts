import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveRuntime, tailLogCommand, terminalNameFor, workerLogPath } from "../extension/src/runtime.js";

function markRuntime(root: string): void {
  mkdirSync(join(root, ".ai", "node", "node_modules", "tsx", "dist"), { recursive: true });
  mkdirSync(join(root, ".ai", "node"), { recursive: true });
  writeFileSync(join(root, ".ai", "node", "node_modules", "tsx", "dist", "cli.mjs"), "");
  writeFileSync(join(root, ".ai", "node", "ai-kit.ts"), "");
}

test("VS Code runtime resolver falls back to the global home", () => {
  const project = mkdtempSync(join(tmpdir(), "extension-project-"));
  const home = mkdtempSync(join(tmpdir(), "extension-home-"));
  markRuntime(home);
  const runtime = resolveRuntime(project, "ai-kit", { home });
  assert.equal(runtime.global, true);
  assert.equal(runtime.root, home);
  assert.equal(runtime.target, join(home, ".ai", "node", "ai-kit.ts"));
});

test("VS Code runtime resolver prefers a project-local runtime", () => {
  const project = mkdtempSync(join(tmpdir(), "extension-local-project-"));
  const home = mkdtempSync(join(tmpdir(), "extension-local-home-"));
  markRuntime(project);
  markRuntime(home);
  writeFileSync(join(project, ".ai", "node", "worker-manager.ts"), "");
  const runtime = resolveRuntime(project, "ai-kit:worker", { home });
  assert.equal(runtime.global, false);
  assert.equal(runtime.root, join(project, ".ai"));
  assert.equal(runtime.target, join(project, ".ai", "node", "worker-manager.ts"));
});

test("terminalNameFor gives each worker its own terminal label", () => {
  assert.equal(terminalNameFor("worker-codex-abc123"), "AI-Kit: worker-codex-abc123");
  assert.notEqual(terminalNameFor("worker-codex-abc123"), terminalNameFor("worker-codex-def456"));
});

test("tailLogCommand quotes a path containing spaces as one argument", () => {
  assert.equal(tailLogCommand("/tmp/plain.log"), 'tail -f "/tmp/plain.log"');
  assert.equal(tailLogCommand("/tmp/has space/worker.log"), 'tail -f "/tmp/has space/worker.log"');
});

test("workerLogPath extracts the log field from a worker-start response", () => {
  assert.equal(
    workerLogPath({ log: ".ai-work/run/workers/worker-codex-abc.log" }),
    ".ai-work/run/workers/worker-codex-abc.log",
  );
  assert.equal(workerLogPath({ status: "running" }), undefined);
  assert.equal(workerLogPath({ log: 42 }), undefined);
  assert.equal(workerLogPath(null), undefined);
  assert.equal(workerLogPath("not an object"), undefined);
});
