import { strict as assert } from "node:assert";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const TSX = join(REPO, ".ai/node/node_modules/tsx/dist/cli.mjs");
const CLI = join(REPO, ".ai/node/ai-kit.ts");

function run(project: string, args: string[]) {
  return spawnSync(process.execPath, [TSX, CLI, ...args], {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, AIKIT_ROOT: REPO, AIKIT_PROJECT_ROOT: project, AIKIT_WORK: join(project, ".ai-work") },
  });
}

test("events and watch preserve cursors without replaying events", () => {
  const project = mkdtempSync(join(tmpdir(), "aikit-event-watch-"));
  try {
    let result = run(project, ["workflow-create", "bridge", "--title", "Bridge", "--workflow", "feature"]);
    assert.equal(result.status, 0, result.stderr);
    result = run(project, ["events", "--workflow-id", "bridge", "--after-cursor", "0", "--wait-ms", "0"]);
    assert.equal(result.status, 0, result.stderr);
    const first = JSON.parse(result.stdout);
    assert.equal(first.workflow_id, "bridge");
    assert.ok(first.events.length > 0);
    assert.ok(first.cursor > 0);

    result = run(project, [
      "watch",
      "--workflow-id",
      "bridge",
      "--after-cursor",
      String(first.cursor),
      "--wait-ms",
      "0",
      "--once",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const second = JSON.parse(result.stdout);
    assert.deepEqual(second.events, []);
    assert.equal(second.cursor, first.cursor);
    assert.deepEqual(readdirSync(project), [".ai-work"]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
