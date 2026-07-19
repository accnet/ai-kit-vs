import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, join } from "node:path";
import * as engine from "./engine.js";
import {
  artifactPath,
  displayArtifactPath,
  managedArtifactPath,
  parseContextManifest,
  readArtifact,
  writeArtifact,
  type QaOutput,
  type PlanOutput,
  type ReviewOutput,
  type ResultOutput,
} from "./artifacts.js";
import { createWorktree, branch, mergeWorktree } from "./worktree.js";
import { listCapabilities } from "./capabilities.js";
import { buildBundle } from "./context-builder.js";

const pathFor = (workflowId?: string, state?: string) =>
  state ?? (workflowId ? engine.workflowStatePath(workflowId) : engine.STATE);
const rootFor = (workflowId?: string, state?: string) => engine.workspace(pathFor(workflowId, state));
const taskAt = (taskId: string, workflowId?: string, state?: string) => {
  const path = pathFor(workflowId, state),
    value = engine.load<engine.State>(path);
  engine.validate(value);
  const task = engine.taskMap(value).get(taskId);
  if (!task) throw new engine.EngineError(`unknown task: ${taskId}`);
  return { path, value, task };
};
const expired = (task: engine.Task) => !!task.claim && Date.parse(task.claim.lease_expires_at) <= Date.now();
const owns = (task: engine.Task, clientId: string, attemptId: string) =>
  !expired(task) && task.claim?.client_id === clientId && task.claim?.attempt_id === attemptId;
const DEFAULT_LEASE_SECONDS = 900;

function configuredLeaseSeconds() {
  const value = Number(process.env.AIKIT_LEASE_SECONDS ?? DEFAULT_LEASE_SECONDS);
  return Number.isInteger(value) && value >= 15 && value <= 3600 ? value : DEFAULT_LEASE_SECONDS;
}

function hashSource(path: string): string | null {
  if (!existsSync(path)) return null;
  const hash = createHash("sha256");
  const stat = statSync(path);
  if (!stat.isDirectory()) return hash.update(readFileSync(path)).digest("hex");
  const walk = (directory: string, relative = "") => {
    for (const entry of readdirSync(directory).sort()) {
      if (entry === ".git" || entry === "node_modules" || entry === "dist") continue;
      const absolute = join(directory, entry);
      const childRelative = relative ? join(relative, entry) : entry;
      const child = statSync(absolute);
      if (child.isDirectory()) walk(absolute, childRelative);
      else hash.update(`${childRelative}\0`).update(readFileSync(absolute));
    }
  };
  walk(path);
  return hash.digest("hex");
}

function recover(path: string) {
  const state = engine.load<engine.State>(path);
  const items = state.tasks.filter((task) => task.status === "in-progress" && expired(task));
  if (!items.length) return;
  for (const task of items) {
    task.status = "todo";
    task.claim = null;
    task.blocked_reason = null;
    engine.event(state, path, "claim-expired", task, "state-manager", "in-progress", "todo", "claim lease expired");
  }
  engine.syncPhases(state);
  engine.save(state, path, state.revision);
}
function requireClaim(task: engine.Task, clientId: string, attemptId: string) {
  if (!owns(task, clientId, attemptId))
    throw new engine.EngineError(`client ${clientId} does not own active attempt ${attemptId} for ${task.id}`);
}
function manifest(task: engine.Task, attemptId: string, workflowId?: string, state?: string) {
  const route = engine.routeTask(task, pathFor(workflowId, state)),
    sources = [...route.context, ...route.skills].map((item) => {
      const path = engine.resolveProjectPath(item);
      return {
        path: item,
        sha256: hashSource(path),
      };
    });
  const git = spawnSync("git", ["status", "--short"], { cwd: engine.PROJECT_ROOT, encoding: "utf8" });
  // Context Builder: gather the multi-source bundle (Workspace/Git/Architecture/
  // Requirement/Memory) — the same for Planner and Executor — and its ranked,
  // token-budgeted selection.
  const {
    context,
    workspace,
    git: bundleGit,
    architecture,
    requirement,
    memory,
  } = buildBundle(task, pathFor(workflowId, state));
  const payload = {
    version: 1,
    task: task.id,
    attempt_id: attemptId,
    route,
    sources,
    context,
    bundle: { workspace, git: bundleGit, architecture, requirement, memory },
    git_status: git.status === 0 ? git.stdout.split(/\r?\n/).filter(Boolean) : [],
    generated_at: engine.now(),
  };
  const output = join(rootFor(workflowId, state), "context", `${task.id}-${attemptId}.json`);
  mkdirSync(join(rootFor(workflowId, state), "context"), { recursive: true });
  // Validate against the standard schema before persisting.
  writeFileSync(output, `${JSON.stringify(parseContextManifest(payload), null, 2)}\n`);
  return output;
}

