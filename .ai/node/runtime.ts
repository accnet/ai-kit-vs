// Runtime — the single composition root. Instead of reaching into engine, board,
// plugins, models, artifacts, ... individually, callers use one center whose
// layered managers mirror the architecture:
//
//   Runtime
//   ├── workflow   (Workflow Engine)   — state machine, DAG, claims, gates
//   ├── providers  (Provider Manager)  — role→plugin→binary + normalized adapter
//   ├── plugins    (Plugin Manager)    — manifest load/resolve + security allowlist
//   ├── artifacts  (Artifact Manager)  — schemas + context assembly
//   ├── memory     (Memory Engine)     — durable decisions/conventions/postmortems
//   └── capabilities                   — Agents + Skills bundles
//
// This is a facade over the existing modules (same functions, no fork), so direct
// imports keep working while new code can depend on one entry point.

import * as board from "./board.js";
import * as engine from "./engine.js";
import * as artifacts from "./artifacts.js";
import * as context from "./context.js";
import { buildBundle } from "./context-builder.js";
import * as plugins from "./plugins.js";
import * as home from "./home.js";
import * as security from "./security.js";
import * as models from "./models.js";
import * as memory from "./memory.js";
import * as capabilities from "./capabilities.js";
import { invokeProvider, providerCapability, providerInit, providerValidate } from "./provider.js";

// Workflow Engine: the deterministic control plane and its orchestration API.
export const workflowEngine = {
  load: engine.load,
  save: engine.save,
  validate: engine.validate,
  transition: engine.transition,
  addTask: engine.addTask,
  createWorkflow: engine.createWorkflow,
  runnable: engine.runnable,
  syncPhases: engine.syncPhases,
  taskMap: engine.taskMap,
  route: engine.routeTask,
  statePath: engine.workflowStatePath,
  board,
};

// Provider Manager: which model backs each role, and the standardized interface
// (init / invoke / validate / capability) every provider implements.
export const providerManager = {
  list: models.listProviders,
  configuredId: models.configuredPluginId,
  init: providerInit,
  invoke: invokeProvider,
  validate: providerValidate,
  capability: providerCapability,
};

// Plugin Manager: manifest resolution (project → global home) and the launch allowlist.
export const pluginManager = {
  load: plugins.loadPlugin,
  list: plugins.listPlugins,
  command: plugins.pluginCommand,
  resolvePath: home.resolvePluginPath,
  assertAllowed: security.assertCommandAllowed,
  policy: security.loadSecurityPolicy,
};

// Artifact Manager: every .ai-work artifact goes through these schemas, plus the
// Context Engine's ranked, token-budgeted assembly.
export const artifactManager = {
  read: artifacts.readArtifact,
  write: artifacts.writeArtifact,
  parse: artifacts.parseArtifact,
  parseContextManifest: artifacts.parseContextManifest,
  path: artifacts.artifactPath,
  assembleContext: context.assembleContext,
  contextBudget: context.defaultBudget,
};

// Context Builder: the independent stage assembling a Context Bundle from
// Workspace/Git/Architecture/Requirement/Memory, used by Planner and Executor.
export const contextBuilder = {
  build: buildBundle,
  assemble: context.assembleContext,
  budget: context.defaultBudget,
};

export const runtime = {
  workflow: workflowEngine,
  providers: providerManager,
  plugins: pluginManager,
  artifacts: artifactManager,
  context: contextBuilder,
  memory,
  capabilities,
};

export type Runtime = typeof runtime;
