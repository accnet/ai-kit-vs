import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as board from "./board.js";
import { artifactPath, readArtifact, writeArtifact, type ArtifactKind, type PluginRole } from "./artifacts.js";
import { configuredPluginId } from "./models.js";
import { loadPlugin } from "./plugins.js";
import { invokeProvider } from "./provider-adapter.js";
import { markWorker, stopRequested } from "./worker-manager.js";
import * as engine from "./engine.js";

// Reads one context-manifest source (a file, or a role-contract directory of
// .md files, same convention as context.ts's byte-size estimate) as text.
function readSource(relativePath: string): string | undefined {
  const absolute = engine.resolveProjectPath(relativePath);
  try {
    if (!statSync(absolute).isDirectory()) return readFileSync(absolute, "utf8");
    return readdirSync(absolute)
      .filter((entry) => entry.endsWith(".md"))
      .sort()
      .map((entry) => `## ${entry}\n${readFileSync(join(absolute, entry), "utf8")}`)
      .join("\n\n");
  } catch {
    return undefined;
  }
}

// Inline the manifest's already-selected sources directly into the prompt, so
// the provider does not have to spend a separate tool call re-reading each one
// (role contract, skills, plan/tasks/roadmap) that ai-kit already picked.
function inlinedContext(manifestPath: string | undefined): string {
  if (!manifestPath || !existsSync(manifestPath)) return "";
  let manifest: { context?: { included?: { path: string }[] }; completion?: { reminder?: string } };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return "";
  }
  const included = manifest.context?.included ?? [];
  const sections = included
    .map(({ path }) => {
      const text = readSource(path);
      return text ? `--- ${path} ---\n${text.trim()}` : undefined;
    })
    .filter((section): section is string => !!section);
  const reminder = manifest.completion?.reminder;
  if (!sections.length && !reminder) return "";
  return [
    "",
    ...(sections.length
      ? [
          "The following context sources are already loaded below — do not spend a tool call re-reading them:",
          ...sections,
        ]
      : []),
    reminder ? `AI-KIT COMPLETION REMINDER: ${reminder}` : undefined,
  ]
    .filter((section): section is string => !!section)
    .join("\n\n");
}

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
const watch = argv.includes("--watch") || argv.includes("--daemon");
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
      title: engine.load<engine.State>(engine.workflowStatePath(workflow)).title,
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

export function prompt(role: PluginRole, input: string, output: string, contextManifestPath?: string) {
  const artifactContract =
    role === "planner"
      ? `The plan JSON must use exactly these fields: version, kind="plan", workflow_id, actor, goal, and tasks. Each task must use id, title, owner, phase, needs, acceptance, files, and tags. Task owner must be one of these agent roles: ${[...engine.roleNames()].join(", ")}. Never use generic owner names such as executor or implementer.`
      : role === "executor"
        ? 'The result JSON must use exactly these fields: version, kind="result", workflow_id, actor, task, attempt_id, status, summary, changed_paths, commands, and optional nullable branch (a string or null). status must be exactly "pass" or "fail". Do not use completed, files_changed, acceptance, or other alternative field names.'
        : role === "reviewer"
          ? 'The review JSON must use exactly these fields: version, kind="review", workflow_id, actor, task, verdict, notes. verdict must be exactly "approve" or "changes-requested". Do not use status, summary, findings, or evidence field names.'
          : role === "qa"
            ? 'The QA JSON must use exactly these fields: version, kind="qa", workflow_id, actor, task, status, summary, commands. status must be exactly "pass" or "fail".'
            : undefined;
  const context = inlinedContext(contextManifestPath);
  return [
    `You are the ${role} plugin for AI-Kit.`,
    `Read the JSON assignment at ${input}.`,
    context
      ? "The assignment's context_manifest sources (role contract, skills, plan, roadmap, and the current task with direct dependency state) are inlined below — do not re-read them; only use file tools for the project source files you need to inspect or change."
      : "When the assignment input has a context_manifest, read that JSON and load only the sources listed under its `context.included` — a ranked, token-budgeted selection. You do not need the other sources.",
    `Perform only the assigned role work.`,
    "For QA or review, inspect the assignment acceptance criteria, changed files, and evidence paths before deciding.",
    `Write exactly one valid ${artifactForRole[role]} JSON artifact to ${output}.`,
    ...(artifactContract ? [artifactContract] : []),
    ...(role === "executor"
      ? [
          "For a retry (attempt > 1), do not report pass unless at least one declared task file was actually changed; the control plane verifies this against the worktree.",
        ]
      : []),
    "Make the final response exactly the same JSON object, with no markdown fences or commentary.",
    "The provider wrapper writes the final response to the output artifact path. Do not use file tools to create or edit that artifact path; use file tools only for assigned project files.",
    "Do not modify workflow state or communicate with other agents.",
    context,
  ]
    .filter(Boolean)
    .join("\n");
}

const configuredLease = Number(process.env.AIKIT_LEASE_SECONDS ?? "900");
const LEASE_SECONDS =
  Number.isInteger(configuredLease) && configuredLease >= 15 && configuredLease <= 3600 ? configuredLease : 900;
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
    prompt: prompt(role, input, output, claimed.context_manifest),
    onHeartbeat,
    heartbeatMs: onHeartbeat ? HEARTBEAT_MS : undefined,
    // Worker log files (and a terminal tailing one) should show the provider
    // working live, not just the outcome once it finishes.
    stream: true,
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
    if (once || (!watch && (role === "planner" || result.claimed === null || result.status === "failed"))) break;
    await wait(result.claimed === null ? 1000 : 250);
  }
  if (workerId) markWorker(workerId, null, true);
}