export const listWorkflows = () => engine.loadRegistry().workflows;
export const createWorkflow = (title: string, workflow = "feature", workflowId?: string, actor = "planner") =>
  engine.createWorkflow(
    workflowId ??
      (title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") ||
        "workflow"),
    title,
    workflow,
    actor,
  );
export const addTask = (input: any) =>
  engine.addTask(pathFor(input.workflow_id, input.state), { ...input, expectedRevision: input.expected_revision });
export function applyPlanArtifact(workflowId: string, actor: string, output: string) {
  if (!managedArtifactPath(workflowId, output))
    throw new engine.EngineError("plan artifact must be inside the workflow workspace");
  const plan = readArtifact(output, "plan") as PlanOutput;
  if (plan.workflow_id !== workflowId || plan.actor !== actor)
    throw new engine.EngineError("plan artifact does not match workflow or actor");
  engine.addTasks(
    pathFor(workflowId),
    plan.tasks.map((task) => ({ ...task, actor })),
  );
  return { workflow_id: workflowId, tasks: plan.tasks.map((task) => task.id), artifact: displayArtifactPath(output) };
}
export function ready(workflowId?: string, state?: string) {
  const path = pathFor(workflowId, state);
  recover(path);
  const value = engine.load<engine.State>(path),
    tasks = engine.taskMap(value);
  return value.tasks
    .filter((task) => engine.runnable(task, tasks))
    .map((task) => ({ id: task.id, title: task.title, owner: task.owner, phase: task.phase }));
}
export function status(workflowId?: string, state?: string) {
  const value = engine.load<engine.State>(pathFor(workflowId, state));
  engine.validate(value);
  engine.syncPhases(value);
  const counts: Record<string, number> = {};
  for (const task of value.tasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
  return { title: value.title, revision: value.revision, counts, phases: value.phases };
}
export const timeline = (workflowId?: string, state?: string) =>
  engine.load<engine.State>(pathFor(workflowId, state)).events;
export function events(workflowId: string, afterCursor = 0) {
  const found = timeline(workflowId).filter((item) => (item.seq ?? 0) > afterCursor);
  return { workflow_id: workflowId, events: found, cursor: found.at(-1)?.seq ?? afterCursor };
}
export async function waitForEvents(workflowId: string, afterCursor = 0, waitMs = 0) {
  if (afterCursor < 0 || waitMs < 0 || waitMs > 30000)
    throw new engine.EngineError("after_cursor must be non-negative and wait_ms must be 0..30000");
  const deadline = Date.now() + waitMs;
  for (;;) {
    const found = events(workflowId, afterCursor);
    if (found.events.length || Date.now() >= deadline) return found;
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())));
  }
}
// Build a context manifest for the planner, which has no claimed task yet. It
// routes a synthetic "planner" task so the planner receives the same ranked,
// token-budgeted context (role contract, planner skills, plan docs, state schema)
// as any other role — matching the "Context Builder -> Planner" step.
export function planContext(workflowId: string, actor: string) {
  const plannerTask = { id: "plan", owner: "planner", tags: [], files: [] } as unknown as engine.Task;
  const attempt = `plan-${actor.replaceAll(/[^a-z0-9-]/gi, "-")}`;
  return manifest(plannerTask, attempt, workflowId);
}
export function route(workflowId: string, taskId: string) {
  const { path, task } = taskAt(taskId, workflowId);
  const routed = engine.routeTask(task, path);
  // Surface capability bundles whose role contract covers this task's owner, so a
  // consumer can load the packaged Agents + Skills without changing skill routing.
  const capabilities = listCapabilities()
    .filter((capability) => capability.agents.includes(task.owner))
    .map((capability) => capability.id);
  return { ...routed, capabilities };
}
export function claimNext(
  clientId: string,
  workflowId: string,
  owner?: string,
  leaseSeconds = configuredLeaseSeconds(),
) {
  const path = pathFor(workflowId);
  recover(path);
  for (let retry = 0; retry < 6; retry++) {
    const value = engine.load<engine.State>(path),
      tasks = engine.taskMap(value);
    const task = value.tasks.find((item) => engine.runnable(item, tasks) && (!owner || item.owner === owner));
    if (!task) return { claimed: null, reason: "no runnable task" };
    const claim = engine.makeClaim(clientId, task, leaseSeconds);
    try {
      engine.transition(path, task.id, "start", clientId, "", [], value.revision, claim);
      const context_manifest = manifest(task, claim.attempt_id, workflowId);
      return {
        claimed: task.id,
        title: task.title,
        owner: task.owner,
        phase: task.phase,
        acceptance: task.acceptance,
        files: task.files,
        route: route(workflowId, task.id),
        claim,
        context_manifest,
        client_id: clientId,
      };
    } catch (error) {
      if (!(error as Error).message.includes("concurrently")) throw error;
    }
  }
  return { claimed: null, reason: "contention" };
}
export function getContext(workflowId: string, taskId: string, clientId: string, attemptId: string) {
  const { task } = taskAt(taskId, workflowId);
  requireClaim(task, clientId, attemptId);
  const path = join(rootFor(workflowId), "context", `${taskId}-${attemptId}.json`);
  if (!existsSync(path)) throw new engine.EngineError(`context manifest not found for ${taskId}`);
  return JSON.parse(readFileSync(path, "utf8"));
}
export function heartbeat(
  workflowId: string,
  taskId: string,
  clientId: string,
  attemptId: string,
  leaseSeconds = configuredLeaseSeconds(),
) {
  const { path, value, task } = taskAt(taskId, workflowId);
  requireClaim(task, clientId, attemptId);
  // requireClaim guarantees an owned, unexpired claim exists.
  task.claim!.lease_expires_at = engine.stamp(new Date(Date.now() + leaseSeconds * 1000));
  engine.event(value, path, "heartbeat", task, clientId, "in-progress", "in-progress", "claim renewed");
  engine.save(value, path, value.revision);
  return task.claim;
}
export function submitResult(
  workflowId: string,
  taskId: string,
  clientId: string,
  attemptId: string,
  summary: string,
  result = "pass",
  changed_paths: string[] = [],
  commands: string[] = [],
  branch?: string,
) {
  const { task } = taskAt(taskId, workflowId);
  requireClaim(task, clientId, attemptId);
  const output = artifactPath(workflowId, "result", `${taskId}-${attemptId}`);
  writeArtifact(output, "result", {
    version: 1,
    kind: "result",
    workflow_id: workflowId,
    actor: clientId,
    task: taskId,
    status: result === "pass" ? "pass" : "fail",
    summary,
    changed_paths,
    commands,
    branch,
    attempt_id: attemptId,
  });
  return submitResultArtifact(workflowId, taskId, clientId, attemptId, output);
}
export function submitResultArtifact(
  workflowId: string,
  taskId: string,
  clientId: string,
  attemptId: string,
  output: string,
) {
  const { path, task } = taskAt(taskId, workflowId);
  requireClaim(task, clientId, attemptId);
  if (!managedArtifactPath(workflowId, output))
    throw new engine.EngineError("result artifact must be inside the workflow workspace");
  const result = readArtifact(output, "result") as ResultOutput;
  if (
    result.workflow_id !== workflowId ||
    result.task !== taskId ||
    result.attempt_id !== attemptId ||
    result.actor !== clientId
  )
    throw new engine.EngineError("result artifact does not match the active attempt");
  const evidence = displayArtifactPath(output);
  if (result.status !== "pass") {
    engine.transition(path, taskId, "block", clientId, `executor reported failure: ${result.summary}`);
    return { task: taskId, status: "blocked", evidence };
  }
  engine.transition(path, taskId, "complete", clientId, result.summary);
  return { task: taskId, status: "implementation-complete", evidence };
}
export function reportBlocked(workflowId: string, taskId: string, clientId: string, attemptId: string, reason: string) {
  const { path, task } = taskAt(taskId, workflowId);
  requireClaim(task, clientId, attemptId);
  return engine.transition(path, taskId, "block", clientId, reason);
}
export function submitQaArtifact(workflowId: string, taskId: string, actor: string, output: string) {
  const { path, task } = taskAt(taskId, workflowId);
  if (task.implementation_client === actor)
    throw new engine.EngineError("the implementation client may not QA its own attempt");
  if (!managedArtifactPath(workflowId, output))
    throw new engine.EngineError("QA artifact must be inside the workflow workspace");
  const qa = readArtifact(output, "qa") as QaOutput;
  if (qa.workflow_id !== workflowId || qa.task !== taskId || qa.actor !== actor)
    throw new engine.EngineError("QA artifact does not match the task or actor");
  const evidence = displayArtifactPath(output);
  if (qa.status !== "pass")
    return engine.transition(path, taskId, "block", actor, `QA failed: ${qa.summary}`, [evidence]);
  return engine.transition(path, taskId, "qa-pass", actor, qa.summary, [evidence]);
}
export function submitQa(
  workflowId: string,
  taskId: string,
  actor: string,
  status: "pass" | "fail",
  summary: string,
  commands: string[] = [],
) {
  const output = artifactPath(workflowId, "qa", `${taskId}-${actor}`);
  writeArtifact(output, "qa", {
    version: 1,
    kind: "qa",
    workflow_id: workflowId,
    actor,
    task: taskId,
    status,
    summary,
    commands,
  });
  return submitQaArtifact(workflowId, taskId, actor, output);
}
export function submitReviewArtifact(workflowId: string, taskId: string, actor: string, output: string) {
  const { path, task } = taskAt(taskId, workflowId);
  if (task.implementation_client === actor)
    throw new engine.EngineError("the implementation client may not review its own attempt");
  if (!managedArtifactPath(workflowId, output))
    throw new engine.EngineError("review artifact must be inside the workflow workspace");
  const review = readArtifact(output, "review") as ReviewOutput;
  if (review.workflow_id !== workflowId || review.task !== taskId || review.actor !== actor)
    throw new engine.EngineError("review artifact does not match the task or actor");
  const evidence = displayArtifactPath(output);
  if (review.verdict === "changes-requested")
    return engine.replaceWithRemediation(path, taskId, actor, review.notes || "changes requested", [evidence]);
  return engine.transition(path, taskId, "review-approve", actor, review.notes, [evidence]);
}
export function submitReview(
  workflowId: string,
  taskId: string,
  actor: string,
  verdict: "approve" | "changes-requested",
  notes = "",
) {
  const output = artifactPath(workflowId, "review", `${taskId}-${actor}`);
  writeArtifact(output, "review", {
    version: 1,
    kind: "review",
    workflow_id: workflowId,
    actor,
    task: taskId,
    verdict,
    notes,
  });
  return submitReviewArtifact(workflowId, taskId, actor, output);
}
export const close = (workflowId: string, taskId: string, actor: string) =>
  engine.transition(pathFor(workflowId), taskId, "close", actor);
