import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { kitArray } from "./config.js";

// The kit root. Defaults to this file's grandparent, but AIKIT_ROOT lets the
// runtime run against a relocated or shared kit without moving its own files.
export const ROOT = process.env.AIKIT_ROOT ? resolve(process.env.AIKIT_ROOT) : resolve(import.meta.dirname, "..", "..");
// In a global install ROOT is the shared runtime while PROJECT_ROOT is the
// repository the command is acting on. Local installs keep the historic
// behavior because both roots resolve to the same directory.
export const PROJECT_ROOT = process.env.AIKIT_PROJECT_ROOT ? resolve(process.env.AIKIT_PROJECT_ROOT) : ROOT;
export const WORK = process.env.AIKIT_WORK ? resolve(process.env.AIKIT_WORK) : join(ROOT, ".ai-work");
// One layout: every workflow lives under .ai-work/workflows/<id>/. The default
// single-state workflow is simply the "default" workflow.
export const STATE = join(WORK, "workflows", "default", "state", "workflow.json");
export const CURRENT = join(WORK, "state", "current.json");
export const REGISTRY = join(WORK, "registry.json");
export const WORKFLOWS = join(WORK, "workflows");
const ROLE_DOMAINS: Record<string, string[]> = {
  backend: ["backend", "database", "ai"],
  frontend: ["frontend"],
  database: ["database"],
  devops: ["devops"],
  release: ["devops"],
  qa: ["testing"],
};
const CORE_BY_ROLE: Record<string, string[]> = {
  planner: ["requirements-intake", "skill-router"],
  researcher: ["requirements-intake", "skill-router"],
  architect: ["refactoring", "api-contract"],
  backend: ["api-contract", "observability"],
  frontend: ["frontend-core", "test-and-validation"],
  database: ["data-migration", "api-contract"],
  devops: ["deployment-infra", "observability"],
  qa: ["test-and-validation", "debugging"],
  reviewer: ["code-review", "api-contract"],
  security: ["security-review", "threat-modeling"],
  integration: ["integration-contracts", "webhooks-and-retries"],
  performance: ["performance-profiling", "observability"],
  scheduler: ["workflow-orchestration"],
  router: ["workflow-orchestration", "skill-router"],
  document: ["documentation-maintenance", "architecture-decisions"],
  release: ["release-management", "deployment-infra", "github-actions-ci"],
};
const STACK_ALIASES: Record<string, string[]> = {
  postgresql: ["postgres", "postgresql"],
};
const LOCK_TTL_MS = Number(process.env.AIKIT_LOCK_TTL_SECONDS ?? "300") * 1000;
const STATUSES = new Set([
  "todo",
  "in-progress",
  "implementation-complete",
  "qa-passed",
  "review-approved",
  "done",
  "replaced",
  "blocked",
]);
export type TaskStatus =
  | "todo"
  | "in-progress"
  | "implementation-complete"
  | "qa-passed"
  | "review-approved"
  | "done"
  | "replaced"
  | "blocked";
const TRANSITIONS: Record<string, [Set<TaskStatus>, TaskStatus]> = {
  start: [new Set(["todo"]), "in-progress"],
  complete: [new Set(["in-progress"]), "implementation-complete"],
  "qa-pass": [new Set(["implementation-complete"]), "qa-passed"],
  "review-approve": [new Set(["qa-passed"]), "review-approved"],
  close: [new Set(["review-approved"]), "done"],
  "micro-close": [new Set(["implementation-complete", "qa-passed"]), "done"],
  replace: [new Set(["qa-passed"]), "replaced"],
  block: [new Set(["todo", "in-progress", "implementation-complete", "qa-passed", "review-approved"]), "blocked"],
  unblock: [new Set(["blocked"]), "todo"],
};

