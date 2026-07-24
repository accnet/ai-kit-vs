import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeAfterQaPolicy,
  kitArray,
  kitScalar,
  microTaskPolicy,
  testCommand,
  verificationCommands,
} from "../.ai/node/config.js";

const SAMPLE = ["kit:", "  id: ai-kit", "  test_command: npm run test:ci", "project:", "  stack: [node, php]"].join(
  "\n",
);

test("kitScalar reads a key and preserves colons in the value", () => {
  assert.equal(kitScalar("id", SAMPLE), "ai-kit");
  assert.equal(kitScalar("test_command", SAMPLE), "npm run test:ci");
  assert.equal(kitScalar("missing", SAMPLE), undefined);
});

test("kitArray parses an inline array and empties on absence", () => {
  assert.deepEqual([...kitArray("stack", SAMPLE)].sort(), ["node", "php"]);
  assert.deepEqual([...kitArray("source_dirs", SAMPLE)], []);
});

test("kitArray parses project YAML block arrays", () => {
  const source = [
    "project:",
    "  stack:",
    "    - typescript",
    "    - postgres",
    "  source_dirs:",
    "    - src",
    "    - tests",
    "verification:",
    "  test_command: npm test",
  ].join("\n");
  assert.deepEqual([...kitArray("stack", source)], ["typescript", "postgres"]);
  assert.deepEqual([...kitArray("source_dirs", source)], ["src", "tests"]);
});

test("microTaskPolicy parses nested project policy and keeps bounded defaults", () => {
  const source = [
    "workflow:",
    "  micro_tasks:",
    "    enabled: true",
    "    max_files: 3",
    "    require_qa: true",
    "    require_review: false",
  ].join("\n");
  assert.deepEqual(microTaskPolicy(source), { enabled: true, maxFiles: 3, requireQa: true, requireReview: false });
  assert.equal(microTaskPolicy("workflow:\n  micro_tasks:\n    max_files: -1").maxFiles, 2);
});

test("closeAfterQaPolicy defaults off and parses explicit project opt-in", () => {
  assert.equal(closeAfterQaPolicy("workflow:\n  close_after_qa: true"), true);
  assert.equal(closeAfterQaPolicy("workflow:\n  close_after_qa: false"), false);
  assert.equal(closeAfterQaPolicy("workflow:\n  micro_tasks:\n    enabled: true"), false);
});

test("testCommand reads the shipped kit.yaml", () => {
  // The repo's kit.yaml sets test_command: npm test
  assert.equal(testCommand(), "npm test");
});

test("testCommand does not inherit the global command for an unconfigured project", () => {
  const repo = fileURLToPath(new URL("..", import.meta.url));
  const project = mkdtempSync(join(tmpdir(), "ai-kit-project-"));
  const probe = join(project, "probe.ts");
  writeFileSync(
    probe,
    `import { testCommand } from ${JSON.stringify(join(repo, ".ai/node/config.ts"))};\nconsole.log(testCommand() ?? "");\n`,
  );

  const result = spawnSync(process.execPath, [join(repo, ".ai/node/node_modules/tsx/dist/cli.mjs"), probe], {
    cwd: project,
    env: { ...process.env, AIKIT_ROOT: repo, AIKIT_PROJECT_ROOT: project, AIKIT_WORK: join(project, ".ai-work") },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "");
});

test("verificationCommands reads every declared verification check", () => {
  const source = [
    "verification:",
    "  cwd: app",
    "  test_command: npm test",
    "  typecheck_command: npm run typecheck",
    "  build_command: npm run build",
    "  lint_command: npm run lint",
  ].join("\n");
  assert.deepEqual(verificationCommands(source), [
    { name: "test_command", command: "npm test" },
    { name: "typecheck_command", command: "npm run typecheck" },
    { name: "build_command", command: "npm run build" },
    { name: "lint_command", command: "npm run lint" },
  ]);
});

test("verificationCommands reads named checks without removing legacy checks", () => {
  const source = [
    "verification:",
    "  test_command: npm test",
    "  checks:",
    "    migration: npm run db:check",
    "    live-smoke: ./scripts/smoke.sh",
  ].join("\n");
  assert.deepEqual(verificationCommands(source), [
    { name: "test_command", command: "npm test" },
    { name: "migration", command: "npm run db:check" },
    { name: "live-smoke", command: "./scripts/smoke.sh" },
  ]);
});