export function pendingReview(workflowId: string) {
  const value = engine.load<engine.State>(pathFor(workflowId));
  const result = { awaiting_qa: [] as any[], awaiting_review: [] as any[], blocked: [] as any[] };
  for (const task of value.tasks) {
    const item: any = {
      id: task.id,
      title: task.title,
      owner: task.owner,
      phase: task.phase,
      acceptance: task.acceptance,
      files: task.files,
      evidence: task.evidence,
      implementation_client: task.implementation_client ?? null,
      implementation_attempt: task.implementation_attempt ?? null,
    };
    if (task.status === "implementation-complete") result.awaiting_qa.push(item);
    else if (task.status === "qa-passed") result.awaiting_review.push(item);
    else if (task.status === "blocked") {
      item.reason = task.blocked_reason;
      result.blocked.push(item);
    }
  }
  return result;
}
export function prepareWorktree(workflowId: string, taskId: string, base = "HEAD") {
  taskAt(taskId, workflowId);
  return createWorktree(`${workflowId}/${taskId}`, engine.PROJECT_ROOT, base);
}
export function mergeTask(workflowId: string, taskId: string, target = "main") {
  const { task } = taskAt(taskId, workflowId);
  if (task.status !== "done") return { merged: false, reason: `task is ${task.status}, must be done before merge` };
  return mergeWorktree(
    `${workflowId}/${taskId}`,
    engine.PROJECT_ROOT,
    task.needs.map((dependency: string) => branch(`${workflowId}/${dependency}`)),
    target,
  );
}