export class EngineError extends Error {}
export interface Claim {
  client_id: string;
  attempt_id: string;
  claimed_at: string;
  lease_expires_at: string;
}
export interface Task {
  id: string;
  title: string;
  owner: string;
  phase: string;
  needs: string[];
  status: TaskStatus;
  acceptance: string[];
  files: string[];
  tags: string[];
  attempts: number;
  evidence: string[];
  blocked_reason: string | null;
  claim?: Claim | null;
  implementation_client?: string;
  implementation_attempt?: string;
  remediation_for?: string;
}
export interface Event {
  seq: number;
  ts: string;
  action: string;
  task: string | null;
  actor: string;
  from: string | null;
  to: string | null;
  detail: string;
}
export interface Phase {
  id: string;
  status: "complete" | "open" | "planned";
  tasks: string[];
}
export type State = {
  version: number;
  revision: number;
  title: string;
  workflow: string;
  created_at: string;
  tasks: Task[];
  phases: Phase[];
  events: Event[];
};
export const stamp = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");
export const now = () => stamp(new Date());
export function assertWorkProject() {
  if (!existsSync(CURRENT)) return;
  try {
    const current = JSON.parse(readFileSync(CURRENT, "utf8")) as { project_root?: string };
    if (current.project_root && resolve(current.project_root) !== PROJECT_ROOT)
      throw new EngineError(
        `AI-Kit work state belongs to ${current.project_root}, not ${PROJECT_ROOT}; use a project-specific AIKIT_WORK`,
      );
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw new EngineError(`invalid AI-Kit work identity: ${CURRENT}`);
  }
}
export function currentWorkflowStatePath(fallback = STATE) {
  if (!existsSync(CURRENT)) return fallback;
  try {
    const current = JSON.parse(readFileSync(CURRENT, "utf8")) as { workflow_state?: string };
    if (!current.workflow_state) return fallback;
    if (isAbsolute(current.workflow_state)) return resolve(current.workflow_state);
    const candidates = [
      join(PROJECT_ROOT, current.workflow_state),
      join(WORK, current.workflow_state),
      join(ROOT, current.workflow_state),
    ];
    return candidates.find((path) => existsSync(path)) ?? fallback;
  } catch {
    return fallback;
  }
}
export function bindWorkProject() {
  if (!existsSync(CURRENT)) return { bound: false, reason: "no current workflow" };
  assertWorkProject();
  const current = JSON.parse(readFileSync(CURRENT, "utf8")) as Record<string, unknown>;
  if (current.project_root === PROJECT_ROOT) return { bound: true, current };
  const payload = { ...current, project_root: PROJECT_ROOT };
  const lock = `${CURRENT}.lock`;
  acquire(lock);
  try {
    mkdirSync(dirname(CURRENT), { recursive: true });
    const temporary = `${CURRENT}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`);
    renameSync(temporary, CURRENT);
  } finally {
    release(lock);
  }
  return { bound: true, current: payload };
}
export const resolveProjectPath = (path: string) => {
  if (isAbsolute(path)) return path;
  const projectPath = join(PROJECT_ROOT, path);
  if (existsSync(projectPath)) return projectPath;
  const shared =
    /^(?:\.ai\/(?:agents|capabilities|context|engine|modules|skills|workflows)(?:\/|$)|\.ai\/(?:registry|rules)\.yaml$)/.test(
      path.replaceAll("\\", "/"),
    );
  return shared ? join(ROOT, path) : projectPath;
};
export const displayPath = (path: string) => {
  for (const root of [PROJECT_ROOT, ROOT]) {
    const item = relative(root, path);
    if (item && !item.startsWith("..") && !isAbsolute(item)) return item.replaceAll("\\", "/");
    if (item === "") return ".";
  }
  return path;
};
export const workspace = (path: string) =>
  basename(dirname(path)) === "state" ? dirname(dirname(path)) : join(dirname(path), basename(path, ".json"));
export const workflowStatePath = (id: string) => join(WORKFLOWS, workflowId(id), "state", "workflow.json");
export function workflowId(id: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id))
    throw new EngineError("workflow ID must use lowercase letters, numbers, and hyphens");
  return id;
}
// Task IDs are embedded verbatim into artifact and worktree filesystem paths
// (artifacts.ts artifactPath, worktree.ts worktreePath). Path separators or a
// bare ".." segment would let a task ID escape the workflow's directory, so
// this charset excludes them by construction.
export function taskId(id: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id))
    throw new EngineError(`task ID must use letters, numbers, dots, hyphens, and underscores: ${id}`);
  return id;
}
export const roleNames = () =>
  new Set(
    readdirSync(join(ROOT, ".ai", "agents"), { withFileTypes: true })
      .filter((x) => x.isDirectory())
      .map((x) => x.name),
  );
export const workflowNames = () =>
  new Set(
    readdirSync(join(ROOT, ".ai", "workflows"), { withFileTypes: true })
      .filter((x) => x.isDirectory())
      .map((x) => x.name),
  );
