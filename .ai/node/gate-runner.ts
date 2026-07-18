import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import * as board from "./board.js";
import * as engine from "./engine.js";

export type GateRoles = { qa: boolean; review: boolean; release: boolean };
export const ALL_ROLES: GateRoles = { qa: true, review: true, release: true };
export type GateAction = { task: string; action: string };

const taskById = (workflowId: string, id: string) =>
  engine.taskMap(engine.load<engine.State>(engine.workflowStatePath(workflowId))).get(id);

const testCommand = () => {
  const line = readFileSync(join(engine.ROOT, ".ai", "kit.yaml"), "utf8")
    .split("\n")
    .find((entry) => entry.trim().startsWith("test_command:"));
  return line?.split(":").slice(1).join(":").trim() || undefined;
};

// Independent re-verification: a gate client re-runs the project test command
// instead of trusting the executor's self-reported evidence.
function verify(): boolean {
  if (process.env.AIKIT_SKIP_VERIFY) return true;
  const command = testCommand();
  if (!command) return true;
  return spawnSync(command, { cwd: engine.ROOT, shell: true, encoding: "utf8" }).status === 0;
}

// One pass over a workflow's gates. Acts only on attempts implemented by a
// different client, so a gate client never approves its own work. Re-reads
// pending state between phases so a task can cascade qa -> review -> close.
export function runGateCycle(
  workflowId: string,
  client: string,
  roles: GateRoles = ALL_ROLES,
  reverify = false,
): GateAction[] {
  const acted: GateAction[] = [];
  const byOther = (id: string) => taskById(workflowId, id)?.implementation_client !== client;

  if (roles.qa)
    for (const item of board.pendingReview(workflowId).awaiting_qa)
      if (byOther(item.id) && (!reverify || verify()))
        try {
          board.submitQa(
            workflowId,
            item.id,
            client,
            "pass",
            "verified by gate-runner",
            reverify && testCommand() ? [testCommand()!] : [],
          );
          acted.push({ task: item.id, action: "qa-pass" });
        } catch {}

  if (roles.review)
    for (const item of board.pendingReview(workflowId).awaiting_review)
      if (byOther(item.id))
        try {
          board.submitReview(workflowId, item.id, client, "approve", "auto-approved by gate-runner");
          acted.push({ task: item.id, action: "review-approve" });
        } catch {}

  if (roles.release)
    for (const task of engine.load<engine.State>(engine.workflowStatePath(workflowId)).tasks)
      if (task.status === "review-approved")
        try {
          board.close(workflowId, task.id, client);
          acted.push({ task: task.id, action: "close" });
        } catch {}

  return acted;
}

// Repeat until no gate advances, so a batch of ready tasks fully drains.
export function drainGates(
  workflowId: string,
  client: string,
  roles: GateRoles = ALL_ROLES,
  reverify = false,
): GateAction[] {
  const acted: GateAction[] = [];
  for (let pass = 0; pass < 50; pass++) {
    const step = runGateCycle(workflowId, client, roles, reverify);
    if (!step.length) break;
    acted.push(...step);
  }
  return acted;
}

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const option = (key: string, fallback?: string) => {
    const index = argv.indexOf(key);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  const workflowId = argv.find((item) => !item.startsWith("--"));
  const client = option("--client-id", process.env.AIKIT_GATE_CLIENT ?? "gatekeeper")!;
  const chosen = (option("--roles", "qa,review,release") ?? "").split(",");
  const roles: GateRoles = {
    qa: chosen.includes("qa"),
    review: chosen.includes("review"),
    release: chosen.includes("release"),
  };
  const reverify = argv.includes("--verify") || !!process.env.AIKIT_GATE_VERIFY;
  const interval = Number(option("--interval-ms", "2000"));
  const once = argv.includes("--once");
  if (!workflowId) {
    console.error(
      "usage: gate-runner <workflow-id> [--client-id X] [--roles qa,review,release] [--interval-ms N] [--once] [--verify]",
    );
    process.exitCode = 2;
  } else {
    for (;;) {
      for (const entry of drainGates(workflowId, client, roles, reverify)) console.log(JSON.stringify(entry));
      if (once) break;
      await sleep(interval);
    }
  }
}
