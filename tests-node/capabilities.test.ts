import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  capabilityComplete,
  CapabilityError,
  listCapabilities,
  loadCapability,
  resolveCapability,
} from "../.ai/node/capabilities.js";

test("shipped capabilities load and reference only existing agents and skills", () => {
  const all = listCapabilities();
  assert.ok(all.length >= 2, "expected at least the backend and frontend capabilities");
  for (const manifest of all) {
    const resolved = resolveCapability(manifest.id);
    assert.deepEqual(
      resolved.missing,
      { agents: [], skills: [] },
      `capability ${manifest.id} references missing knowledge: ${JSON.stringify(resolved.missing)}`,
    );
    assert.ok(capabilityComplete(manifest.id));
  }
});

test("resolveCapability maps references to real repo paths", () => {
  const backend = resolveCapability("backend");
  assert.equal(backend.kind, "knowledge");
  assert.ok(backend.agents.includes(".ai/agents/backend"));
  assert.ok(backend.skills.some((path) => path.includes("backend/nestjs-core")));
});

test("listCapabilities filters by kind", () => {
  const frameworks = listCapabilities("framework");
  assert.ok(frameworks.every((manifest) => manifest.kind === "framework"));
  assert.ok(frameworks.some((manifest) => manifest.id === "frontend"));
});

test("loadCapability rejects an unknown id", () => {
  assert.throws(() => loadCapability("does-not-exist"), CapabilityError);
});