export const taskMap = (state: State) => new Map(state.tasks.map((task) => [task.id, task]));
export const newState = (title: string, workflow: string): State => ({
  version: 1,
  revision: 0,
  title,
  workflow,
  created_at: now(),
  tasks: [],
  phases: [],
  events: [],
});
export function configuredStack() {
  return kitArray("stack");
}
export function routeTask(task: Task, statePath: string) {
  const stack = configuredStack(),
    skills: string[] = [],
    skillRoot = join(ROOT, ".ai", "skills");
  for (const domain of ROLE_DOMAINS[task.owner] ?? []) {
    const directory = join(skillRoot, domain);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const overview = join(directory, entry.name, "overview.md");
      const stackNames = STACK_ALIASES[entry.name] ?? [entry.name];
      if (existsSync(overview) && stackNames.some((name) => stack.has(name))) skills.push(displayPath(overview));
    }
  }
  for (const name of CORE_BY_ROLE[task.owner] ?? ["skill-router"]) {
    const skill = join(skillRoot, "core", name, "SKILL.md");
    if (existsSync(skill)) skills.push(displayPath(skill));
  }
  const root = workspace(statePath);
  return {
    task: task.id,
    owner: task.owner,
    tags: task.tags,
    role_contract: `.ai/agents/${task.owner}`,
    skills,
    context: [
      displayPath(join(root, "plan", "plan.md")),
      displayPath(join(root, "tasks", "tasks.md")),
      ".ai/engine/state-schema.md",
      ...task.files,
    ],
  };
}

export function load<T = State>(path: string): T {
  assertWorkProject();
  if (!existsSync(path)) throw new EngineError(`state not found: ${path}; run init first`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new EngineError(`invalid JSON state: ${(error as Error).message}`);
  }
}
function pidAlive(pid?: number) {
  if (typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === "EPERM";
  }
}
function lockStale(path: string) {
  try {
    const meta = JSON.parse(readFileSync(path, "utf8"));
    if (meta.host === hostname() && typeof meta.pid === "number" && !pidAlive(meta.pid)) return true;
    return Date.now() - Date.parse(meta.created_at ?? "") > LOCK_TTL_MS;
  } catch {
    try {
      return Date.now() - statSync(path).mtimeMs > LOCK_TTL_MS;
    } catch {
      return false;
    }
  }
}
function acquire(lock: string) {
  mkdirSync(dirname(lock), { recursive: true });
  const end = Date.now() + 5000;
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      writeFileSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), created_at: now() }));
      closeSync(fd);
      return;
    } catch {
      if (existsSync(lock) && lockStale(lock)) {
        try {
          unlinkSync(lock);
        } catch {}
        continue;
      }
      if (Date.now() >= end) throw new EngineError(`state is locked: ${lock.replace(/\.lock$/, "")}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}
function release(lock: string) {
  const end = Date.now() + 1000;
  for (;;) {
    try {
      rmSync(lock, { force: true });
      return;
    } catch (error) {
      if (Date.now() >= end) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}
function writeLocked(payload: any, path: string, expected?: number) {
  const actual = existsSync(path) ? (load<any>(path).revision ?? 0) : 0;
  if (expected !== undefined && actual !== expected)
    throw new EngineError(`state changed concurrently (expected revision ${expected}, found ${actual})`);
  payload.revision = actual + 1;
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(temporary, path);
}
export function saveJson(payload: any, path: string, expected?: number) {
  const lock = `${path}.lock`;
  acquire(lock);
  try {
    writeLocked(payload, path, expected);
  } finally {
    release(lock);
  }
}
function managedState(path: string) {
  const item = relative(WORK, resolve(path));
  return item && !item.startsWith("..") && !isAbsolute(item);
}
function writeCurrent(state: State, path: string) {
  if (!managedState(path)) return;
  const lock = `${CURRENT}.lock`,
    payload = {
      version: 1,
      project_root: PROJECT_ROOT,
      workflow_state: displayPath(path),
      title: state.title,
      workflow: state.workflow,
      active_tasks: state.tasks.filter((task) => task.status === "in-progress").map((task) => task.id),
      updated_at: now(),
    };
  acquire(lock);
  try {
    mkdirSync(dirname(CURRENT), { recursive: true });
    const temporary = `${CURRENT}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`);
    renameSync(temporary, CURRENT);
  } finally {
    release(lock);
  }
}
export function save(state: State, path: string, expected?: number) {
  assertWorkProject();
  saveJson(state, path, expected);
  writeCurrent(state, path);
  syncWorkflowDocs(state, path);
}

function markdownText(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

export function syncWorkflowDocs(state: State, path: string) {
  if (!managedState(path)) return;
  const root = workspace(path);
  mkdirSync(join(root, "plan"), { recursive: true });
  mkdirSync(join(root, "roadmap"), { recursive: true });
  mkdirSync(join(root, "tasks"), { recursive: true });
  const phases = state.phases.map((phase) => `- ${phase.id}: ${phase.status} (${phase.tasks.join(", ")})`).join("\n");
  const tasks = state.tasks
    .map(
      (task) =>
        `- [${task.status === "done" ? "x" : " "}] ${task.id} ${markdownText(task.title)} | owner: ${task.owner} | phase: ${task.phase} | status: ${task.status} | needs: ${task.needs.join(", ") || "-"} | files: ${task.files.join(", ") || "-"}\n` +
        task.acceptance.map((criterion) => `  - Accept: ${markdownText(criterion)}`).join("\n"),
    )
    .join("\n");
  writeFileSync(
    join(root, "plan", "plan.md"),
    `# Plan: ${state.title}\n\nGoal: ${state.title}\nWorkflow: ${state.workflow}\n\n## Phases\n${phases || "- pending task creation"}\n\nVerification: each task must pass implementation, QA, independent review, and gate closure.\n`,
  );
  writeFileSync(
    join(root, "roadmap", "roadmap.md"),
    `# Roadmap\n\n## Now\n- ${state.title}\n\n## Phases\n${phases || "- pending task creation"}\n\n## Later\n- Revisit scope after MVP evidence.\n`,
  );
  writeFileSync(
    join(root, "tasks", "tasks.md"),
    `# Tasks - ${state.title}\n\nIntent: ${state.workflow}\nGoal: ${state.title}\nOut of scope: see task acceptance criteria and architecture docs.\n\n## Tasks\n${tasks || "- [ ] No tasks created yet."}\n`,
  );
}
export const loadRegistry = () =>
  existsSync(REGISTRY) ? load<any>(REGISTRY) : { version: 1, revision: 0, workflows: [] };

