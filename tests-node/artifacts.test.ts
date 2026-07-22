import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseArtifact } from "../.ai/node/artifacts.js";

const result = (branch: string | null | undefined) => ({
  version: 1,
  kind: "result",
  workflow_id: "default",
  actor: "worker-codex-test",
  task: "A1",
  attempt_id: "A1-1-test",
  status: "pass",
  summary: "implemented",
  changed_paths: [],
  commands: [],
  ...(branch === undefined ? {} : { branch }),
});

test("result artifacts accept an explicit null branch from Codex", () => {
  const parsed = parseArtifact("result", result(null));
  assert.equal("branch" in parsed ? parsed.branch : undefined, null);
});

test("result artifacts remain valid when branch is omitted", () => {
  const parsed = parseArtifact("result", result(undefined));
  assert.equal("branch" in parsed ? parsed.branch : undefined, undefined);
});
