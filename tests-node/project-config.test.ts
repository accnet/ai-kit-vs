import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));

test("project configuration overrides models, verification, plugins, and security", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-project-config-"));
  mkdirSync(join(project, ".ai-work", "plugins", "reviewer"), { recursive: true });
  writeFileSync(
    join(project, ".ai-work", "project.yaml"),
    "project:\n  stack: [node]\nverification:\n  test_command: node --version\n",
  );
  writeFileSync(join(project, ".ai-work", "models.yaml"), "reviewer: codex\n");
  writeFileSync(join(project, ".ai-work", "security.yaml"), "allowed_commands: [codex]\nallow_any: false\n");
  writeFileSync(
    join(project, ".ai-work", "plugins", "reviewer", "codex.json"),
    JSON.stringify({
      version: 1,
      id: "codex",
      role: "reviewer",
      transport: "cli",
      command: [
        "codex",
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-c",
        "model_reasoning_effort=low",
        "--output-last-message",
        "{output}",
        "{prompt}",
      ],
    }),
  );
  const probe = join(project, "probe.ts");
  writeFileSync(
    probe,
    `import { testCommand } from ${JSON.stringify(join(REPO, ".ai/node/config.ts"))};
import { configuredPluginId } from ${JSON.stringify(join(REPO, ".ai/node/models.ts"))};
import { loadPlugin } from ${JSON.stringify(join(REPO, ".ai/node/plugins.ts"))};
import { assertCommandAllowed, loadSecurityPolicy } from ${JSON.stringify(join(REPO, ".ai/node/security.ts"))};
const policy = loadSecurityPolicy();
let claudeAllowed = true;
try { assertCommandAllowed(["claude"], policy); } catch { claudeAllowed = false; }
console.log(JSON.stringify({ test: testCommand(), reviewer: configuredPluginId("reviewer"), command: loadPlugin("reviewer", "codex").command, allowed: [...policy.allowedCommands].sort(), claudeAllowed }));
`,
  );
  const result = spawnSync(process.execPath, [join(REPO, ".ai/node/node_modules/tsx/dist/cli.mjs"), probe], {
    cwd: project,
    env: { ...process.env, AIKIT_ROOT: REPO, AIKIT_PROJECT_ROOT: project, AIKIT_WORK: join(project, ".ai-work") },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.test, "node --version");
  assert.equal(output.reviewer, "codex");
  assert.deepEqual(output.command, [
    "codex",
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-c",
    "model_reasoning_effort=low",
    "--output-last-message",
    "{output}",
    "{prompt}",
  ]);
  assert.deepEqual(output.allowed, ["codex"]);
  assert.equal(output.claudeAllowed, false);
});

test("project stack selects only matching domain skills and accepts postgres alias", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-project-stack-"));
  mkdirSync(join(project, ".ai-work"), { recursive: true });
  writeFileSync(
    join(project, ".ai-work", "project.yaml"),
    "project:\n  stack:\n    - postgres\nverification:\n  test_command: node --version\n",
  );
  const probe = join(project, "probe.ts");
  writeFileSync(
    probe,
    `import { routeTask } from ${JSON.stringify(join(REPO, ".ai/node/engine.ts"))};
const route = routeTask({ id: "T1", owner: "backend", tags: ["backend", "database"], files: [] } as any, "${join(project, ".ai-work/workflows/default/state/workflow.json")}");
console.log(JSON.stringify(route.skills));
`,
  );
  const result = spawnSync(process.execPath, [join(REPO, ".ai/node/node_modules/tsx/dist/cli.mjs"), probe], {
    cwd: project,
    env: { ...process.env, AIKIT_ROOT: REPO, AIKIT_PROJECT_ROOT: project, AIKIT_WORK: join(project, ".ai-work") },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const skills = JSON.parse(result.stdout.trim()) as string[];
  assert.ok(skills.includes(".ai/skills/database/postgresql/overview.md"));
  assert.ok(!skills.includes(".ai/skills/database/mysql/overview.md"));
  assert.ok(!skills.includes(".ai/skills/database/redis/overview.md"));
  assert.ok(!skills.includes(".ai/skills/backend/laravel/overview.md"));
});
