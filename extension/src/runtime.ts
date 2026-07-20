import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const CLI_TARGET = {
  "ai-kit": "ai-kit.ts",
  "ai-kit:worker": "worker-manager.ts",
  "ai-kit:gate": "gate-runner.ts",
} as const;

export type RuntimeCli = keyof typeof CLI_TARGET;
export type RuntimeSelection = { root: string; tsx: string; target: string; global: boolean };

function expandHome(value: string): string {
  return value.replace(/^~(?=$|[\\/])/, homedir());
}

// Named so a second worker gets its own terminal instead of reusing one that
// is already tailing a different worker's log.
export function terminalNameFor(workerId: string): string {
  return `AI-Kit: ${workerId}`;
}

// `tail -f` on the worker's log file, so a terminal running this command shows
// the provider (Codex, Claude, ...) working in real time. Double-quoted with
// JSON.stringify so a path containing spaces still parses as one argument;
// worker log paths are runtime-generated, never adversarial input.
export function tailLogCommand(logPath: string): string {
  return `tail -f ${JSON.stringify(logPath)}`;
}

// The worker JSON printed by `ai-kit:worker start` (see worker-manager.ts)
// always includes a `log` field. Returns undefined for anything else so a
// malformed or unexpected response degrades to "no terminal", not a crash.
export function workerLogPath(startOutput: unknown): string | undefined {
  if (typeof startOutput !== "object" || startOutput === null) return undefined;
  const log = (startOutput as { log?: unknown }).log;
  return typeof log === "string" && log.length > 0 ? log : undefined;
}

export function resolveRuntime(
  cwd: string,
  cli: string,
  options: { home?: string; envHome?: string } = {},
): RuntimeSelection {
  const target = CLI_TARGET[cli as RuntimeCli] ?? CLI_TARGET["ai-kit"];
  const localRoot = join(cwd, ".ai");
  const localTsx = join(localRoot, "node", "node_modules", "tsx", "dist", "cli.mjs");
  const localTarget = join(localRoot, "node", target);
  if (existsSync(localTsx) && existsSync(localTarget))
    return { root: localRoot, tsx: localTsx, target: localTarget, global: false };

  const home = resolve(expandHome(options.home || options.envHome || join(homedir(), "ai-kit")));
  return {
    root: home,
    tsx: join(home, ".ai", "node", "node_modules", "tsx", "dist", "cli.mjs"),
    target: join(home, ".ai", "node", target),
    global: true,
  };
}
