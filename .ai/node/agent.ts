import { artifactPath, writeArtifact } from "./artifacts.js";
import * as board from "./board.js";

// Extension agents use this control-plane surface instead of editing workflow
// state or artifacts directly.
export function claim(workflowId: string, clientId: string, owner?: string) {
  const result: any = board.claimNext(clientId, workflowId, owner);
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
