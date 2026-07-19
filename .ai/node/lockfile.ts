// Reproducibility lockfile — pins the exact runtime and control-plane inputs a
// project depends on, so two machines can prove they run the same AI-Kit. The
// lock captures runtime dependency versions plus content hashes of role/skill
// contracts, plugin manifests, the security policy, the model config, and
// capability manifests.
//
// It does NOT (and cannot) pin model outputs — LLMs are non-deterministic. The
// guarantee is over *process and configuration*, not generated results.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { displayPath, now, PROJECT_ROOT, ROOT, WORK } from "./engine.js";

export class LockError extends Error {}

export const LOCK_PATH = join(ROOT, ".ai", "ai-kit.lock.json");
export const PROJECT_LOCK_PATH = join(PROJECT_ROOT, ".ai-kit.project.lock.json");
const NODE_PKG = join(ROOT, ".ai", "node", "package.json");
const RUNTIME = join(ROOT, ".ai", "node");
const AGENTS = join(ROOT, ".ai", "agents");
const SKILLS = join(ROOT, ".ai", "skills");
const PLUGINS = join(ROOT, ".ai", "plugins");
const CAPABILITIES = join(ROOT, ".ai", "capabilities");

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

// Hash selected files under a directory tree, excluding installed dependencies.
function hashTree(dir: string, include: (name: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") walk(full);
      else if (entry.isFile() && include(entry.name)) out[displayPath(full)] = sha256(full);
    }
  };
  walk(dir);
  return out;
}

function runtimeVersions(): Record<string, string> {
  if (!existsSync(NODE_PKG)) return {};
  const pkg = JSON.parse(readFileSync(NODE_PKG, "utf8"));
  return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
}

function hashFile(path: string): string | null {
  return existsSync(path) ? sha256(path) : null;
}

export type Lock = {
  version: 1;
  node_range: string | null;
  runtime: Record<string, string>;
  runtime_source: Record<string, string>;
  agents: Record<string, string>;
  skills: Record<string, string>;
  plugins: Record<string, string>;
  capabilities: Record<string, string>;
  security: string | null;
  models: string | null;
  kit: string | null;
  generated_at?: string;
};

export type ProjectLock = {
  version: 1;
  project_config: string | null;
  models: string | null;
  security: string | null;
  plugins: Record<string, string>;
  generated_at?: string;
};

// Deterministic snapshot (no timestamp) used for comparison.
export function computeLock(): Omit<Lock, "generated_at"> {
  const rootPkg = join(ROOT, "package.json");
  const nodeRange =
    existsSync(rootPkg) && JSON.parse(readFileSync(rootPkg, "utf8")).engines?.node
      ? JSON.parse(readFileSync(rootPkg, "utf8")).engines.node
      : null;
  return {
    version: 1,
    node_range: nodeRange,
    runtime: runtimeVersions(),
    runtime_source: hashTree(RUNTIME, (name) => [".ts", ".json", ".mjs"].includes(extname(name))),
    agents: hashTree(AGENTS, (name) => [".md", ".json", ".yaml", ".yml"].includes(extname(name))),
    skills: hashTree(SKILLS, (name) => [".md", ".json", ".yaml", ".yml"].includes(extname(name))),
    plugins: hashTree(PLUGINS, (name) => name.endsWith(".json")),
    capabilities: hashTree(CAPABILITIES, (name) => name.endsWith(".json")),
    security: hashFile(join(ROOT, ".ai", "security.yaml")),
    models: hashFile(join(ROOT, ".ai", "models.yaml")),
    kit: hashFile(join(ROOT, ".ai", "kit.yaml")),
  };
}

export function buildLock(): Lock {
  return { ...computeLock(), generated_at: now() };
}

export function readLock(path = LOCK_PATH): Lock {
  if (!existsSync(path)) throw new LockError(`lockfile not found: ${displayPath(path)}; run "ai-kit lock" first`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new LockError(`invalid lockfile JSON: ${displayPath(path)}`);
  }
}

export type LockDrift = { key: string; expected: string | null; actual: string | null };

// Compare the recorded lock to the current tree. Returns the list of drifts;
// empty means the environment matches the lock.
export function verifyLock(path = LOCK_PATH): { ok: boolean; drift: LockDrift[] } {
  const locked = readLock(path);
  const current = computeLock();
  const drift: LockDrift[] = [];
  const sections: (keyof Omit<Lock, "generated_at" | "version">)[] = [
    "node_range",
    "runtime",
    "runtime_source",
    "agents",
    "skills",
    "plugins",
    "capabilities",
    "security",
    "models",
    "kit",
  ];
  for (const section of sections) {
    const a = (locked as any)[section];
    const b = (current as any)[section];
    if (a && typeof a === "object") {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b ?? {})]))
        if (a[key] !== b?.[key])
          drift.push({ key: `${section}.${key}`, expected: a[key] ?? null, actual: b?.[key] ?? null });
    } else if (a !== b) {
      drift.push({ key: section, expected: a ?? null, actual: b ?? null });
    }
  }
  return { ok: drift.length === 0, drift };
}

const projectFile = (name: string) =>
  [join(WORK, name), join(PROJECT_ROOT, ".ai-work", name), join(PROJECT_ROOT, ".ai", name)].find((path) =>
    existsSync(path),
  );

function projectPlugins(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const directory of [join(WORK, "plugins"), join(PROJECT_ROOT, ".ai", "plugins")])
    Object.assign(
      result,
      hashTree(directory, (name) => name.endsWith(".json")),
    );
  return result;
}

export function computeProjectLock(): Omit<ProjectLock, "generated_at"> {
  return {
    version: 1,
    project_config: projectFile("project.yaml") ? hashFile(projectFile("project.yaml")!) : null,
    models: projectFile("models.yaml") ? hashFile(projectFile("models.yaml")!) : null,
    security: projectFile("security.yaml") ? hashFile(projectFile("security.yaml")!) : null,
    plugins: projectPlugins(),
  };
}

export function buildProjectLock(): ProjectLock {
  return { ...computeProjectLock(), generated_at: now() };
}

export function readProjectLock(path = PROJECT_LOCK_PATH): ProjectLock {
  if (!existsSync(path))
    throw new LockError(`project lockfile not found: ${displayPath(path)}; run "ai-kit lock" first`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new LockError(`invalid project lockfile JSON: ${displayPath(path)}`);
  }
}

export function verifyProjectLock(path = PROJECT_LOCK_PATH): { ok: boolean; drift: LockDrift[] } {
  const locked = readProjectLock(path);
  const current = computeProjectLock();
  const drift: LockDrift[] = [];
  for (const key of ["project_config", "models", "security"] as const)
    if (locked[key] !== current[key]) drift.push({ key, expected: locked[key], actual: current[key] });
  for (const key of new Set([...Object.keys(locked.plugins), ...Object.keys(current.plugins)]))
    if (locked.plugins[key] !== current.plugins[key])
      drift.push({
        key: `plugins.${key}`,
        expected: locked.plugins[key] ?? null,
        actual: current.plugins[key] ?? null,
      });
  return { ok: drift.length === 0, drift };
}
