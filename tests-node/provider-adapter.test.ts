import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { invokeProvider, windowsCommandLine } from "../.ai/node/provider-adapter.js";
import type { Plugin } from "../.ai/node/plugins.js";

// A fake CLI provider driven by a mode file, so we can exercise every outcome
// without a real model. It reads its behavior from FAKE_MODE and, when asked,
// writes a minimal artifact to {output} (arg 2).
function fakeProvider(dir: string): string {
  const script = join(dir, "fake-provider.mjs");
  writeFileSync(
    script,
    [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "const output = process.argv[3];",
      "const mode = process.env.FAKE_MODE ?? 'ok';",
      "if (mode === 'fail') { console.error('boom'); process.exit(3); }",
      "if (mode === 'stdin-close') { readFileSync(0); writeFileSync(output, '{}\\n'); }",
      "else if (mode === 'stdin-capture') { const prompt = readFileSync(0, 'utf8'); if (prompt.length !== 140000 || prompt[0] !== 'x') process.exit(4); writeFileSync(output, '{}\\n'); }",
      "else if (mode === 'hang') { setInterval(() => {}, 1000); }",
      "else if (mode === 'no-output') { process.exit(0); }",
      "else if (mode === 'sleep') { setTimeout(() => writeFileSync(output, '{}\\n'), 300); }",
      "else { writeFileSync(output, JSON.stringify({ ok: true }) + '\\n'); }",
    ].join("\n"),
    "utf8",
  );
  return script;
}

function plugin(script: string, extra: Partial<Plugin> = {}): Plugin {
  return {
    version: 1,
    id: "fake",
    role: "executor",
    transport: "cli",
    command: [process.execPath, script, "{input}", "{output}", "{prompt}"],
    ...extra,
  };
}

const opts = (dir: string) => ({
  input: join(dir, "in.json"),
  output: join(dir, "out.json"),
  prompt: "do it",
  cwd: dir,
});

test("Windows shim command lines quote task-controlled shell metacharacters", () => {
  const rendered = windowsCommandLine(["codex.cmd", "--prompt", "review & echo injected", "C:\\work dir\\out.json"]);
  assert.match(rendered, /"review & echo injected"/);
  assert.match(rendered, /"C:\\work dir\\out\.json"/);
});

test("adapter returns ok when the provider writes the artifact and exits 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pa-ok-"));
  const r = await invokeProvider(plugin(fakeProvider(dir)), { ...opts(dir), env: { ...process.env, FAKE_MODE: "ok" } });
  assert.equal(r.outcome, "ok");
  assert.equal(r.ok, true);
  assert.equal(r.exit_code, 0);
  assert.equal(r.attempts, 1);
});

test("adapter closes stdin when the provider prompt is passed as an argument", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pa-stdin-"));
  const r = await invokeProvider(plugin(fakeProvider(dir)), {
    ...opts(dir),
    timeoutMs: 1000,
    env: { ...process.env, FAKE_MODE: "stdin-close" },
  });
  assert.equal(r.outcome, "ok");
});

test("adapter sends large prompts through stdin when the plugin requests it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pa-stdin-large-"));
  const prompt = "x".repeat(140_000);
  const r = await invokeProvider(
    plugin(fakeProvider(dir), {
      prompt_transport: "stdin",
      command: [process.execPath, fakeProvider(dir), "{input}", "{output}"],
    }),
    {
      ...opts(dir),
      prompt,
      env: { ...process.env, FAKE_MODE: "stdin-capture" },
    },
  );
  assert.equal(r.outcome, "ok");
});

test("adapter refuses an oversized argv prompt before spawning the provider", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pa-argv-large-"));
  const r = await invokeProvider(plugin(fakeProvider(dir)), {
    ...opts(dir),
    prompt: "x".repeat(100_000),
  });
  assert.equal(r.outcome, "argv-too-large");
  assert.equal(r.attempts, 0);
  assert.match(r.error!, /prompt_transport=stdin/);
});

test("adapter reports nonzero-exit and does not retry by default", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pa-fail-"));
  const r = await invokeProvider(plugin(fakeProvider(dir)), {
    ...opts(dir),
    env: { ...process.env, FAKE_MODE: "fail" },
  });
  assert.equal(r.outcome, "nonzero-exit");
  assert.equal(r.ok, false);
  assert.equal(r.exit_code, 3);
  assert.equal(r.attempts, 1);
  assert.match(r.error!, /status 3/);
});

test("adapter retries transient failures up to retries+1 attempts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pa-retry-"));
  const r = await invokeProvider(plugin(fakeProvider(dir), { retries: 2 }), {
    ...opts(dir),
    env: { ...process.env, FAKE_MODE: "fail" },
  });
  assert.equal(r.outcome, "nonzero-exit");
  assert.equal(r.attempts, 3); // 1 + 2 retries
});

test("adapter classifies a clean exit with no artifact as no-output and does not retry it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pa-noout-"));
  const r = await invokeProvider(plugin(fakeProvider(dir), { retries: 2 }), {
    ...opts(dir),
    env: { ...process.env, FAKE_MODE: "no-output" },
  });
  assert.equal(r.outcome, "no-output");
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 1); // no-output is a contract violation, not retried
});

test("adapter enforces a timeout and reports it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pa-timeout-"));
  const r = await invokeProvider(plugin(fakeProvider(dir)), {
    ...opts(dir),
    timeoutMs: 300,
    env: { ...process.env, FAKE_MODE: "hang" },
  });
  assert.equal(r.outcome, "timeout");
  assert.equal(r.ok, false);
});

test("adapter reports spawn-error for a missing binary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pa-spawn-"));
  const bad: Plugin = {
    version: 1,
    id: "fake",
    role: "executor",
    transport: "cli",
    command: [join(dir, "does-not-exist-binary"), "{input}", "{output}", "{prompt}"],
  };
  const r = await invokeProvider(bad, opts(dir));
  assert.equal(r.outcome, "spawn-error");
  assert.equal(r.ok, false);
});

test("adapter fires onHeartbeat while a long provider run is in flight", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pa-hb-"));
  let beats = 0;
  const r = await invokeProvider(plugin(fakeProvider(dir)), {
    ...opts(dir),
    env: { ...process.env, FAKE_MODE: "sleep" },
    onHeartbeat: () => beats++,
    heartbeatMs: 50,
  });
  assert.equal(r.outcome, "ok");
  assert.ok(beats >= 1, `expected at least one heartbeat, got ${beats}`);
});
