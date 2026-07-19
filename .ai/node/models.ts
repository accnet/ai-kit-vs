import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type PluginRole as Role } from "./artifacts.js";
import { PROJECT_ROOT, ROOT, WORK } from "./engine.js";
import { loadPlugin } from "./plugins.js";

export class ModelConfigError extends Error {}
export type ModelConfig = Partial<Record<Role | "implementer" | "fallback", string>>;
export const DISABLED_PROVIDER = "off";
const GLOBAL_CONFIG = join(ROOT, ".ai", "models.yaml");
const PROJECT_CONFIGS = [
  join(WORK, "models.yaml"),
  join(PROJECT_ROOT, ".ai-work", "models.yaml"),
  join(PROJECT_ROOT, ".ai", "models.yaml"),
];

function readConfiguredModels(): ModelConfig {
  const global = existsSync(GLOBAL_CONFIG) ? parseModelConfig(readFileSync(GLOBAL_CONFIG, "utf8")) : {};
  const projectPath = PROJECT_CONFIGS.find((path) => existsSync(path));
  const project = projectPath ? parseModelConfig(readFileSync(projectPath, "utf8")) : {};
  return { ...global, ...project };
}

export function parseModelConfig(source: string): ModelConfig {
  const config: ModelConfig = {};
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(planner|executor|implementer|qa|reviewer|fallback):\s*([a-z0-9][a-z0-9-]*)\s*$/);
    if (!match) throw new ModelConfigError(`invalid models.yaml line ${index + 1}`);
    config[match[1] as keyof ModelConfig] = match[2];
  }
  return config;
}

export function configuredPluginId(role: Role, source?: string) {
  const config = source === undefined ? readConfiguredModels() : parseModelConfig(source);
  const id = config[role] ?? (role === "executor" ? config.implementer : undefined);
  if (!id || id === "any-capable-agent") throw new ModelConfigError(`models.yaml must configure a plugin for ${role}`);
  if (id === DISABLED_PROVIDER)
    throw new ModelConfigError(`provider is disabled for ${role}; choose a plugin in models.yaml`);
  loadPlugin(role, id);
  return id;
}

export type ProviderInfo = { role: Role; plugin: string | null; provider: string | null; command: string[] };

// The configured role -> plugin -> provider-binary mapping, for the UI to show
// which model backs each role. Unconfigured or invalid roles report nulls.
export function listProviders(source?: string): ProviderInfo[] {
  const config = source === undefined ? readConfiguredModels() : parseModelConfig(source);
  const roles: Role[] = ["planner", "executor", "qa", "reviewer"];
  return roles.map((role) => {
    const id = config[role] ?? (role === "executor" ? config.implementer : undefined);
    if (!id || id === "any-capable-agent") return { role, plugin: null, provider: null, command: [] };
    if (id === DISABLED_PROVIDER) return { role, plugin: DISABLED_PROVIDER, provider: null, command: [] };
    try {
      const plugin = loadPlugin(role, id);
      return { role, plugin: id, provider: plugin.command[0] ?? null, command: plugin.command };
    } catch {
      return { role, plugin: id, provider: null, command: [] };
    }
  });
}
