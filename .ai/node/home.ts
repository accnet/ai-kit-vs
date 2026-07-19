// Global AI-Kit home — shared runtime assets that live outside any single
// project, at `~/ai-kit/` (override with AIKIT_HOME). Projects keep their own
// disposable state in `.ai-work/`; the home holds reusable plugins, prompts,
// workflows, models, templates, config, cache and logs.
//
// Resolution precedence is project-first: a plugin present in the project's
// `.ai/plugins/` shadows the same id in the global home, so a project can always
// override a shared default without editing global state.

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const HOME_SUBDIRS = [
  "plugins",
  "prompts",
  "workflows",
  "models",
  "templates",
  "config",
  "cache",
  "logs",
] as const;

export function aiKitHome(): string {
  return process.env.AIKIT_HOME ? resolve(process.env.AIKIT_HOME) : join(homedir(), "ai-kit");
}

export const homeSubdir = (name: (typeof HOME_SUBDIRS)[number]) => join(aiKitHome(), name);

// Create the home skeleton if missing; returns the directories that were created.
export function initHome(): { home: string; created: string[] } {
  const home = aiKitHome();
  const created: string[] = [];
  for (const name of HOME_SUBDIRS) {
    const dir = join(home, name);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      created.push(name);
    }
  }
  return { home, created };
}

// Given a project-relative plugin path and the project root, return the first
// existing location (project first, then global home). Returns null if neither
// exists so the caller can raise a not-found error.
export function resolvePluginPath(projectRoot: string, role: string, id: string): string | null {
  const candidates = [
    join(projectRoot, ".ai-work", "plugins", role, `${id}.json`),
    join(projectRoot, ".ai", "plugins", role, `${id}.json`),
    join(homeSubdir("plugins"), role, `${id}.json`),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}
