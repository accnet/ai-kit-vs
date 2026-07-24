// Context Builder — the independent stage that assembles a Context Bundle from
// several sources, so both the Planner and the Executor consume the same rich,
// task-agnostic context instead of it being coupled to the Planner:
//
//   Workspace → Git → Architecture → Requirement → Memory → Context Bundle
//
// The Bundle carries each source group plus the Context Engine's ranked,
// token-budgeted selection over every file it gathered.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  displayPath,
  load,
  PROJECT_ROOT,
  resolveProjectPath,
  routeTask,
  workspace as workspaceOf,
  type Task,
} from "./engine.js";
import { kitArray } from "./config.js";
import { listMemory } from "./memory.js";
import { assembleContext, type AssembledContext } from "./context.js";
import { resolveBlueprintReferences } from "./blueprint-provider.js";
import type { SourceContext } from "./source-provider.js";

export type ContextBundle = {
  task: string;
  workspace: string[]; // configured source dirs + the task's own files
  git: { branch: string | null; changed: string[] };
  architecture: string[]; // engine contracts + architecture decisions
  requirement: { acceptance: string[]; docs: string[] };
  memory: { kind: string; title: string; path: string }[];
  context: AssembledContext; // ranked, token-budgeted selection over all files
  blueprint?: SourceContext;
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

  // Requirement: keep task context bounded to the current task and its direct
  // dependencies. The historical tasks.md remains available to humans but is
  // deliberately excluded from provider prompts.
  const state = load<{ tasks: Task[] }>(statePath);
  const dependencies = (task.needs ?? [])
    .map((id) => state.tasks.find((item) => item.id === id))
    .filter((item): item is Task => !!item);
  const requirementPath = join(workspaceOf(statePath), "context", `${task.id}-requirements.md`);
  mkdirSync(join(workspaceOf(statePath), "context"), { recursive: true });
  const requirementText = [
    `# Task Context: ${task.id}`,
    "",
    `- Title: ${task.title}`,
    `- Owner: ${task.owner}`,
    `- Phase: ${task.phase}`,
    `- Status: ${task.status}`,
    `- Dependencies: ${(task.needs ?? []).join(", ") || "none"}`,
    "",
    "## Acceptance",
    ...(task.acceptance ?? []).map((item) => `- ${item}`),
    "",
    "## Declared Files",
    ...(task.files ?? []).map((item) => `- ${item}`),
    "",
    "## Direct Dependency State",
    ...(dependencies.length
      ? dependencies.flatMap((item) => [
          `### ${item.id}: ${item.title}`,
          `- Status: ${item.status}`,
          `- Acceptance: ${(item.acceptance ?? []).join("; ")}`,
        ])
      : ["- none"]),
    "",
  ].join("\n");
  writeFileSync(requirementPath, requirementText);
  const docs = ["roadmap/roadmap.md", "plan/plan.md"].map((name) => `${root}/${name}`);
  docs.push(displayPath(requirementPath));
  const requirement = { acceptance: task.acceptance ?? [], docs };

  // Memory: the most recent durable entries.
  const memory = listMemory()
    .slice(0, 10)
    .map(({ kind, title, path }) => ({ kind, title, path }));

  const blueprint = resolveBlueprintReferences(task.references ?? []);

  // Ranked, budgeted selection over every real file the bundle gathered.
  const route = routeTask(task, statePath);
  const context = assembleContext(
    [route.role_contract, ...route.skills, ...route.context, ...(task.files ?? []), ...architecture, ...docs],
    budget,
  );

  return { task: task.id, workspace: workspaceSources, git, architecture, requirement, memory, context, blueprint };
}
