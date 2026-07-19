import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const TSX = join(REPO, ".ai/node/node_modules/tsx/dist/cli.mjs");
const CLI = join(REPO, ".ai/node/ai-kit.ts");

// ROOT is resolved once at module load, so the override is verified in a child
// process rather than by re-importing the engine in this one.
test("AIKIT_ROOT relocates the runtime root and version reads .ai/kit.yaml", () => {
  const root = mkdtempSync(join(tmpdir(), "aikit-root-"));
  mkdirSync(join(root, ".ai"), { recursive: true });
  writeFileSync(join(root, ".ai", "kit.yaml"), "kit:\n  id: relocated-kit\n  version: 9.9.9\n");
  const out = spawnSync(process.execPath, [TSX, CLI, "version"], {
    cwd: tmpdir(),
    encoding: "utf8",
    env: { ...process.env, AIKIT_ROOT: root },
  });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), { name: "relocated-kit", version: "9.9.9" });
});
