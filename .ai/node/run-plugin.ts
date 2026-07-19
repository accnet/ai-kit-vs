import { fileURLToPath } from "node:url";
import * as board from "./board.js";
import { artifactPath, readArtifact, writeArtifact, type ArtifactKind, type PluginRole } from "./artifacts.js";
import { configuredPluginId } from "./models.js";
import { loadPlugin } from "./plugins.js";
import { invokeProvider } from "./provider-adapter.js";
import { markWorker, stopRequested } from "./worker-manager.js";

const argv = process.argv.slice(2);
const role = argv.shift() as PluginRole;
const pluginId = argv[0]?.startsWith("--") ? undefined : argv.shift();
const option = (key: string) => {
  const index = argv.indexOf(key);
  return index >= 0 ? argv[index + 1] : undefined;
};
const workflowId = option("--workflow-id");
const owner = option("--owner");
const workerId = option("--worker-id");
const clientId = option("--client-id");
const once = argv.includes("--once");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const artifactForRole: Record<PluginRole, ArtifactKind> = {
  planner: "plan",
  executor: "result",
  qa: "qa",
  reviewer: "review",
};

function taskFor(role: PluginRole, workflow: string, actor: string) {
  if (role === "planner")
    return {
      claimed: "plan",
      title: "Create workflow plan",
      owner: "planner",
      context_manifest: board.planContext(workflow, actor),
    };
  if (role === "executor") return board.claimNext(actor, workflow, owner);
  const pending = board.pendingReview(workflow);
  const item = role === "qa" ? pending.awaiting_qa[0] : role === "reviewer" ? pending.awaiting_review[0] : undefined;
  return item
    ? {
        claimed: item.id,
        title: item.title,
        owner: item.owner,
        acceptance: item.acceptance,
        files: item.files,
        evidence: item.evidence,
        implementation_client: item.implementation_client,
        implementation_attempt: item.implementation_attempt,
      }
    : { claimed: null, reason: "no pending work" };
}

function prompt(role: PluginRole, input: string, output: string) {
  return [
    `You are the ${role} plugin for AI-Kit.`,
    `Read the JSON assignment at ${input}.`,
    "When the assignment input has a context_manifest, read that JSON and load only the sources listed under its `context.included` — a ranked, token-budgeted selection. You do not need the other sources.",
    `Perform only the assigned role work.`,
    "For QA or review, inspect the assignment acceptance criteria, changed files, and evidence paths before deciding.",
    `Write exactly one valid ${artifactForRole[role]} JSON artifact to ${output}.`,
    "Make the final response exactly the same JSON object, with no markdown fences or commentary.",
    "Do not modify workflow state or communicate with other agents.",
  ].join("\n");
}

const LEASE_SECONDS = 300;
const HEARTBEAT_MS = (LEASE_SECONDS * 1000) / 3; // renew well before the lease expires

export async function runOnce(role: PluginRole, id: string, workflow: string, actor = `${role}:${id}`) {
  const plugin = loadPlugin(role, id);
  const claimed: any = taskFor(role, workflow, actor);
  if (!claimed.claimed) return claimed;
  const task = claimed.claimed as string;
  const attempt = claimed.claim?.attempt_id;
  const input = artifactPath(workflow, "assignment", `${role}-${task}${attempt ? `-${attempt}` : ""}`);
  const output = artifactPath(workflow, artifactForRole[role], `${task}-${actor.replaceAll(/[^a-z0-9-]/gi, "-")}`);
  writeArtifact(input, "assignment", {
    version: 1,
    kind: "assignment",
    workflow_id: workflow,
    actor,
    role,
    task,
    attempt_id: attempt,
    input: claimed,
  });
  // Renew the claim lease while a long executor run is in flight.
  const onHeartbeat =
    role === "executor" && attempt
      ? () => {
          try {
            board.heartbeat(workflow, task, actor, attempt, LEASE_SECONDS);
          } catch {
            /* a failed heartbeat must not abort the provider run */
          }
        }
      : undefined;
  const run = await invokeProvider(plugin, {
    input,
    output,
    prompt: prompt(role, input, output),
    onHeartbeat,
    heartbeatMs: onHeartbeat ? HEARTBEAT_MS : undefined,
  });
  if (!run.ok) {
    const detail = `${run.outcome} after ${run.attempts} attempt(s): ${run.error ?? "unknown"}`;
    if (role === "executor" && attempt)
      board.reportBlocked(workflow, task, actor, attempt, `${id} plugin failed: ${detail}`);
    throw new Error(`${id} plugin failed: ${detail}`);
  }
  try {
    readArtifact(output, artifactForRole[role]);
  } catch (error) {
    if (role === "executor" && attempt)
      board.reportBlocked(
        workflow,
        task,
        actor,
        attempt,
        `${id} produced an invalid artifact: ${(error as Error).message}`,
      );
    throw error;
  }
  if (role === "executor") return board.submitResultArtifact(workflow, task, actor, attempt, output);
  if (role === "qa") return board.submitQaArtifact(workflow, task, actor, output);
  if (role === "reviewer") return board.submitReviewArtifact(workflow, task, actor, output);
  return board.applyPlanArtifact(workflow, actor, output);
}

const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (!workflowId || !["planner", "executor", "qa", "reviewer"].includes(role))
    throw new Error(
      "usage: run-plugin <planner|executor|qa|reviewer> [plugin-id] --workflow-id ID [--owner ROLE] [--once]",
    );
  const selectedPlugin = pluginId ?? configuredPluginId(role);
  for (;;) {
    if (workerId && stopRequested(workerId)) break;
    const result = await runOnce(role, selectedPlugin, workflowId, clientId ?? `${role}:${selectedPlugin}`);
    if (workerId) markWorker(workerId, result.task ?? null);
    if (once || role === "planner" || result.claimed === null || result.status === "failed") break;
    await wait(250);
  }
  if (workerId) markWorker(workerId, null, true);
}
