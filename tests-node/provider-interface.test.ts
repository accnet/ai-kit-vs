import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { providerCapability, providerInit, providerValidate } from "../.ai/node/provider.js";
import { loadPlugin, listPlugins } from "../.ai/node/plugins.js";

// A stub provider installed in a temp global home, exercising every part of the
// standardized interface without a real binary.
function installStub(overrides: Record<string, unknown> = {}): string {
  const home = mkdtempSync(join(tmpdir(), "prov-"));
  const dir = join(home, "plugins", "executor");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "stub.json"),
    JSON.stringify({
      version: 1,
      id: "stub",
      role: "executor",
      transport: "cli",
      command: ["node", "-e", "1"],
      init: ["node", "-e", "process.exit(0)"],
      validate: ["node", "-e", "process.exit(0)"],
      capabilities: { roles: ["executor"], features: ["code"], auth: true },
      ...overrides,
    }),
  );
  return home;
}

function withHome<T>(home: string, fn: () => T): T {
  const prev = process.env.AIKIT_HOME;
  process.env.AIKIT_HOME = home;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.AIKIT_HOME;
    else process.env.AIKIT_HOME = prev;
  }
}

test("plugin manifest accepts the standardized init/validate/capabilities fields", () => {
  withHome(installStub(), () => {
    const plugin = loadPlugin("executor", "stub");
    assert.deepEqual(plugin.capabilities, { roles: ["executor"], features: ["code"], auth: true });
    assert.deepEqual(plugin.validate, ["node", "-e", "process.exit(0)"]);
  });
});

test("providerCapability reports declared capabilities (defaults to the role)", () => {
  withHome(installStub({ capabilities: undefined }), () => {
    assert.deepEqual(providerCapability("executor", "stub"), { roles: ["executor"], features: [], auth: false });
  });
});

test("providerValidate runs the readiness command", () => {
  withHome(installStub(), () => assert.equal(providerValidate("executor", "stub").ready, true));
  withHome(installStub({ validate: ["node", "-e", "process.exit(1)"] }), () =>
    assert.equal(providerValidate("executor", "stub").ready, false),
  );
  withHome(installStub({ validate: undefined }), () => assert.equal(providerValidate("executor", "stub").ready, null));
});

test("providerInit runs the optional init command", () => {
  withHome(installStub(), () => assert.equal(providerInit("executor", "stub").ran, true));
  withHome(installStub({ init: undefined }), () => assert.equal(providerInit("executor", "stub").ran, false));
});

test("Gemini and Qwen ship using the same interface, no runtime change needed", () => {
  const executorIds = new Set(listPlugins("executor").map((p) => p.id));
  for (const id of ["cursor", "gemini", "qwen"]) assert.ok(executorIds.has(id), `missing provider: ${id}`);
  const gemini = loadPlugin("executor", "gemini");
  assert.equal(gemini.command[0], "gemini");
  assert.ok(gemini.capabilities?.features?.includes("code"));
  assert.deepEqual(providerCapability("reviewer", "gemini").roles, ["reviewer"]);
});
