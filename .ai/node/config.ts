// Shared reader for `.ai/kit.yaml`. Several call sites used to hand-parse this
// file (the test command was read by hand in two places, the stack array in a
// third). They now share these helpers. ROOT is only touched inside functions
// so this module stays safe to import from the engine.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT, ROOT, WORK } from "./engine.js";

export const kitPath = () => {
  const project = [
    join(WORK, "project.yaml"),
    join(PROJECT_ROOT, ".ai-work", "project.yaml"),
    join(PROJECT_ROOT, ".ai", "kit.yaml"),
  ].find((path) => existsSync(path));
  return project ?? join(ROOT, ".ai", "kit.yaml");
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

// A global kit config must not impose its test command on an unrelated
// project. Projects opt in through their own `.ai/kit.yaml`, or through an
// npm package that declares a test script.
export const testCommand = (source?: string): string | undefined => {
  if (source !== undefined) return kitScalar("test_command", source);

  const projectKit = [
    join(WORK, "project.yaml"),
    join(PROJECT_ROOT, ".ai-work", "project.yaml"),
    join(PROJECT_ROOT, ".ai", "kit.yaml"),
  ].find((path) => existsSync(path));
  if (projectKit) return kitScalar("test_command", readFileSync(projectKit, "utf8"));

  const packageJson = join(PROJECT_ROOT, "package.json");
  if (!existsSync(packageJson)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(packageJson, "utf8")) as { scripts?: Record<string, unknown> };
    if (typeof parsed.scripts?.test !== "string" || !parsed.scripts.test.trim()) return undefined;
  } catch {
    return undefined;
  }

  return kitScalar("test_command") ?? "npm test";
};
