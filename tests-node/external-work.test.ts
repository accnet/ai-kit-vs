import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));

test("AIKIT_WORK outside the project supplies config and plugin overrides", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-external-project-"));
  const work = mkdtempSync(join(tmpdir(), "aikit-external-work-"));
  mkdirSync(join(work, "plugins", "executor"), { recursive: true });
  writeFileSync(join(work, "project.yaml"), "verification:\n  test_command: node --version\n");
  writeFileSync(join(work, "models.yaml"), "executor: external\n");
  writeFileSync(
    join(work, "plugins", "executor", "external.json"),
    JSON.stringify({
      version: 1,
      id: "external",
      role: "executor",
      transport: "cli",
      command: ["node", "-e", "process.exit(0)"],
    }),
  );
  const probe = join(project, "probe.ts");
  writeFileSync(
    probe,
    `import { testCommand } from ${JSON.stringify(join(REPO, ".ai/node/config.ts"))};
import { configuredPluginId } from ${JSON.stringify(join(REPO, ".ai/node/models.ts"))};
import { loadPlugin } from ${JSON.stringify(join(REPO, ".ai/node/plugins.ts"))};
console.log(JSON.stringify({ test: testCommand(), executor: configuredPluginId("executor"), command: loadPlugin("executor", "external").command }));
`,
  );
  const result = spawnSync(process.execPath, [join(REPO, ".ai/node/node_modules/tsx/dist/cli.mjs"), probe], {
    cwd: project,
    env: { ...process.env, AIKIT_ROOT: REPO, AIKIT_PROJECT_ROOT: project, AIKIT_WORK: work },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    test: "node --version",
    executor: "external",
    command: ["node", "-e", "process.exit(0)"],
  });
});
