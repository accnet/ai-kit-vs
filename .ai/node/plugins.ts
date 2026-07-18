import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PluginRole, type PluginRole as Role } from "./artifacts.js";
import { ROOT } from "./engine.js";

const DIR = join(ROOT, ".ai", "plugins");
export class PluginError extends Error {}
export type Plugin = {
  version: 1;
  id: string;
  role: Role;
  transport: "cli";
  command: string[];
  description?: string;
};

const validId = (value: string) => /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
export function loadPlugin(role: Role, id: string): Plugin {
  if (!PluginRole.safeParse(role).success || !validId(id)) throw new PluginError("invalid plugin role or ID");
  const path = join(DIR, role, `${id}.json`);
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
    !Array.isArray(plugin.command) ||
    !plugin.command.length ||
    !plugin.command.every((item) => typeof item === "string")
  )
    throw new PluginError(`invalid plugin manifest: ${path}`);
  return plugin;
}

export const pluginCommand = (plugin: Plugin, input: string, output: string, prompt: string) =>
  plugin.command.map((item) =>
    item.replaceAll("{input}", input).replaceAll("{output}", output).replaceAll("{prompt}", prompt),
  );

export const listPlugins = (role?: Role) => {
  const roles = role ? [role] : PluginRole.options;
  return roles.flatMap((item) => {
    const directory = join(DIR, item);
    try {
      return readdirSync(directory)
        .filter((entry) => entry.endsWith(".json"))
        .sort()
        .map((entry) => loadPlugin(item, entry.slice(0, -5)));
    } catch {
      return [];
    }
  });
};
