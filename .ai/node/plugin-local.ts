import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { verificationCommands, verificationCwd } from "./config.js";
import { assertCommandAllowed, parseCommand } from "./security.js";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: plugin-local <assignment.json> <qa.json>");
const assignment = JSON.parse(readFileSync(input, "utf8"));
const checks = verificationCommands();
const cwd = verificationCwd();
const commands = checks.map((check) => check.command);
let passed = checks.length > 0 && existsSync(cwd);
let summary = passed
  ? `verified by local QA: ${commands.join("; ")} in ${cwd}`
  : "local QA failed: no verification commands or cwd configured";
for (const check of checks) {
  try {
    const command = parseCommand(check.command);
    assertCommandAllowed(command);
    if (spawnSync(command[0], command.slice(1), { cwd, encoding: "utf8" }).status !== 0) {
      passed = false;
      summary = `local QA failed: ${check.name} (${check.command}) in ${cwd}`;
      break;
    }
  } catch (error) {
    passed = false;
    summary = `local QA rejected: ${check.name}: ${(error as Error).message}`;
    break;
  }
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `${JSON.stringify(
    {
      version: 1,
      kind: "qa",
      workflow_id: assignment.workflow_id,
      actor: assignment.actor,
      task: assignment.task,
      status: passed ? "pass" : "fail",
      summary,
      commands,
    },
    null,
    2,
  )}\n`,
);
