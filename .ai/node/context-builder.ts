// Context Builder — the independent stage that assembles a Context Bundle from
// several sources, so both the Planner and the Executor consume the same rich,
// task-agnostic context instead of it being coupled to the Planner:
//
//   Workspace → Git → Architecture → Requirement → Memory → Context Bundle
//
// The Bundle carries each source group plus the Context Engine's ranked,
// token-budgeted selection over every file it gathered.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  displayPath,
  PROJECT_ROOT,
  resolveProjectPath,
  routeTask,
  workspace as workspaceOf,
  type Task,
} from "./engine.js";
import { kitArray } from "./config.js";
import { listMemory } from "./memory.js";
import { assembleContext, type AssembledContext } from "./context.js";

export type ContextBundle = {
  task: string;
  workspace: string[]; // configured source dirs + the task's own files
  git: { branch: string | null; changed: string[] };
  architecture: string[]; // engine contracts + architecture decisions
  requirement: { acceptance: string[]; docs: string[] };
  memory: { kind: string; title: string; path: string }[];
  context: AssembledContext; // ranked, token-budgeted selection over all files
};

const exists = (p: string) => existsSync(resolveProjectPath(p));

export function buildBundle(task: Task, statePath: string, budget?: number): ContextBundle {
  const root = displayPath(workspaceOf(statePath));

  // Workspace: configured source directories plus the task's declared files.
  const workspaceSources = [...kitArray("source_dirs"), ...(task.files ?? [])];

  // Git: current branch and the working-tree changes.
  const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: PROJECT_ROOT, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--short"], { cwd: PROJECT_ROOT, encoding: "utf8" });
  const git = {
    branch: branch.status === 0 ? branch.stdout.trim() : null,
    changed: status.status === 0 ? status.stdout.split(/\r?\n/).filter(Boolean) : [],
  };

  // Architecture: the engine state contract and recorded architecture decisions.
  const decisions = listMemory("decision").map((entry) => entry.path);
  const architecture = [".ai/engine/state-schema.md", ...decisions].filter(exists);

  // Requirement: the task's acceptance criteria and the planning documents.
  const docs = ["roadmap/roadmap.md", "plan/plan.md", "tasks/tasks.md"].map((name) => `${root}/${name}`);
  const requirement = { acceptance: task.acceptance ?? [], docs };

  // Memory: the most recent durable entries.
  const memory = listMemory()
    .slice(0, 10)
    .map(({ kind, title, path }) => ({ kind, title, path }));

  // Ranked, budgeted selection over every real file the bundle gathered.
  const route = routeTask(task, statePath);
  const context = assembleContext(
    [route.role_contract, ...route.skills, ...route.context, ...(task.files ?? []), ...architecture, ...docs],
    budget,
  );

  return { task: task.id, workspace: workspaceSources, git, architecture, requirement, memory, context };
}
