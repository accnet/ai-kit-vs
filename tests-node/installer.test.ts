import { strict as assert } from "node:assert";
import { chmodSync, mkdirSync, readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
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
  assert.equal(manifest.entrypoints.workspace_bash, "installer/configure-workspace.sh");
  assert.equal(manifest.entrypoints.workspace_powershell, "installer/configure-workspace.ps1");
});

test("root installer is the global device entrypoint", () => {
  const out = run("bash", ["install.sh", "--help"]);
  assert.equal(out.status, 0, out.stderr);
  const help = `${out.stdout}\n${out.stderr}`;
  assert.match(help, /installer\/install\.sh/);
  assert.match(help, /~\/ai-kit/);
  assert.match(help, /--workspace/);
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
});

test("project-local installer is explicit and dry-run is non-mutating", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-installer-project-"));
  const out = run("bash", ["installer/install-project.sh", "--target", project, "--dry-run"]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /AGENTS\.md/);
  assert.equal(existsSync(join(project, ".ai")), false);
  assert.equal(existsSync(join(project, "AGENTS.md")), false);
});

test("workspace configurator dry-run is non-mutating", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-workspace-project-"));
  const home = mkdtempSync(join(tmpdir(), "aikit-workspace-home-"));
  const launcher = join(home, "bin", "ai-kit");
  mkdirSync(join(home, "bin"));
  writeFileSync(launcher, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  chmodSync(launcher, 0o755);
  const out = run("bash", ["installer/configure-workspace.sh", "--target", project, "--home", home, "--dry-run"]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /\.ai-work/);
  assert.equal(existsSync(join(project, ".ai-work")), false);
  assert.equal(existsSync(join(project, "AGENTS.md")), false);
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
    ".vscode/settings.json",
    ".vscode/tasks.json",
    ".ai-work/workflows/default/state/workflow.json",
    ".ai-work/workflows/default/plan/plan.md",
    ".ai-work/workflows/default/tasks/tasks.md",
  ])
    assert.ok(existsSync(join(project, file)), `missing ${file}`);
  assert.equal(existsSync(join(project, ".ai")), false);
  assert.equal(existsSync(join(project, "node_modules")), false);
  assert.deepEqual(JSON.parse(readFileSync(join(project, ".vscode/settings.json"), "utf8")), {
    "aiKit.home": "~/ai-kit",
  });
});

test("global ai-kit setup refuses to overwrite a conflicting project bridge", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-setup-conflict-"));
  writeFileSync(join(project, "AGENTS.md"), "project-owned\n");
  const out = runKitInProject(project, ["setup"]);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /workspace file conflict: AGENTS\.md/);
});
