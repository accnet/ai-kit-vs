import { strict as assert } from "node:assert";
import { test } from "node:test";
import { runtime } from "../.ai/node/runtime.js";
import * as engine from "../.ai/node/engine.js";
import * as plugins from "../.ai/node/plugins.js";
import * as artifacts from "../.ai/node/artifacts.js";
import * as context from "../.ai/node/context.js";
import { invokeProvider } from "../.ai/node/provider-adapter.js";
import { listProviders } from "../.ai/node/models.js";

test("runtime facade exposes the four managers plus memory and capabilities", () => {
  for (const key of ["workflow", "providers", "plugins", "artifacts", "memory", "capabilities"])
    assert.ok(key in runtime, `missing manager: ${key}`);
});

test("facade wires to the real implementations (no fork)", () => {
  // Identity checks: the facade re-exports the actual module functions.
  assert.equal(runtime.workflow.transition, engine.transition);
  assert.equal(runtime.workflow.route, engine.routeTask);
  assert.equal(runtime.plugins.load, plugins.loadPlugin);
  assert.equal(runtime.providers.list, listProviders);
  assert.equal(runtime.providers.invoke, invokeProvider);
  assert.equal(runtime.artifacts.parse, artifacts.parseArtifact);
  assert.equal(runtime.artifacts.assembleContext, context.assembleContext);
});

test("managers are callable through the single center", () => {
  const ids = new Set(runtime.plugins.list().map((p) => p.id));
  assert.ok(ids.has("codex") && ids.has("cursor"));
  const providers = runtime.providers.list("executor: codex");
  assert.equal(providers.find((p) => p.role === "executor")?.provider, "codex");
  assert.ok(runtime.artifacts.assembleContext([".ai/engine/state-schema.md"]).total_tokens > 0);
});
