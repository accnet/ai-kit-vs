// Context Engine — ranks the sources the router selected for a task and applies
// a token budget, so an agent is handed the smallest, highest-value context that
// fits. Ranking is deterministic (contract > role > plan > core skill > domain
// skill > task file); the budget is a rough char/4 token estimate.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveProjectPath } from "./engine.js";
import { kitScalar } from "./config.js";

// A very rough token estimate: ~4 bytes per token.
export const estimateTokens = (bytes: number): number => Math.ceil(bytes / 4);

export function defaultBudget(): number {
  const env = process.env.AIKIT_CONTEXT_BUDGET;
  if (env && Number.isFinite(Number(env))) return Number(env);
  const cfg = kitScalar("context_token_budget");
  if (cfg && Number.isFinite(Number(cfg))) return Number(cfg);
  return 120_000;
}

// Lower number = higher priority.
function priority(path: string): number {
  const p = path.replaceAll("\\", "/");
  if (p.endsWith("state-schema.md")) return 0;
  if (p.includes("/agents/")) return 1;
  if (p.endsWith("/plan.md") || p.endsWith("/tasks.md")) return 2;
  if (p.includes("/skills/core/")) return 3;
  if (p.includes("/skills/")) return 4;
  return 5;
}

// Byte size of a source; a directory (role contract) sums its markdown files.
function bytesOf(absolute: string): number {
  try {
    const stat = statSync(absolute);
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    for (const entry of readdirSync(absolute)) if (entry.endsWith(".md")) total += statSync(join(absolute, entry)).size;
    return total;
  } catch {
    return 0;
  }
}

export type AssembledContext = {
  budget_tokens: number;
  total_tokens: number;
  included: { path: string; tokens: number }[];
  skipped: { path: string; tokens: number }[];
};

// Rank the given sources and include them in priority order until the budget is
// exhausted. The single highest-priority source is always included.
export function assembleContext(sources: string[], budget = defaultBudget()): AssembledContext {
  const ranked = [...new Set(sources.filter(Boolean))]
    .map((path) => {
      const absolute = resolveProjectPath(path);
      return { path, tokens: existsSync(absolute) ? estimateTokens(bytesOf(absolute)) : 0, rank: priority(path) };
    })
    .sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));

  const included: { path: string; tokens: number }[] = [];
  const skipped: { path: string; tokens: number }[] = [];
  let used = 0;
  for (const source of ranked) {
    if (included.length === 0 || used + source.tokens <= budget) {
      included.push({ path: source.path, tokens: source.tokens });
      used += source.tokens;
    } else {
      skipped.push({ path: source.path, tokens: source.tokens });
    }
  }
  return { budget_tokens: budget, total_tokens: used, included, skipped };
}
