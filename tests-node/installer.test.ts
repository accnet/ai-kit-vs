import { strict as assert } from "node:assert";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));

function run(command: string, args: string[]) {
  return spawnSync(command, args, { cwd: REPO, encoding: "utf8" });
}

function runKitInProject(project: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [join(REPO, ".ai/node/node_modules/tsx/dist/cli.mjs"), join(REPO, ".ai/node/ai-kit.ts"), ...args],
    {
      cwd: project,
      env: {
        ...process.env,
        AIKIT_ROOT: REPO,
        AIKIT_PROJECT_ROOT: project,
        AIKIT_WORK: join(project, ".ai-work"),
      },
      encoding: "utf8",
    },
  );
}

test("installer manifest describes the canonical device entrypoints", () => {
  const manifest = JSON.parse(readFileSync(join(REPO, "installer", "manifest.json"), "utf8"));
  assert.equal(manifest.installer, "device");
  assert.equal(manifest.runtime.home, "~/ai-kit");
  assert.equal(manifest.runtime.node, ">=22");
  for (const entrypoint of Object.values(manifest.entrypoints) as string[])
    assert.ok(existsSync(join(REPO, entrypoint)));
});

test("root installer is the global device entrypoint", () => {
  const out = run("bash", ["install.sh", "--help"]);
  assert.equal(out.status, 0, out.stderr);
  const help = `${out.stdout}\n${out.stderr}`;
  assert.match(help, /installer\/install\.sh/);
  assert.match(help, /~\/ai-kit/);
});

test("default device install separates kit home from project work state", () => {
  const home = mkdtempSync(join(tmpdir(), "aikit-installer-home-"));
  const out = spawnSync("bash", ["install.sh", "--no-deps"], {
    cwd: REPO,
    env: { ...process.env, HOME: home, AIKIT_HOME: "" },
    encoding: "utf8",
  });
  assert.equal(out.status, 0, out.stderr);

  const kit = join(home, "ai-kit");
  assert.ok(existsSync(join(kit, ".ai")));
  assert.ok(existsSync(join(kit, "bin", "ai-kit")));
  assert.equal(existsSync(join(kit, ".ai-work")), false);
  assert.match(readFileSync(join(kit, "bin", "ai-kit"), "utf8"), /AIKIT_WORK=.*PWD\/\.ai-work/);
  assert.equal(readFileSync(join(home, ".bashrc"), "utf8").match(/export PATH=.*ai-kit\/bin/g)?.length, 1);
});

