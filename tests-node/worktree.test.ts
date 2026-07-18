import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorktree, GitError, mergeWorktree } from "../.ai/node/worktree.js";

const git = (args: string[], cwd: string) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
};

test("Node worktrees preserve dependency merge order and dirty work", () => {
  const root = mkdtempSync(join(tmpdir(), "aikit-node-worktree-")),
    repo = join(root, "project"),
    previous = process.env.AIKIT_WT_DIR;
  process.env.AIKIT_WT_DIR = join(root, "worktrees");
  try {
    git(["init", "-q", "-b", "main", repo], root);
    git(["config", "user.email", "test@example.com"], repo);
    git(["config", "user.name", "test"], repo);
    writeFileSync(join(repo, "README.md"), "base\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "base"], repo);
    const first = createWorktree("T1", repo),
      second = createWorktree("T2", repo);
    writeFileSync(join(first.worktree, "first.txt"), "first\n");
    git(["add", "."], first.worktree);
    git(["commit", "-qm", "first"], first.worktree);
    writeFileSync(join(second.worktree, "second.txt"), "second\n");
    git(["add", "."], second.worktree);
    git(["commit", "-qm", "second"], second.worktree);
    assert.deepEqual(mergeWorktree("T2", repo, ["agent/T1"]), {
      merged: false,
      reason: "dependencies not merged yet",
      missing: ["agent/T1"],
    });
    assert.equal(mergeWorktree("T1", repo, []).merged, true);
    assert.equal(mergeWorktree("T2", repo, ["agent/T1"]).merged, true);
    assert.equal(existsSync(join(repo, "first.txt")), true);
    assert.equal(existsSync(join(repo, "second.txt")), true);
    const dirty = createWorktree("T3", repo);
    writeFileSync(join(dirty.worktree, "uncommitted.txt"), "keep\n");
    assert.throws(() => createWorktree("T3", repo), GitError);
  } finally {
    if (previous === undefined) delete process.env.AIKIT_WT_DIR;
    else process.env.AIKIT_WT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
