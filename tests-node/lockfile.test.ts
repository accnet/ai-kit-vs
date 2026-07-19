import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildLock, computeLock, readLock, verifyLock, LockError } from "../.ai/node/lockfile.js";

test("computeLock is deterministic and hashes the shipped plugins", () => {
  const a = computeLock();
  const b = computeLock();
  assert.deepEqual(a, b);
  assert.ok(Object.keys(a.plugins).length > 0, "expected plugin hashes");
  assert.ok(Object.keys(a.runtime_source).length > 0, "expected runtime source hashes");
  assert.ok(a.runtime.zod, "expected the zod runtime version to be pinned");
  assert.equal(typeof a.security, "string");
});

test("buildLock adds a timestamp and round-trips through readLock", () => {
  const lock = buildLock();
  assert.equal(lock.version, 1);
  assert.ok(lock.generated_at);
  const path = join(mkdtempSync(join(tmpdir(), "lock-")), "ai-kit.lock.json");
  writeFileSync(path, JSON.stringify(lock, null, 2));
  assert.deepEqual(readLock(path), lock);
});

test("verifyLock reports no drift for a freshly written lock", () => {
  const lock = buildLock();
  const path = join(mkdtempSync(join(tmpdir(), "lock-ok-")), "ai-kit.lock.json");
  writeFileSync(path, JSON.stringify(lock, null, 2));
  const result = verifyLock(path);
  assert.equal(result.ok, true, JSON.stringify(result.drift));
});

test("verifyLock detects a tampered runtime version", () => {
  const lock = buildLock();
  lock.runtime = { ...lock.runtime, zod: "0.0.0-tampered" };
  const path = join(mkdtempSync(join(tmpdir(), "lock-drift-")), "ai-kit.lock.json");
  writeFileSync(path, JSON.stringify(lock, null, 2));
  const result = verifyLock(path);
  assert.equal(result.ok, false);
  assert.ok(result.drift.some((d) => d.key === "runtime.zod" && d.expected === "0.0.0-tampered"));
});

test("verifyLock detects changed runtime source", () => {
  const lock = buildLock();
  const path = join(mkdtempSync(join(tmpdir(), "lock-source-drift-")), "ai-kit.lock.json");
  lock.runtime_source = { ...lock.runtime_source, "synthetic.ts": "tampered" };
  writeFileSync(path, JSON.stringify(lock, null, 2));
  const result = verifyLock(path);
  assert.equal(result.ok, false);
  assert.ok(result.drift.some((d) => d.key === "runtime_source.synthetic.ts"));
});

test("readLock throws when the lockfile is missing", () => {
  assert.throws(() => readLock(join(tmpdir(), "no-such-lock.json")), LockError);
});
