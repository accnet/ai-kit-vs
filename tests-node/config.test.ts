import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { kitArray, kitScalar, testCommand } from "../.ai/node/config.js";

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
