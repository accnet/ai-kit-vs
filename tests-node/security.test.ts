import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  assertCommandAllowed,
  commandName,
  DEFAULT_ALLOWED,
  parseSecurityPolicy,
  SecurityError,
  type SecurityPolicy,
} from "../.ai/node/security.js";
import { listPlugins } from "../.ai/node/plugins.js";

const policy = (allowed: string[], allowAny = false): SecurityPolicy => ({
  allowedCommands: new Set(allowed),
  allowAny,
});

test("parseSecurityPolicy reads block lists, inline arrays, and allow_any", () => {
  const block = parseSecurityPolicy("version: 1\nallowed_commands:\n  - node # runtime\n  - codex\nallow_any: false\n");
  assert.deepEqual([...block.allowedCommands].sort(), ["codex", "node"]);
  assert.equal(block.allowAny, false);

  const inline = parseSecurityPolicy("allowed_commands: [claude, gpt]\nallow_any: true\n");
  assert.deepEqual([...inline.allowedCommands].sort(), ["claude", "gpt"]);
  assert.equal(inline.allowAny, true);
});

test("assertCommandAllowed permits allowlisted binaries and ignores path + extension", () => {
  const p = policy(["node", "claude"]);
  assert.doesNotThrow(() => assertCommandAllowed(["node", "x.ts"], p));
  assert.doesNotThrow(() => assertCommandAllowed(["/usr/bin/node", "x.ts"], p));
  assert.doesNotThrow(() => assertCommandAllowed(["C:\\bin\\claude.exe", "-p"], p));
});

test("assertCommandAllowed rejects a binary that is not on the allowlist", () => {
  let caught: unknown;
  try {
    assertCommandAllowed(["rm", "-rf", "/"], policy(["node"]));
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof SecurityError);
  assert.match(caught.message, /not permitted/);
});

test("allow_any disables enforcement", () => {
  assert.doesNotThrow(() => assertCommandAllowed(["anything-goes"], policy([], true)));
});

test("commandName strips directory and Windows extension", () => {
  assert.equal(commandName("/usr/local/bin/codex"), "codex");
  assert.equal(commandName("C:\\tools\\claude.CMD"), "claude");
});

test("every shipped plugin passes the default allowlist", () => {
  const allow = policy(DEFAULT_ALLOWED);
  for (const plugin of listPlugins()) assert.doesNotThrow(() => assertCommandAllowed(plugin.command, allow));
});