export function validate(state: State) {
  for (const key of ["version", "revision", "title", "workflow", "tasks", "phases", "events"])
    if (!(key in state)) throw new EngineError(`state missing keys: ${key}`);
  if (!workflowNames().has(state.workflow)) throw new EngineError(`unknown workflow: ${state.workflow}`);
  const tasks = taskMap(state);
  if (tasks.size !== state.tasks.length) throw new EngineError("task IDs must be unique");
  const roles = roleNames();
  for (const task of state.tasks) {
    for (const key of [
      "id",
      "title",
      "owner",
      "phase",
      "needs",
      "status",
      "acceptance",
      "files",
      "attempts",
      "evidence",
      "tags",
    ])
      if (!(key in task)) throw new EngineError(`task ${task.id ?? "?"} missing ${key}`);
    taskId(task.id);
    if (!STATUSES.has(task.status)) throw new EngineError(`task ${task.id} has invalid status`);
    if (!roles.has(task.owner)) {
      const valid = [...roles].sort().join(", ");
      throw new EngineError(
        `task ${task.id} has unknown owner: ${task.owner}; valid task owners: ${valid || "none"}. ` +
          "Task owners are agent roles under .ai/agents; provider roles such as executor belong in models.yaml.",
      );
    }
    if (!task.phase?.trim() || !task.acceptance?.length)
      throw new EngineError(`task ${task.id} needs phase and acceptance criteria`);
    for (const dependency of task.needs)
      if (!tasks.has(dependency)) throw new EngineError(`task ${task.id} has unknown dependency: ${dependency}`);
    if (task.needs.includes(task.id)) throw new EngineError(`task ${task.id} cannot depend on itself`);
  }
  const seen = new Set<string>(),
    active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) throw new EngineError(`dependency cycle detected at ${id}`);
    if (!seen.has(id)) {
      active.add(id);
      for (const dep of tasks.get(id)!.needs) visit(dep);
      active.delete(id);
      seen.add(id);
    }
  };
  for (const id of tasks.keys()) visit(id);
}
const dependencyComplete = (task: Task) => ["done", "replaced"].includes(task.status);
export const runnable = (task: Task, tasks: Map<string, Task>) =>
  task.status === "todo" && task.needs.every((id: string) => dependencyComplete(tasks.get(id)!));
