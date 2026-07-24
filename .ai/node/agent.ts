import { existsSync } from "node:fs";
import { artifactPath, writeArtifact } from "./artifacts.js";
import * as board from "./board.js";
import { EngineError, loadRegistry, workflowStatePath } from "./engine.js";

// Extension agents use this control-plane surface instead of editing workflow
// state or artifacts directly.
export function claim(workflowId: string, clientId: string, owner?: string, leaseSeconds?: number) {
  const result: any = board.claimNext(clientId, workflowId, owner, leaseSeconds);
  return withAssignment(workflowId, clientId, result);
}

function withAssignment(workflowId: string, clientId: string, result: any) {
  if (!result.claimed) return result;
  const assignment = artifactPath(workflowId, "assignment", `agent-${result.claimed}-${result.claim.attempt_id}`);
  writeArtifact(assignment, "assignment", {
    version: 1,
    kind: "assignment",
    workflow_id: workflowId,
    actor: clientId,
    role: "executor",
    task: result.claimed,
    attempt_id: result.claim.attempt_id,
    input: result,
  });
  return { ...result, assignment };
}

export function claimTask(workflowId: string, clientId: string, taskId: string, leaseSeconds?: number) {
  return withAssignment(workflowId, clientId, board.claimTask(clientId, workflowId, taskId, leaseSeconds));
}

export type CopilotFinishOptions = {
  workflowId?: string;
  clientId?: string;
  summary?: string;
  status?: "pass" | "fail";
  changedPaths?: string[];
  commands?: string[];
  branch?: string;
};

export function finish(options: CopilotFinishOptions = {}) {
  const clientId = options.clientId ?? "copilot-extension";
  const workflowIds = options.workflowId
    ? [options.workflowId]
    : [...new Set(["default", ...loadRegistry().workflows.map((item: { id: string }) => item.id)])];
  const claims: { workflowId: string; taskId: string; attemptId: string }[] = [];
  for (const workflowId of workflowIds) {
    const state = workflowStatePath(workflowId);
    if (!existsSync(state)) {
      if (options.workflowId) throw new EngineError(`state not found: ${state}`);
      continue;
    }
    for (const claim of board.activeClaims(workflowId, clientId))
      claims.push({ workflowId, taskId: claim.task_id, attemptId: claim.attempt_id });
  }
  if (!claims.length) throw new EngineError(`no active task claim found for client ${clientId}`);
  if (claims.length > 1)
    throw new EngineError(`multiple active task claims found for client ${clientId}; use --workflow-id to select one`);
  const claim = claims[0];
  const result = submitResult(
    claim.workflowId,
    claim.taskId,
    clientId,
    claim.attemptId,
    options.summary ?? "Copilot completed the claimed implementation task.",
    options.status ?? "pass",
    options.changedPaths,
    options.commands,
    options.branch,
  );
  return { ...result, workflow_id: claim.workflowId, attempt_id: claim.attemptId, client_id: clientId };
}

export const context = (workflowId: string, taskId: string, clientId: string, attemptId: string) =>
  board.getContext(workflowId, taskId, clientId, attemptId);

export const heartbeat = (workflowId: string, taskId: string, clientId: string, attemptId: string) =>
  board.heartbeat(workflowId, taskId, clientId, attemptId);

export const submitResult = (
  workflowId: string,
  taskId: string,
  clientId: string,
  attemptId: string,
  summary: string,
  status: "pass" | "fail",
  changedPaths: string[] = [],
  commands: string[] = [],
  branch?: string,
) => board.submitResult(workflowId, taskId, clientId, attemptId, summary, status, changedPaths, commands, branch);

export const submitQa = (
  workflowId: string,
  taskId: string,
  clientId: string,
  status: "pass" | "fail",
  summary: string,
  commands: string[] = [],
) => board.submitQa(workflowId, taskId, clientId, status, summary, commands);

export const submitReview = (
  workflowId: string,
  taskId: string,
  clientId: string,
  verdict: "approve" | "changes-requested",
  notes = "",
) => board.submitReview(workflowId, taskId, clientId, verdict, notes);
