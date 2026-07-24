import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBlueprintProvider } from "../.ai/node/blueprint-provider.js";

const repo = process.cwd();
const cli = join(repo, ".ai/node/node_modules/tsx/dist/cli.mjs");
const runtimeCli = join(repo, ".ai/node/ai-kit.ts");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "aikit-blueprint-"));
  mkdirSync(join(root, "Blueprint"), { recursive: true });
  writeFileSync(join(root, "Blueprint", "architecture.md"), "# Architecture\n");
  writeFileSync(
    join(root, "Blueprint", "blueprint.json"),
    JSON.stringify({
      version: 1,
      root: ".",
      documents: [{ id: "BP-1", kind: "architecture", path: "architecture.md" }],
    }),
  );
  return root;
}

function runCli(project: string, args: string[]) {
  return execFileSync(process.execPath, [cli, runtimeCli, ...args], {
    cwd: project,
    env: { ...process.env, AIKIT_ROOT: repo, AIKIT_PROJECT_ROOT: project, AIKIT_WORK: join(project, ".ai-work") },
    encoding: "utf8",
  });
}

test("Blueprint provider resolves stable documents and reports hashes", () => {
  const root = fixture();
  try {
    const provider = createBlueprintProvider(join(root, "Blueprint/blueprint.json"));
    const document = provider.resolve("BP-1");
    assert.equal(document.kind, "architecture");
    assert.match(document.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(provider.validate().valid, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Blueprint provider rejects traversal, symlink escape, and unindexed files", () => {
  const root = fixture();
  try {
    writeFileSync(join(root, "Blueprint", "unindexed.md"), "# Unindexed\n");
    const invalid = join(root, "Blueprint", "invalid.json");
    writeFileSync(
      invalid,
      JSON.stringify({ version: 1, root: ".", documents: [{ id: "BAD", kind: "note", path: "../outside.md" }] }),
    );
    assert.throws(() => createBlueprintProvider(invalid), /escapes the Blueprint root/);

    const outside = join(root, "outside.md");
    writeFileSync(outside, "# Outside\n");
    symlinkSync(outside, join(root, "Blueprint/linked.md"));
    const symlinkManifest = join(root, "Blueprint", "symlink.json");
    writeFileSync(
      symlinkManifest,
      JSON.stringify({ version: 1, root: ".", documents: [{ id: "LINK", kind: "note", path: "linked.md" }] }),
    );
    assert.throws(() => createBlueprintProvider(symlinkManifest), /through a symlink/);

    const provider = createBlueprintProvider(join(root, "Blueprint/blueprint.json"));
    assert.deepEqual(provider.validate().unindexed, ["unindexed.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("configured Blueprint context detects document drift", () => {
  const root = fixture();
  try {
    mkdirSync(join(root, ".ai-work"), { recursive: true });
    writeFileSync(
      join(root, ".ai-work/project.yaml"),
      "knowledge:\n  provider: blueprint\n  manifest: Blueprint/blueprint.json\n",
    );
    const probe = `
import { appendFileSync } from "node:fs";
import { resolveBlueprintReferences, assertBlueprintContext } from ${JSON.stringify(join(repo, ".ai/node/blueprint-provider.ts"))};
const context = resolveBlueprintReferences(["BP-1"]);
assertBlueprintContext(context);
appendFileSync(${JSON.stringify(join(root, "Blueprint/architecture.md"))}, "\\nchanged\\n");
try { assertBlueprintContext(context); process.exit(1); }
catch (error) { if (!(error instanceof Error) || !error.message.includes("drift detected")) process.exit(2); }
`;
    execFileSync(process.execPath, [cli, "-e", probe], {
      cwd: root,
      env: { ...process.env, AIKIT_ROOT: repo, AIKIT_PROJECT_ROOT: root, AIKIT_WORK: join(root, ".ai-work") },
      stdio: "pipe",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Blueprint CLI is opt-in and setup does not create a directory", () => {
  const root = mkdtempSync(join(tmpdir(), "aikit-blueprint-cli-"));
  try {
    mkdirSync(join(root, ".ai-work"), { recursive: true });
    writeFileSync(join(root, ".ai-work/project.yaml"), "knowledge:\n  provider: off\n");
    assert.throws(() => runCli(root, ["blueprint", "status"]), /Blueprint provider is disabled/);
    runCli(root, ["setup", "--knowledge-provider", "blueprint"]);
    assert.equal(existsSync(join(root, "Blueprint")), false);
    assert.match(readFileSync(join(root, ".ai-work/project.yaml"), "utf8"), /provider: blueprint/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
