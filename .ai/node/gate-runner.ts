import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import * as board from "./board.js";
import * as engine from "./engine.js";
import {
  closeAfterQaPolicy,
  microTaskPolicy,
  verificationCommands,
  verificationCwd,
  type VerificationCheck,
} from "./config.js";
import { configuredProviderId } from "./models.js";
import { assertCommandAllowed, parseCommand } from "./security.js";

export type GateRoles = { qa: boolean; release: boolean };
export const ALL_ROLES: GateRoles = { qa: true, release: true };
export type GateAction = { task: string; action: string };

const taskById = (workflowId: string, id: string) =>
  engine.taskMap(engine.load<engine.State>(engine.workflowStatePath(workflowId))).get(id);

export type VerificationResult = {
  passed: boolean;
  commands: string[];
  summary: string;
  failure_code?: "needs-migration" | "environment-unavailable" | "verification-failed" | "command-rejected";
  checks: {
    name: string;
    command: string;
    passed: boolean;
    failure_code?: string;
    exit_code: number | null;
  }[];
};

function failureCode(check: VerificationCheck, rejected = false) {
  if (rejected) return "command-rejected" as const;
  if (/(migration|schema|database)/i.test(check.name)) return "needs-migration" as const;
  if (/(live|smoke|health|preflight|environment)/i.test(check.name)) return "environment-unavailable" as const;
  return "verification-failed" as const;
}

export function verifyTask(
  task: Pick<engine.Task, "phase">,
  checks = verificationCommands(),
  cwd = verificationCwd(),
): VerificationResult {
  if (!checks.length && task.phase === "plan")
    return { passed: true, commands: [], checks: [], summary: "planning task: project verification not required" };
  return verify(checks, cwd);
}

// Independent re-verification: a gate client re-runs every declared project
// check instead of trusting the executor's self-reported evidence.
export function verify(checks = verificationCommands(), cwd = verificationCwd()): VerificationResult {
  if (process.env.AIKIT_SKIP_VERIFY)
    return { passed: true, commands: [], checks: [], summary: "verification skipped by AIKIT_SKIP_VERIFY" };

  if (!checks.length)
    return {
      passed: false,
      commands: [],
      checks: [],
      failure_code: "verification-failed",
      summary: "verification failed: no verification commands are configured",
    };

  if (!existsSync(cwd))
    return {
      passed: false,
      commands: [],
      checks: [],
      failure_code: "environment-unavailable",
      summary: `verification failed: configured cwd does not exist: ${cwd}`,
    };

  const commands: string[] = [];
  const results: VerificationResult["checks"] = [];
  for (const check of checks) {
    commands.push(check.command);
    let command: string[];
    try {
      command = parseCommand(check.command);
      assertCommandAllowed(command);
    } catch (error) {
      return {
        passed: false,
        commands,
        checks: [
          ...results,
          {
            name: check.name,
            command: check.command,
            passed: false,
            failure_code: failureCode(check, true),
            exit_code: null,
          },
        ],
        failure_code: failureCode(check, true),
        summary: `verification rejected: ${check.name}: ${(error as Error).message}`,
      };
    }
    const result = spawnSync(command[0], command.slice(1), { cwd, encoding: "utf8" });
    if (result.status !== 0)
      return {
        passed: false,
        commands,
        checks: [
          ...results,
          {
            name: check.name,
            command: check.command,
            passed: false,
            failure_code: failureCode(check),
            exit_code: result.status,
          },
        ],
        failure_code: failureCode(check),
        summary: `verification failed: ${check.name} (${check.command}) in ${engine.displayPath(cwd)}`,
      };
    results.push({ name: check.name, command: check.command, passed: true, exit_code: result.status });
  }
  return {
    passed: true,
    commands,
    checks: results,
    summary: `verified by gate-runner: ${commands.join("; ")} in ${engine.displayPath(cwd)}`,
  };
}