export function syncPhases(state: State) {
  const tasks = taskMap(state);
  state.phases = [...new Set(state.tasks.map((task) => task.phase))].sort().map((id) => {
    const phaseTasks = state.tasks.filter((task) => task.phase === id);
    return {
      id,
      status: phaseTasks.every(dependencyComplete)
        ? "complete"
        : phaseTasks.some((task) => runnable(task, tasks))
          ? "open"
          : "planned",
      tasks: phaseTasks.map((task) => task.id),
    };
  });
}
export function event(
  state: State,
  path: string,
  action: string,
  task: Task | null,
  actor: string,
  from: string | null,
  to: string | null,
  detail = "",
) {
  const seq = Math.max(0, ...state.events.map((item) => item.seq ?? 0)) + 1;
  const item = { seq, ts: now(), action, task: task?.id ?? null, actor, from, to, detail };
  state.events.push(item);
  const log = join(workspace(path), "logs", "events.jsonl");
  mkdirSync(dirname(log), { recursive: true });
  writeFileSync(log, `${JSON.stringify(item)}\n`, { flag: "a" });
  return item;
}
function taskFromInput(input: any): Task {
  return {
    id: input.id,
    title: input.title,
    owner: input.owner,
    phase: input.phase,
    needs: input.needs ?? [],
    status: "todo",
    acceptance: input.acceptance,
    files: input.files ?? [],
    tags: input.tags ?? [],
    attempts: 0,
    evidence: [],
    blocked_reason: null,
  };
}

export function addTasks(path: string, inputs: any[]) {
  if (!inputs.length) throw new EngineError("add-tasks requires at least one task");
  const state = load<State>(path);
  const tasks = taskMap(state);
  const additions = inputs.map((input) => {
    if (tasks.has(input.id)) throw new EngineError(`task already exists: ${input.id}`);
    if (!input.acceptance?.length) throw new EngineError("add-task requires at least one --acceptance criterion");
    const task = taskFromInput(input);
    tasks.set(input.id, task);
    return task;
  });
  const next: State = {
    ...state,
    tasks: [...state.tasks, ...additions],
    phases: [...state.phases],
    events: [...state.events],
  };
  validate(next);
  syncPhases(next);
  for (const [index, task] of additions.entries()) {
    const input = inputs[index];
    event(next, path, "add-task", task, input.actor ?? "planner", null, "todo", "task added");
  }
  save(next, path, inputs[0]?.expectedRevision ?? state.revision);
  return additions;
}

export function addTask(path: string, input: any) {
  return addTasks(path, [input])[0];
}
function validateEvidence(task: Task, action: string, items: string[]) {
  const expectedKind = action === "qa-pass" ? "qa" : "review";
  for (const item of items) {
    const path = resolveProjectPath(item);
    if (!existsSync(path) || !path.endsWith(".json"))
      throw new EngineError(`${action} evidence must be an existing JSON file: ${item}`);
    let payload: any;
    try {
      payload = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new EngineError(`invalid evidence JSON: ${item}`);
    }
    if (payload.kind !== expectedKind || payload.task !== task.id)
      throw new EngineError(`evidence does not match ${expectedKind} task ${task.id}: ${item}`);
    if (action === "qa-pass" && payload.status !== "pass") throw new EngineError(`QA evidence is not passing: ${item}`);
    if (action === "review-approve" && payload.verdict !== "approve")
      throw new EngineError(`review evidence is not approved: ${item}`);
    if (action === "replace" && payload.verdict !== "changes-requested")
      throw new EngineError(`replacement evidence must request changes: ${item}`);
  }
}
export function transition(
  path: string,
  id: string,
  action: string,
  actor: string,
  detail = "",
  evidence: string[] = [],
  expectedRevision?: number,
  claim?: any,
) {
  const state = load<State>(path);
  validate(state);
  const task = taskMap(state).get(id);
  if (!task) throw new EngineError(`unknown task: ${id}`);
  const rule = TRANSITIONS[action];
  if (!rule || !rule[0].has(task.status)) throw new EngineError(`cannot ${action} ${id} from ${task.status}`);
  if (action === "start" && !runnable(task, taskMap(state)))
    throw new EngineError(`task ${id} is blocked by unfinished dependencies`);
  if (action === "block" && !detail) throw new EngineError("block requires --detail");
  if (["qa-pass", "review-approve", "replace"].includes(action)) {
    if (!evidence.length) throw new EngineError(`${action} requires at least one --evidence path`);
    validateEvidence(task, action, evidence);
  }
  const previous = task.status;
  task.status = rule[1];
  task.blocked_reason = task.status === "blocked" ? detail : null;
  if (evidence.length) task.evidence.push(...evidence);
  if (action === "start") {
    task.attempts++;
    task.claim = claim ?? null;
  }
  if (["complete", "block"].includes(action)) {
    if (task.claim) {
      task.implementation_client = task.claim.client_id;
      task.implementation_attempt = task.claim.attempt_id;
    }
    task.claim = null;
  }
  syncPhases(state);
  event(state, path, action, task, actor, previous, task.status, detail);
  save(state, path, expectedRevision ?? state.revision);
  return task;
}

