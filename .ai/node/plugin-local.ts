import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PROJECT_ROOT } from "./engine.js";
import { testCommand } from "./config.js";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: plugin-local <assignment.json> <qa.json>");
const assignment = JSON.parse(readFileSync(input, "utf8"));
const command = testCommand();
const run = command ? spawnSync(command, { cwd: PROJECT_ROOT, shell: true, encoding: "utf8" }) : undefined;
const passed = !run || run.status === 0;
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
      summary: passed ? "configured verification passed" : "configured verification failed",
      commands: command ? [command] : [],
    },
    null,
    2,
  )}\n`,
);