// One pass over a workflow's gates. Acts only on attempts implemented by a
// different client, so a gate client never approves its own work. Re-reads
// pending state between phases so a task can cascade qa -> review -> close.
export function runGateCycle(
  workflowId: string,
  client: string,
  roles: GateRoles = ALL_ROLES,
  reverify = true,
): GateAction[] {
  const acted: GateAction[] = [];
  const policy = microTaskPolicy();
  const closeAfterQa = closeAfterQaPolicy();
  if (closeAfterQa) {
    const reviewer = configuredProviderId("reviewer");
    if (reviewer && reviewer !== "off") throw new engine.EngineError("workflow.close_after_qa requires reviewer: off");
  }
  const isMicro = (id: string) => {
    const task = taskById(workflowId, id);
    return policy.enabled && task?.tags.includes("micro");
  };
  const byOther = (id: string) => taskById(workflowId, id)?.implementation_client !== client;

  if (roles.qa)
    for (const item of board.pendingReview(workflowId).awaiting_qa)
      if (byOther(item.id) && (!isMicro(item.id) || policy.requireQa))
        try {
          const verification = reverify
            ? verifyTask(item)
            : ({
                passed: true,
                commands: [],
                checks: [],
                summary: "verification bypassed by caller",
              } satisfies VerificationResult);
          board.submitQa(
            workflowId,
            item.id,
            client,
            verification.passed ? "pass" : "fail",
            verification.summary,
            verification.commands,
            { failure_code: verification.failure_code, checks: verification.checks },
          );
          acted.push({ task: item.id, action: verification.passed ? "qa-pass" : "qa-fail" });
        } catch (error) {
          try {
            board.recordGateError(workflowId, item.id, client, "qa", (error as Error).message);
          } catch {}
          acted.push({ task: item.id, action: "qa-error" });
        }

  // Review must come from the configured reviewer plugin. The gate runner may
  // close an already approved task, but it must never manufacture approval.

  if (roles.release)
    for (const task of engine.load<engine.State>(engine.workflowStatePath(workflowId)).tasks)
      if (
        task.status === "review-approved" ||
        (closeAfterQa && task.status === "qa-passed") ||
        (isMicro(task.id) &&
          ((task.status === "qa-passed" && !policy.requireReview) ||
            (task.status === "implementation-complete" && !policy.requireQa && !policy.requireReview)))
      )
        try {
          if (task.status === "review-approved") board.close(workflowId, task.id, client);
          else if (closeAfterQa && task.status === "qa-passed")
            engine.transition(
              engine.workflowStatePath(workflowId),
              task.id,
              "close-after-qa",
              client,
              "closed after QA; review skipped by project policy",
            );
          else
            engine.transition(
              engine.workflowStatePath(workflowId),
              task.id,
              "micro-close",
              client,
              "closed by micro-task policy",
            );
          acted.push({
            task: task.id,
            action: closeAfterQa && task.status === "qa-passed" ? "close-after-qa" : "close",
          });
        } catch (error) {
          try {
            board.recordGateError(workflowId, task.id, client, "release", (error as Error).message);
          } catch {}
          acted.push({ task: task.id, action: "release-error" });
        }

  return acted;
}

// Repeat until no gate advances, so a batch of ready tasks fully drains.
export function drainGates(
  workflowId: string,
  client: string,
  roles: GateRoles = ALL_ROLES,
  reverify = true,
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
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "usage: gate-runner <workflow-id> [--client-id X] [--roles qa,release] [--interval-ms N] [--once] [--verify] [--skip-verify]",
    );
    process.exit(0);
  }
  const option = (key: string, fallback?: string) => {
    const index = argv.indexOf(key);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  const workflowId = argv.find((item) => !item.startsWith("--"));
  const client = option("--client-id", process.env.AIKIT_GATE_CLIENT ?? "gatekeeper")!;
  const chosen = (option("--roles", "qa,release") ?? "").split(",").filter(Boolean);
  const unsupported = chosen.filter((role) => !["qa", "release"].includes(role));
  const roles: GateRoles = {
    qa: chosen.includes("qa"),
    release: chosen.includes("release"),
  };
  const reverify = !argv.includes("--skip-verify") || argv.includes("--verify") || !!process.env.AIKIT_GATE_VERIFY;
  const interval = Number(option("--interval-ms", "2000"));
  const once = argv.includes("--once");
  if (!workflowId) {
    console.error(
      "usage: gate-runner <workflow-id> [--client-id X] [--roles qa,release] [--interval-ms N] [--once] [--verify] [--skip-verify]",
    );
    process.exitCode = 2;
  } else if (unsupported.length) {
    console.error(
      `unsupported gate role(s): ${unsupported.join(", ")}; review must be submitted through ai-kit agent review`,
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
