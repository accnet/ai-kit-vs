import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const TSX = join(REPO, ".ai/node/node_modules/tsx/dist/cli.mjs");
const CLI = join(REPO, ".ai/node/worker-manager.ts");
const KIT_CLI = join(REPO, ".ai/node/ai-kit.ts");

const run = (args: string[], work = mkdtempSync(join(tmpdir(), "worker-cli-"))) =>
  spawnSync(process.execPath, [TSX, CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, AIKIT_WORK: work },
  });

const runTarget = (target: string, args: string[], work: string, env: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [TSX, target, ...args], {
    encoding: "utf8",
    env: { ...process.env, AIKIT_WORK: work, ...env },
  });

test("worker CLI lists an empty roster as JSON", () => {
  const out = run(["list"]);
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), []);
});

test("worker CLI rejects an unknown subcommand with usage", () => {
  const out = run(["frobnicate"]);
  assert.equal(out.status, 2);
  assert.match(out.stderr, /usage: worker/);
});

test("worker start requires a workflow id", () => {
  const out = run(["start", "--role", "executor"]);
  assert.equal(out.status, 2);
  assert.match(out.stderr, /--workflow-id/);
});

test("worker start accepts the default state created by init without a registry", () => {
  const work = mkdtempSync(join(tmpdir(), "worker-init-"));
  let out = runTarget(KIT_CLI, ["init", "--title", "Initialized workflow", "--workflow", "feature"], work);
  assert.equal(out.status, 0, out.stderr);
  out = runTarget(CLI, ["start", "--workflow-id", "default", "--role", "executor", "--plugin", "codex"], work);
  assert.equal(out.status, 0, out.stderr);
  const worker = JSON.parse(out.stdout);
  assert.equal(worker.workflow_id, "default");
  runTarget(CLI, ["stop", worker.id], work);
});

test("worker stop terminates an in-flight provider process", () => {
  const work = mkdtempSync(join(tmpdir(), "worker-stop-"));
  const home = mkdtempSync(join(tmpdir(), "worker-stop-home-"));
  const provider = join(home, "provider.mjs");
  mkdirSync(join(home, "plugins", "executor"), { recursive: true });
  writeFileSync(provider, "setInterval(() => {}, 1000);\n");
  writeFileSync(
    join(home, "plugins", "executor", "stub.json"),
    JSON.stringify({
      version: 1,
      id: "stub",
      role: "executor",
      transport: "cli",
      command: [process.execPath, provider, "{input}", "{output}", "{prompt}"],
    }),
  );

  let out = runTarget(KIT_CLI, ["init", "--title", "Stopping workflow", "--workflow", "feature"], work, {
    AIKIT_HOME: home,
  });
  assert.equal(out.status, 0, out.stderr);
  out = runTarget(
    KIT_CLI,
    ["add-task", "T1", "--title", "hang", "--owner", "backend", "--phase", "build", "--acceptance", "stop"],
    work,
    { AIKIT_HOME: home },
  );
  assert.equal(out.status, 0, out.stderr);
  out = runTarget(CLI, ["start", "--workflow-id", "default", "--role", "executor", "--plugin", "stub"], work, {
    AIKIT_HOME: home,
  });
  assert.equal(out.status, 0, out.stderr);
  const worker = JSON.parse(out.stdout);
  out = runTarget(CLI, ["stop", worker.id], work, { AIKIT_HOME: home });
  assert.equal(out.status, 0, out.stderr);

  let status = "stopping";
  for (let attempt = 0; attempt < 20 && status === "stopping"; attempt++) {
    out = runTarget(CLI, ["status", worker.id], work, { AIKIT_HOME: home });
    assert.equal(out.status, 0, out.stderr);
    status = JSON.parse(out.stdout).status;
    if (status === "stopping") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  assert.equal(status, "stopped");
  const recordPath = join(work, "run", "workers", `${worker.id}.json`);
  assert.equal(JSON.parse(readFileSync(recordPath, "utf8")).status, "stopped");
});

test("worker watch stays alive while no task is runnable", () => {
  const work = mkdtempSync(join(tmpdir(), "worker-watch-"));
  const home = mkdtempSync(join(tmpdir(), "worker-watch-home-"));
  mkdirSync(join(home, "plugins", "executor"), { recursive: true });
  writeFileSync(
    join(home, "plugins", "executor", "stub.json"),
    JSON.stringify({
      version: 1,
      id: "stub",
      role: "executor",
      transport: "cli",
      command: [process.execPath, "-e", "process.exit(0)", "{input}", "{output}", "{prompt}"],
    }),
  );
  let out = runTarget(KIT_CLI, ["init", "--title", "Watch workflow", "--workflow", "feature"], work, {
    AIKIT_HOME: home,
  });
  assert.equal(out.status, 0, out.stderr);
  out = runTarget(
    CLI,
    ["start", "--workflow-id", "default", "--role", "executor", "--plugin", "stub", "--watch"],
    work,
    {
      AIKIT_HOME: home,
    },
  );
  assert.equal(out.status, 0, out.stderr);
  const worker = JSON.parse(out.stdout);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  out = runTarget(CLI, ["status", worker.id], work, { AIKIT_HOME: home });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).status, "running");
  out = runTarget(CLI, ["stop", worker.id], work, { AIKIT_HOME: home });
  assert.equal(out.status, 0, out.stderr);
});
