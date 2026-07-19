// Shared reader for `.ai/kit.yaml`. Several call sites used to hand-parse this
// file (the test command was read by hand in two places, the stack array in a
// third). They now share these helpers. ROOT is only touched inside functions
// so this module stays safe to import from the engine.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
  const lines = source.split(/\r?\n/);
  const inline = lines.find((line) => new RegExp(`^\\s*${key}:\\s*\\[([^\\]]*)\\]`).test(line));
  if (inline) {
    const match = inline.match(new RegExp(`^\\s*${key}:\\s*\\[([^\\]]*)\\]`));
    return new Set(
      (match?.[1] ?? "")
        .split(",")
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean),
    );
  }

  const keyLine = lines.find((line) => new RegExp(`^(\\s*)${key}:\\s*$`).test(line));
  if (!keyLine) return new Set();
  const keyIndent = keyLine.match(/^(\s*)/)?.[1].length ?? 0;
  const values = new Set<string>();
  const start = lines.indexOf(keyLine) + 1;
  for (let index = start; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent <= keyIndent) break;
    const item = line.match(/^\s*-\s+(.+?)\s*(?:#.*)?$/);
    if (item) values.add(item[1].trim().replace(/^['"]|['"]$/g, ""));
  }
  return values;
}

export type MicroTaskPolicy = Readonly<{
  enabled: boolean;
  maxFiles: number;
  requireQa: boolean;
  requireReview: boolean;
}>;

function nestedScalar(path: string[], source: string): string | undefined {
  const lines = source.split(/\r?\n/);
  let start = 0;
  let parentIndent = -1;
  for (const segment of path) {
    let found: { index: number; indent: number; value: string } | undefined;
    for (let index = start; index < lines.length; index++) {
      const line = lines[index];
      if (!line.trim()) continue;
      const match = /^(\s*)([^:#]+):\s*(.*?)\s*(?:#.*)?$/.exec(line);
      if (!match) continue;
      const indent = match[1].length;
      if (parentIndent >= 0 && indent <= parentIndent) break;
      if (match[2].trim() === segment) {
        found = { index, indent, value: match[3].trim() };
        break;
      }
    }
    if (!found) return undefined;
    start = found.index + 1;
    parentIndent = found.indent;
    if (segment === path.at(-1)) return found.value || undefined;
  }
  return undefined;
}

const VERIFICATION_KEYS = ["test_command", "typecheck_command", "build_command", "lint_command"] as const;
export type VerificationKey = (typeof VERIFICATION_KEYS)[number];
export type VerificationCheck = { name: VerificationKey; command: string };

export function projectConfigPath() {
  return [
    join(WORK, "project.yaml"),
    join(PROJECT_ROOT, ".ai-work", "project.yaml"),
    join(PROJECT_ROOT, ".ai", "kit.yaml"),
  ].find((path) => existsSync(path));
}

export function verificationCommands(source?: string): VerificationCheck[] {
  const projectPath = projectConfigPath();
  const configuredSource =
    source ?? (projectPath ? readFileSync(projectPath, "utf8") : PROJECT_ROOT === ROOT ? readKit() : undefined);
  const checks = VERIFICATION_KEYS.flatMap((name) => {
    const command = configuredSource ? nestedScalar(["verification", name], configuredSource) : undefined;
    return command ? [{ name, command }] : [];
  });

  // A project with a package test script gets a useful default, but a global
  // kit config must never impose its commands on an unrelated project.
  if (!checks.some((item) => item.name === "test_command")) {
    const packageJson = join(PROJECT_ROOT, "package.json");
    if (existsSync(packageJson)) {
      try {
        const parsed = JSON.parse(readFileSync(packageJson, "utf8")) as { scripts?: Record<string, unknown> };
        if (typeof parsed.scripts?.test === "string" && parsed.scripts.test.trim())
          checks.unshift({ name: "test_command", command: "npm test" });
      } catch {}
    }
  }
  return checks;
}

export function verificationCwd(source?: string) {
  if (source !== undefined) return ".";
  const projectPath = projectConfigPath();
  const configured = projectPath ? nestedScalar(["verification", "cwd"], readFileSync(projectPath, "utf8")) : undefined;
  return resolve(PROJECT_ROOT, configured ?? ".");
}

const booleanValue = (value: string | undefined, fallback: boolean) =>
  value === "true" ? true : value === "false" ? false : fallback;

export function microTaskPolicy(source = readKit()): MicroTaskPolicy {
  const maxFiles = Number(nestedScalar(["workflow", "micro_tasks", "max_files"], source) ?? "2");
  return {
    enabled: booleanValue(nestedScalar(["workflow", "micro_tasks", "enabled"], source), false),
    maxFiles: Number.isSafeInteger(maxFiles) && maxFiles > 0 ? maxFiles : 2,
    requireQa: booleanValue(nestedScalar(["workflow", "micro_tasks", "require_qa"], source), true),
    requireReview: booleanValue(nestedScalar(["workflow", "micro_tasks", "require_review"], source), false),
  };
}

// A global kit config must not impose its test command on an unrelated
// project. Projects opt in through their own `.ai/kit.yaml`, or through an
// npm package that declares a test script.
export const testCommand = (source?: string): string | undefined => {
  if (source !== undefined) return kitScalar("test_command", source);
  return verificationCommands().find((item) => item.name === "test_command")?.command;
};
