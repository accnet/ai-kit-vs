// Security policy — an allowlist of executables a plugin/provider may launch.
// Every provider is an opaque CLI, so the one hard boundary the runtime enforces
// is *which binary* is allowed to run. Enforcement lives at plugin load time
// (the single choke point through which all provider execution passes), so the
// provider adapter can stay a pure executor of already-validated commands.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./engine.js";

export class SecurityError extends Error {}

export type SecurityPolicy = { allowedCommands: Set<string>; allowAny: boolean };

const CONFIG = join(ROOT, ".ai", "security.yaml");
export const DEFAULT_ALLOWED = [
  "node",
  "npx",
  "claude",
  "codex",
  "cursor-agent",
  "gpt",
  "qwen",
  "qwen-code",
  "gemini",
  "python",
  "python3",
];

// Minimal YAML reader for the two keys we care about. Supports a block list
// (`allowed_commands:` followed by `- item` lines) and an inline array
// (`allowed_commands: [a, b]`), plus `allow_any: true|false`. Comments allowed.
export function parseSecurityPolicy(source: string): SecurityPolicy {
  const allowed = new Set<string>();
  let allowAny = false;
  let inList = false;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "");
    if (!line.trim()) continue;
    const flag = line.match(/^\s*allow_any:\s*(true|false)\s*$/);
    if (flag) {
      allowAny = flag[1] === "true";
      inList = false;
      continue;
    }
    const inline = line.match(/^\s*allowed_commands:\s*\[([^\]]*)\]\s*$/);
    if (inline) {
      for (const item of inline[1]
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean))
        allowed.add(item);
      inList = false;
      continue;
    }
    if (/^\s*allowed_commands:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    const item = line.match(/^\s*-\s*(\S+)\s*$/);
    if (inList && item) {
      allowed.add(item[1]);
      continue;
    }
    // Any other unindented key ends the list block.
    if (/^\S/.test(line)) inList = false;
  }
  return { allowedCommands: allowed, allowAny };
}

export function loadSecurityPolicy(): SecurityPolicy {
  if (!existsSync(CONFIG)) return { allowedCommands: new Set(DEFAULT_ALLOWED), allowAny: false };
  const policy = parseSecurityPolicy(readFileSync(CONFIG, "utf8"));
  // An empty, enforcing policy would block everything; fall back to defaults.
  if (!policy.allowedCommands.size && !policy.allowAny)
    return { allowedCommands: new Set(DEFAULT_ALLOWED), allowAny: false };
  return policy;
}

// Match ignoring directory (both POSIX and Windows separators) and the Windows
// executable extension, so a manifest is judged the same on any host.
export const commandName = (command: string) =>
  (command.split(/[\\/]/).pop() ?? command).replace(/\.(exe|cmd|bat)$/i, "");

export function assertCommandAllowed(command: string[], policy: SecurityPolicy = loadSecurityPolicy()): void {
  const bin = command[0];
  if (!bin) throw new SecurityError("plugin command is empty");
  if (policy.allowAny) return;
  const name = commandName(bin);
  if (policy.allowedCommands.has(name) || policy.allowedCommands.has(bin)) return;
  throw new SecurityError(
    `command not permitted by .ai/security.yaml: ${bin} — add "${name}" to allowed_commands or set allow_any: true`,
  );
}