export function replaceWithRemediation(path: string, id: string, actor: string, detail: string, evidence: string[]) {
  const state = load<State>(path);
  validate(state);
  const task = taskMap(state).get(id);
  if (!task) throw new EngineError(`unknown task: ${id}`);
  if (task.status !== "qa-passed") throw new EngineError(`cannot replace ${id} from ${task.status}`);
  if (!detail) throw new EngineError("replacement requires review notes");
  if (!evidence.length) throw new EngineError("replacement requires review evidence");
  validateEvidence(task, "replace", evidence);

  const prefix = `${id}-R`;
  const revision = state.tasks.filter((item) => item.id.startsWith(prefix)).length + 1;
  const remediationId = `${prefix}${revision}`;
  const remediation: Task = {
    id: remediationId,
    title: `Address review for ${id}: ${task.title}`,
    owner: task.owner,
    phase: task.phase,
    needs: [...task.needs],
    status: "todo",
    acceptance: [...task.acceptance, `Address review notes: ${detail}`],
    files: [...task.files],
    tags: [...task.tags, "remediation"],
    attempts: 0,
    evidence: [],
    blocked_reason: null,
    remediation_for: id,
  };
  const previous = task.status;
  task.status = "replaced";
  task.evidence.push(...evidence);
  for (const dependent of state.tasks)
    if (dependent.id !== id && dependent.needs.includes(id))
      dependent.needs = dependent.needs.map((need: string) => (need === id ? remediationId : need));
  state.tasks.push(remediation);
  validate(state);
  syncPhases(state);
  event(state, path, "replace", task, actor, previous, "replaced", detail);
  event(state, path, "add-task", remediation, "state-manager", null, "todo", `remediation for ${id}`);
  save(state, path, state.revision);
  return remediation;
}
export function createWorkflow(id: string, title: string, workflow: string, actor: string) {
  workflowId(id);
  if (!workflowNames().has(workflow)) throw new EngineError(`unknown workflow: ${workflow}`);
  const lock = `${REGISTRY}.lock`;
  acquire(lock);
  try {
    const registry = loadRegistry();
    if (registry.workflows.some((item: any) => item.id === id)) throw new EngineError(`workflow already exists: ${id}`);
    const path = workflowStatePath(id);
    if (existsSync(path)) throw new EngineError(`workflow state already exists without registry entry: ${id}`);
    const state = newState(title, workflow);
    event(state, path, "init", null, actor, null, null, "workflow initialized");
    save(state, path);
    registry.workflows.push({ id, title, workflow, state: displayPath(path), created_at: state.created_at });
    writeLocked(registry, REGISTRY, registry.revision);
    return { id, title, workflow, state: displayPath(path) };
  } finally {
    release(lock);
  }
}
export function makeClaim(clientId: string, task: Task, leaseSeconds = 300) {
  // Allow ":" so the standard "role:id" actor convention (e.g. "executor:codex")
  // is a valid client id. It is not used in filesystem paths.
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(clientId)) throw new EngineError("client ID contains unsupported characters");
  if (leaseSeconds < 15 || leaseSeconds > 3600) throw new EngineError("lease seconds must be between 15 and 3600");
  const claimed = new Date(),
    attempt = task.attempts + 1,
    digest = createHash("sha256")
      .update(`${clientId}:${task.id}:${attempt}:${claimed.toISOString()}`)
      .digest("hex")
      .slice(0, 12);
  return {
    client_id: clientId,
    attempt_id: `${task.id}-${attempt}-${digest}`,
    claimed_at: now(),
    lease_expires_at: stamp(new Date(claimed.getTime() + leaseSeconds * 1000)),
  };
}