test("default device install does not duplicate the Bash PATH entry", () => {
  const home = mkdtempSync(join(tmpdir(), "aikit-installer-bashrc-"));
  const env = { ...process.env, HOME: home, AIKIT_HOME: "" };
  let out = spawnSync("bash", ["install.sh", "--no-deps"], { cwd: REPO, env, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  out = spawnSync("bash", ["install.sh", "--force", "--no-deps"], { cwd: REPO, env, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(readFileSync(join(home, ".bashrc"), "utf8").match(/export PATH=.*ai-kit\/bin/g)?.length, 1);
});

test("dry-run and custom device installs do not modify the Bash profile", () => {
  const dryRunHome = mkdtempSync(join(tmpdir(), "aikit-installer-dry-run-"));
  let out = spawnSync("bash", ["install.sh", "--dry-run"], {
    cwd: REPO,
    env: { ...process.env, HOME: dryRunHome, AIKIT_HOME: "" },
    encoding: "utf8",
  });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(existsSync(join(dryRunHome, ".bashrc")), false);

  const customHome = mkdtempSync(join(tmpdir(), "aikit-installer-custom-home-"));
  const target = join(customHome, "custom-kit");
  out = spawnSync("bash", ["install.sh", "--home", target, "--no-deps"], {
    cwd: REPO,
    env: { ...process.env, HOME: customHome, AIKIT_HOME: "" },
    encoding: "utf8",
  });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(existsSync(join(customHome, ".bashrc")), false);
});

test("global ai-kit setup bootstraps a new project without a local runtime", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-setup-project-"));
  const out = runKitInProject(project, ["setup"]);
  assert.equal(out.status, 0, out.stderr);
  for (const file of [
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    ".github/copilot-instructions.md",
    ".cursor/rules/ai-kit.mdc",
    ".codex/config.toml",
    ".claude/commands/implement.md",
    ".claude/commands/qa.md",
    ".vscode/settings.json",
    ".vscode/tasks.json",
    ".ai-work/workflows/default/state/workflow.json",
    ".ai-work/workflows/default/plan/plan.md",
    ".ai-work/workflows/default/tasks/tasks.md",
    ".ai-work/project.yaml",
    ".ai-work/models.yaml",
    ".ai-memory/README.md",
  ])
    assert.ok(existsSync(join(project, file)), `missing ${file}`);
  assert.equal(existsSync(join(project, ".ai")), false);
  assert.equal(existsSync(join(project, "node_modules")), false);
  assert.equal(
    readFileSync(join(project, ".ai-work/models.yaml"), "utf8"),
    "planner: off\nexecutor: off\nqa: local\nreviewer: off\n",
  );
  const gitignore = readFileSync(join(project, ".gitignore"), "utf8");
  assert.match(gitignore, /\.ai-work\/\*/);
  assert.match(gitignore, /!\.ai-work\/models\.yaml/);
  assert.deepEqual(JSON.parse(readFileSync(join(project, ".vscode/settings.json"), "utf8")), {
    "aiKit.home": "~/ai-kit",
  });
  const copilot = readFileSync(join(project, ".github/copilot-instructions.md"), "utf8");
  assert.match(copilot, /copilot-extension/);
  assert.match(copilot, /ai-kit agent claim/);
  assert.match(copilot, /ai-kit agent result/);
  assert.match(copilot, /Completion Checklist/);
  assert.match(copilot, /compiles alone/);
  const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
  assert.match(agents, /No silent completion/);
  assert.match(agents, /MUST submit through `ai-kit agent result`/);
  const vscodeTasks = JSON.parse(readFileSync(join(project, ".vscode/tasks.json"), "utf8"));
  const labels = vscodeTasks.tasks.map((task: { label: string }) => task.label);
  for (const label of [
    "AI-Kit: Copilot claim next task",
    "AI-Kit: Copilot load context",
    "AI-Kit: Copilot heartbeat",
    "AI-Kit: Copilot submit result",
  ])
    assert.ok(labels.includes(label), `missing ${label}`);
  const claimTask = vscodeTasks.tasks.find(
    (task: { label: string }) => task.label === "AI-Kit: Copilot claim next task",
  );
  assert.deepEqual(claimTask.args, [
    "agent",
    "claim",
    "--workflow-id",
    "${input:workflowId}",
    "--client-id",
    "copilot-extension",
  ]);
});

test("setup can opt providers in once through project configuration", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-setup-providers-"));
  const out = runKitInProject(project, [
    "setup",
    "--planner",
    "claude",
    "--executor",
    "codex",
    "--qa",
    "local",
    "--reviewer",
    "codex",
  ]);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(
    readFileSync(join(project, ".ai-work", "models.yaml"), "utf8"),
    "planner: claude\nexecutor: codex\nqa: local\nreviewer: codex\n",
  );
});

test("setup preserves project provider overrides on refresh", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-setup-models-"));
  let out = runKitInProject(project, ["setup"]);
  assert.equal(out.status, 0, out.stderr);
  writeFileSync(join(project, ".ai-work", "models.yaml"), "reviewer: codex\n");
  out = runKitInProject(project, ["setup", "--force"]);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(readFileSync(join(project, ".ai-work", "models.yaml"), "utf8"), "reviewer: codex\n");
});

test("global ai-kit setup refuses to overwrite a conflicting project bridge", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-setup-conflict-"));
  writeFileSync(join(project, "AGENTS.md"), "project-owned\n");
  const out = runKitInProject(project, ["setup"]);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /workspace file conflict: AGENTS\.md/);
});
