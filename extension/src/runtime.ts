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
