import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));

test("Codex reviewer writes the final JSON artifact without project write access", () => {
  const plugin = JSON.parse(readFileSync(join(REPO, ".ai/plugins/reviewer/codex.json"), "utf8"));
  assert.deepEqual(plugin.command, [
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
});
