// Provider — the standardized interface every model/agent implements, so adding
// Cursor, Gemini, Qwen, ... is just a manifest and never touches the Runtime:
//
//   init      one-time prepare / auth        (optional command)
//   invoke    do the role's work             (the adapter; required)
//   validate  is the provider ready?         (optional command, exit 0 = ready)
//   capability what roles/features it offers  (declared metadata)
//
// invoke lives in provider-adapter.ts; this module implements the other three
// on top of the plugin manifest and re-exports invoke for one surface.

import { spawnSync } from "node:child_process";
import { PROJECT_ROOT } from "./engine.js";
import { type PluginRole } from "./artifacts.js";
import { loadPlugin } from "./plugins.js";
import { assertCommandAllowed } from "./security.js";
import { invokeProvider } from "./provider-adapter.js";

export { invokeProvider };

export type Capability = { roles: string[]; features: string[]; auth: boolean };
export type Readiness = { ready: boolean | null; detail: string };

// What the provider declares it can do (defaults to the role it is filed under).
export function providerCapability(role: PluginRole, id: string): Capability {
  const plugin = loadPlugin(role, id);
  return {
    roles: plugin.capabilities?.roles ?? [role],
    features: plugin.capabilities?.features ?? [],
    auth: plugin.capabilities?.auth ?? false,
  };
}

const runStep = (command: string[]) => {
  assertCommandAllowed(command);
  const run = spawnSync(command[0], command.slice(1), { cwd: PROJECT_ROOT, encoding: "utf8" });
  const detail = (run.error?.message ?? run.stderr ?? run.stdout ?? "").toString().trim().slice(0, 200);
  return { ok: !run.error && run.status === 0, detail };
};

// Run the readiness check. ready === null means the provider declares none, so
// readiness is only known at invoke time.
export function providerValidate(role: PluginRole, id: string): Readiness {
  const plugin = loadPlugin(role, id);
  if (!plugin.validate?.length) return { ready: null, detail: "no validate command; readiness checked at invoke" };
  const { ok, detail } = runStep(plugin.validate);
  return { ready: ok, detail: detail || (ok ? "ready" : "not ready") };
}

// Run the optional one-time init/prepare command.
export function providerInit(role: PluginRole, id: string): { ran: boolean; detail: string } {
  const plugin = loadPlugin(role, id);
  if (!plugin.init?.length) return { ran: false, detail: "no init command" };
  const { ok, detail } = runStep(plugin.init);
  return { ran: true, detail: ok ? detail || "ok" : detail || "init failed" };
}
