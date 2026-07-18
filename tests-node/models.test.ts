import assert from "node:assert/strict";
import test from "node:test";
import { configuredPluginId, ModelConfigError, parseModelConfig } from "../.ai/node/models.js";

test("model configuration maps roles to role-compatible plugins", () => {
  const config = parseModelConfig(
    "planner: codex\nexecutor: codex\nqa: local\nreviewer: claude\nfallback: any-capable-agent\n",
  );
  assert.equal(config.executor, "codex");
  assert.equal(configuredPluginId("executor", "executor: codex"), "codex");
  assert.equal(configuredPluginId("qa", "qa: local"), "local");
});

test("model configuration rejects malformed or missing role assignments", () => {
  assert.throws(() => parseModelConfig("executor: ../codex"), ModelConfigError);
  assert.throws(() => configuredPluginId("reviewer", "fallback: any-capable-agent"), ModelConfigError);
});
