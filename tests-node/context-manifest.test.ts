import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ArtifactError, parseContextManifest } from "../.ai/node/artifacts.js";

const valid = {
  version: 1,
  task: "T1",
  attempt_id: "T1-1-abc",
  route: { owner: "backend" },
  sources: [{ path: ".ai/engine/state-schema.md", sha256: "deadbeef" }],
  context: {
    budget_tokens: 120000,
    total_tokens: 100,
    included: [{ path: ".ai/engine/state-schema.md", tokens: 100 }],
    skipped: [],
  },
  bundle: {
    workspace: ["src"],
    git: { branch: "main", changed: [] },
    architecture: [".ai/engine/state-schema.md"],
    requirement: { acceptance: ["done"], docs: [] },
    memory: [],
  },
  completion: {
    required_action: "ai-kit agent result",
    reminder: "REMINDER: submit the result",
  },
  git_status: [],
  generated_at: "2026-07-19T00:00:00Z",
};

test("parseContextManifest accepts a well-formed manifest", () => {
  const parsed = parseContextManifest(valid);
  assert.equal(parsed.task, "T1");
  assert.equal(parsed.context.included[0].path, ".ai/engine/state-schema.md");
  assert.equal(parsed.completion.required_action, "ai-kit agent result");
});

test("parseContextManifest rejects a manifest missing the context selection", () => {
  const { context, ...bad } = valid;
  assert.throws(() => parseContextManifest(bad), ArtifactError);
});

test("parseContextManifest rejects a source with a wrong shape", () => {
  assert.throws(() => parseContextManifest({ ...valid, sources: [{ path: 5 }] }), ArtifactError);
});
