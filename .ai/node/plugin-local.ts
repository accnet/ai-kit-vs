import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT } from "./engine.js";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: plugin-local <assignment.json> <qa.json>");
const assignment = JSON.parse(readFileSync(input, "utf8"));
const testCommand = readFileSync(join(ROOT, ".ai", "kit.yaml"), "utf8")
  .split("\n")
  .find((line) => line.trim().startsWith("test_command:"))
  ?.split(":")
  .slice(1)
  .join(":")
  .trim();
const run = testCommand ? spawnSync(testCommand, { cwd: ROOT, shell: true, encoding: "utf8" }) : undefined;
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
      commands: testCommand ? [testCommand] : [],
    },
    null,
    2,
  )}\n`,
);
