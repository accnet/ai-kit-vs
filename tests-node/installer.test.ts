import { strict as assert } from "node:assert";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));

function run(command: string, args: string[]) {
  return spawnSync(command, args, { cwd: REPO, encoding: "utf8" });
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
});

test("project-local installer is explicit and dry-run is non-mutating", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-installer-project-"));
  const out = run("bash", ["installer/install-project.sh", "--target", project, "--dry-run"]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /AGENTS\.md/);
  assert.equal(existsSync(join(project, ".ai")), false);
  assert.equal(existsSync(join(project, "AGENTS.md")), false);
});
