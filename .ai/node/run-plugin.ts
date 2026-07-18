import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as board from "./board.js";
import { artifactPath, readArtifact, writeArtifact, type ArtifactKind, type PluginRole } from "./artifacts.js";
import { ROOT } from "./engine.js";
import { configuredPluginId } from "./models.js";
import { loadPlugin, pluginCommand } from "./plugins.js";
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
const windowsScript = (command: string) => {
  if (process.platform !== "win32") return false;
  if ([".cmd", ".bat"].includes(extname(command).toLowerCase())) return true;
  if (extname(command)) return false;
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return paths.some((path) => [".cmd", ".bat"].some((extension) => existsSync(join(path, `${command}${extension}`))));
};

function taskFor(role: PluginRole, workflow: string, actor: string) {
  if (role === "planner") return { claimed: "plan", title: "Create workflow plan", owner: "planner" };
  if (role === "executor") return board.claimNext(actor, workflow, owner);
  const pending = board.pendingReview(workflow);
  const item = role === "qa" ? pending.awaiting_qa[0] : role === "reviewer" ? pending.awaiting_review[0] : undefined;
  return item
    ? { claimed: item.id, title: item.title, owner: item.owner }
    : { claimed: null, reason: "no pending work" };
}

function prompt(role: PluginRole, input: string, output: string) {
  return [
    `You are the ${role} plugin for AI-Kit.`,
    `Read the JSON assignment at ${input}.`,
    "When the assignment input has a context_manifest, read that JSON and every existing source it lists before working.",
    `Perform only the assigned role work.`,
    "For QA or review, inspect the assignment acceptance criteria, changed files, and evidence paths before deciding.",
    `Write exactly one valid ${artifactForRole[role]} JSON artifact to ${output}.`,
    "Do not modify workflow state or communicate with other agents.",
  ].join("\n");
}

export function runOnce(role: PluginRole, id: string, workflow: string, actor = `${role}:${id}`) {
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
  const command = pluginCommand(plugin, input, output, prompt(role, input, output));
  const run = spawnSync(command[0], command.slice(1), {
    cwd: ROOT,
    encoding: "utf8",
    shell: windowsScript(command[0]),
  });
  if (run.error || run.status !== 0) {
    const detail =
      run.error?.message ?? (run.stderr.trim() || run.stdout.trim() || `exit status ${run.status ?? "unknown"}`);
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
    const result = runOnce(role, selectedPlugin, workflowId, clientId ?? `${role}:${selectedPlugin}`);
    if (workerId) markWorker(workerId, result.task ?? null);
    if (once || role === "planner" || result.claimed === null || result.status === "failed") break;
    await wait(250);
  }
  if (workerId) markWorker(workerId, null, true);
}
