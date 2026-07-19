import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PluginRole, type PluginRole as Role } from "./artifacts.js";
import { PROJECT_ROOT, ROOT } from "./engine.js";
import { resolvePluginPath } from "./home.js";
import { assertCommandAllowed } from "./security.js";

const DIR = join(ROOT, ".ai", "plugins");
export class PluginError extends Error {}
// A provider capability declaration: which roles it can fill, feature tags, and
// whether it needs authentication. Purely descriptive metadata.
export type PluginCapabilities = { roles?: string[]; features?: string[]; auth?: boolean };

export type Plugin = {
  version: 1;
  id: string;
  role: Role;
  transport: "cli";
  // The standardized Provider interface. `command` is the invoke operation;
  // init/validate/capabilities are optional and let a provider self-describe.
  command: string[]; // invoke
  init?: string[]; // one-time prepare / auth
  validate?: string[]; // readiness check (exit 0 = ready)
  capabilities?: PluginCapabilities;
  description?: string;
  // Provider-adapter tuning (optional, backward compatible).
  timeout_ms?: number;
  retries?: number;
};

const validId = (value: string) => /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
const validCount = (value: unknown, min: number, max: number) =>
  value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max);
const validCommand = (value: unknown, required = false) =>
  value === undefined
    ? !required
    : Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string");
const validStrings = (value: unknown) =>
  value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"));
const validCapabilities = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null) return false;
  const capabilities = value as PluginCapabilities;
  return (
    validStrings(capabilities.roles) &&
    validStrings(capabilities.features) &&
    (capabilities.auth === undefined || typeof capabilities.auth === "boolean")
  );
};
export function loadPlugin(role: Role, id: string): Plugin {
  if (!PluginRole.safeParse(role).success || !validId(id)) throw new PluginError("invalid plugin role or ID");
  // Project plugins take precedence over the shared global home.
  const path = resolvePluginPath(PROJECT_ROOT, role, id) ?? join(DIR, role, `${id}.json`);
  let plugin: Plugin;
  try {
    plugin = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new PluginError(`plugin not found: ${role}/${id}`);
  }
  if (
    plugin.version !== 1 ||
    plugin.id !== id ||
    plugin.role !== role ||
    plugin.transport !== "cli" ||
    !validCommand(plugin.command, true) ||
    !validCommand(plugin.init) ||
    !validCommand(plugin.validate) ||
    !validCapabilities(plugin.capabilities) ||
    !validCount(plugin.timeout_ms, 1000, 3_600_000) ||
    !validCount(plugin.retries, 0, 5)
  )
    throw new PluginError(`invalid plugin manifest: ${path}`);
  assertCommandAllowed(plugin.command);
  return plugin;
}

export const pluginCommand = (plugin: Plugin, input: string, output: string, prompt: string) =>
  plugin.command.map((item) =>
    item
      .replaceAll("{input}", input)
      .replaceAll("{output}", output)
      .replaceAll("{prompt}", prompt)
      .replaceAll("{runtime}", ROOT),
  );

export const listPlugins = (role?: Role) => {
  const roles = role ? [role] : PluginRole.options;
  return roles.flatMap((item) => {
    const directories = [join(PROJECT_ROOT, ".ai", "plugins", item), join(DIR, item)];
    const ids = new Set<string>();
    for (const directory of directories) {
      try {
        for (const entry of readdirSync(directory)) if (entry.endsWith(".json")) ids.add(entry.slice(0, -5));
      } catch {}
    }
    return [...ids].sort().map((id) => loadPlugin(item, id));
  });
};
