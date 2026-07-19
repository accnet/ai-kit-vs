// Shared reader for `.ai/kit.yaml`. Several call sites used to hand-parse this
// file (the test command was read by hand in two places, the stack array in a
// third). They now share these helpers. ROOT is only touched inside functions
// so this module stays safe to import from the engine.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT, ROOT } from "./engine.js";

export const kitPath = () => {
  const project = join(PROJECT_ROOT, ".ai", "kit.yaml");
  return existsSync(project) ? project : join(ROOT, ".ai", "kit.yaml");
};

export function readKit(): string {
  const path = kitPath();
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

// The trimmed value of a `key: value` line (first match), or undefined.
export function kitScalar(key: string, source = readKit()): string | undefined {
  const line = source.split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}:`));
  const value = line?.slice(line.indexOf(":") + 1).trim();
  return value || undefined;
}

// The items of an inline array line `key: [a, b, c]`, or an empty set.
export function kitArray(key: string, source = readKit()): Set<string> {
  const match = source.match(new RegExp(`^\\s*${key}:\\s*\\[([^\\]]*)\\]`, "m"));
  return new Set(
    match
      ? match[1]
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  );
}

export const testCommand = (source = readKit()): string | undefined => kitScalar("test_command", source);
