import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export class GitError extends Error {}
const run = (args: string[], cwd: string, check = true) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  const text = `${result.stderr || result.stdout || ""}`.trim();
  if (check && result.status !== 0) throw new GitError(`git ${args.join(" ")}: ${text}`);
  return `${result.stdout || ""}`.trim();
};
export const branch = (task: string) => `agent/${task}`;
const worktreePath = (task: string, repo: string) =>
  join(process.env.AIKIT_WT_DIR ?? join(dirname(repo), `${repo.split(/[\\/]/).at(-1)}-wt`), task);
export function createWorktree(task: string, repo: string, base = "HEAD") {
  const path = worktreePath(task, repo),
    name = branch(task),
    existing = run(["branch", "--list", name], repo);
  mkdirSync(dirname(path), { recursive: true });
  run(["worktree", "prune"], repo, false);
  if (existsSync(path)) {
    const dirty = run(["status", "--porcelain"], path, false);
    if (!existing) throw new GitError(`worktree path exists without branch ${name}: ${path}`);
    if (dirty) throw new GitError(`refusing to reuse dirty worktree: ${path}`);
    return { task, branch: name, worktree: path };
  }
  run(existing ? ["worktree", "add", path, name] : ["worktree", "add", "-b", name, path, base], repo);
  return { task, branch: name, worktree: path };
}
export function mergeWorktree(task: string, repo: string, dependencies: string[], target = "main") {
  const missing = dependencies.filter(
    (item) => spawnSync("git", ["merge-base", "--is-ancestor", item, target], { cwd: repo }).status !== 0,
  );
  if (missing.length) return { merged: false, reason: "dependencies not merged yet", missing };
  const name = branch(task);
  if (!run(["branch", "--list", name], repo)) throw new GitError(`no branch ${name} to merge`);
  run(["checkout", target], repo);
  run(["merge", "--no-ff", "--no-edit", name], repo);
  run(["worktree", "remove", "--force", worktreePath(task, repo)], repo, false);
  return { merged: true, task, branch: name, target };
}
