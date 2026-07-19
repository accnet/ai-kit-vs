import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));

test("onboard --apply resolves paths against ROOT, not the current directory", () => {
  const root = mkdtempSync(join(tmpdir(), "aikit-onboard-"));
  cpSync(join(REPO, ".ai"), join(root, ".ai"), { recursive: true });
  const tsx = join(root, ".ai", "node", "node_modules", "tsx", "dist", "cli.mjs");
  const cli = join(root, ".ai", "node", "ai-kit.ts");
  // Invoke with cwd elsewhere to prove path resolution ignores cwd.
  const out = spawnSync(process.execPath, [tsx, cli, "onboard", "--apply"], {
    cwd: tmpdir(),
    encoding: "utf8",
  });
  assert.equal(out.status, 0, out.stderr);
  // ROOT has no package.json/composer/pyproject -> stack falls back to "any".
  assert.deepEqual(JSON.parse(out.stdout).stack, ["any"]);
  // The rewrite must have hit the kit's own manifest under ROOT.
  assert.match(readFileSync(join(root, ".ai", "kit.yaml"), "utf8"), /stack:\s*\[any\]/);
});
