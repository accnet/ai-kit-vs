import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const TSX = join(REPO, ".ai/node/node_modules/tsx/dist/cli.mjs");
const CLI = join(REPO, ".ai/node/ai-kit.ts");

function runCli(project: string, work: string, args: string[]) {
  return spawnSync(process.execPath, [TSX, CLI, ...args], {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      AIKIT_ROOT: REPO,
      AIKIT_PROJECT_ROOT: project,
      AIKIT_WORK: work,
    },
  });
}

test("global runtime keeps workflow state, git, and bundle context in the project", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-global-project-"));
  const work = join(project, ".ai-work");
  const git = spawnSync("git", ["init", "-b", "project-test"], { cwd: project, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  writeFileSync(join(project, "README.md"), "# temporary project\n");
  assert.equal(spawnSync("git", ["add", "README.md"], { cwd: project }).status, 0);
  assert.equal(
    spawnSync("git", ["-c", "user.name=AI-Kit Test", "-c", "user.email=test@example.invalid", "commit", "-m", "init"], {
      cwd: project,
      encoding: "utf8",
    }).status,
    0,
  );

  let result = runCli(project, work, ["init", "--title", "Global project", "--workflow", "feature"]);
  assert.equal(result.status, 0, result.stderr);
  result = runCli(project, work, [
    "add-task",
    "T1",
    "--title",
    "Use project root",
    "--owner",
    "planner",
    "--phase",
    "plan",
    "--acceptance",
    "bundle uses project context",
  ]);
  assert.equal(result.status, 0, result.stderr);

  result = runCli(project, work, ["bundle", "T1"]);
  assert.equal(result.status, 0, result.stderr);
  const bundle = JSON.parse(result.stdout);
  assert.equal(bundle.git.branch, "project-test");
  assert.equal(
    bundle.git.changed.some((item: string) => item.includes(".ai-work")),
    true,
  );
  assert.equal(
    bundle.context.included.some((item: { path: string }) => item.path.includes(".ai/agents/planner")),
    true,
  );
});

test("provider adapter defaults to the project root in global mode", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-provider-project-"));
  writeFileSync(join(project, "package.json"), JSON.stringify({ type: "module" }));
  const probe = join(project, "provider.mjs");
  const cwdOutput = join(project, "provider-cwd.txt");
  const artifact = join(project, "provider-output.json");
  writeFileSync(
    probe,
    "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.PROBE_OUTPUT, process.cwd());\nwriteFileSync(process.argv[3], '{}');\n",
  );
  const script = join(project, "probe.ts");
  writeFileSync(
    script,
    `import { invokeProvider } from ${JSON.stringify(join(REPO, ".ai/node/provider-adapter.ts"))};
const result = await invokeProvider(
  { version: 1, id: "probe", role: "executor", transport: "cli", command: [process.execPath, ${JSON.stringify(probe)}, "{input}", "{output}", "{prompt}"] },
  { input: ${JSON.stringify(join(project, "input.json"))}, output: ${JSON.stringify(artifact)}, prompt: "probe", env: { ...process.env, PROBE_OUTPUT: ${JSON.stringify(cwdOutput)} } },
);
if (!result.ok) throw new Error(result.error ?? "provider failed");
`,
  );
  writeFileSync(join(project, "input.json"), "{}\n");
  const result = spawnSync(process.execPath, [TSX, script], {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, AIKIT_ROOT: REPO, AIKIT_PROJECT_ROOT: project },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(cwdOutput, "utf8"), project);
  assert.equal(readFileSync(artifact, "utf8"), "{}");
});
