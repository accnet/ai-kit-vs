import { closeSync, existsSync, mkdirSync, openSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  PROJECT_ROOT,
  ROOT,
  WORK,
  EngineError,
  displayPath,
  load,
  loadRegistry,
  now,
  roleNames,
  saveJson,
} from "./engine.js";
import { PluginRole } from "./artifacts.js";
import { loadPlugin } from "./plugins.js";
import { configuredPluginId } from "./models.js";

const directory = () => {
  const path = join(WORK, "run", "workers");
  mkdirSync(path, { recursive: true });
  return path;
};
const file = (id: string) => {
  if (!/^worker-[a-z0-9-]+$/.test(id)) throw new Error("invalid worker ID");
  return join(directory(), `${id}.json`);
};
const event = (record: any, action: string, detail = "") => record.events.push({ ts: now(), action, detail });
const save = (path: string, record: any) => saveJson(record, path, record.revision);
function alive(pid?: number) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === "EPERM";
  }
}
function refresh(path: string, record: any) {
  if (["running", "stopping"].includes(record.status) && !alive(record.pid)) {
    record.status = record.stop_requested_at ? "stopped" : "exited";
    record.stopped_at = now();
    record.current_task = null;
    event(record, record.status, "process is no longer running");
    save(path, record);
  }
  return record;
}
export const workerStatus = (id: string) => {
  const path = file(id);
  return refresh(path, load<any>(path));
};
export const listWorkers = (workflowId?: string) =>
  readdirSync(directory())
    .filter((x) => x.endsWith(".json"))
    .map((name) => {
      const path = join(directory(), name);
      return refresh(path, load<any>(path));
    })
    .filter((x) => !workflowId || x.workflow_id === workflowId);
export function startWorker(pluginId: string, workflowId: string, owner?: string, role: PluginRole = "executor") {
  if (
    !loadRegistry().workflows.some((item: any) => item.id === workflowId) &&
    !existsSync(join(WORK, "workflows", workflowId, "state", "workflow.json"))
  )
    throw new EngineError(`unknown workflow: ${workflowId}`);
  loadPlugin(role, pluginId);
  if (owner && !roleNames().has(owner)) throw new Error(`unknown owner role: ${owner}`);
  const id = `worker-${pluginId}-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    path = file(id),
    log = join(directory(), `${id}.log`);
  const record: any = {
    version: 1,
    revision: 0,
    id,
    plugin: pluginId,
    role,
    workflow_id: workflowId,
    owner: owner ?? null,
    pid: null,
    status: "starting",
    current_task: null,
    log: displayPath(log),
    started_at: now(),
    stop_requested_at: null,
    stopped_at: null,
    events: [],
  };
  event(record, "starting");
  saveJson(record, path, 0);
  const fd = openSync(log, "a");
  const args = [
    join(ROOT, ".ai", "node", "node_modules", "tsx", "dist", "cli.mjs"),
    join(ROOT, ".ai", "node", "run-plugin.ts"),
    role,
    pluginId,
    "--workflow-id",
    workflowId,
    "--worker-id",
    id,
    "--client-id",
    id,
    ...(owner ? ["--owner", owner] : []),
  ];
  let child;
  try {
    child = spawn(process.execPath, args, { cwd: PROJECT_ROOT, detached: true, stdio: ["ignore", fd, fd] });
  } catch (error) {
    closeSync(fd);
    record.status = "failed";
    record.stopped_at = now();
    event(record, "failed", String(error));
    save(path, record);
    throw new Error(`failed to start ${pluginId} worker: ${error}`);
  }
  closeSync(fd);
  child.unref();
  const current = load<any>(path);
  current.pid = child.pid;
  current.status = current.stop_requested_at ? "stopping" : "running";
  event(current, "started");
  save(path, current);
  child.once("error", (error) => {
    try {
      const latest = load<any>(path);
      latest.status = "failed";
      latest.stopped_at = now();
      latest.current_task = null;
      event(latest, "failed", String(error));
      save(path, latest);
    } catch {}
  });
  return current;
}
export function stopWorker(id: string) {
  const path = file(id),
    record = load<any>(path);
  if (["stopped", "exited", "failed"].includes(record.status)) return record;
  if (!record.stop_requested_at) {
    record.stop_requested_at = now();
    record.status = "stopping";
    event(record, "stop-requested");
    save(path, record);
    if (record.pid && alive(record.pid)) {
      try {
        // Workers are detached into their own process group, so terminate the
        // provider child together with the run-plugin parent on POSIX.
        if (process.platform !== "win32") process.kill(-record.pid, "SIGTERM");
        else process.kill(record.pid, "SIGTERM");
      } catch {
        try {
          process.kill(record.pid, "SIGTERM");
        } catch {}
      }
    }
  }
  return record;
}
export const stopRequested = (id: string) => !!workerStatus(id).stop_requested_at;
export function markWorker(id: string, task: string | null, stopped = false) {
  const path = file(id),
    record = load<any>(path);
  record.current_task = task;
  if (stopped) {
    record.status = "stopped";
    record.stopped_at = now();
  }
  event(record, stopped ? "stopped" : task ? "task" : "idle", task ?? "");
  save(path, record);
}

// CLI: `ai-kit:worker <start|stop|list|status>` so the orchestrator (and any UI)
// can manage provider workers without embedding runtime logic.
const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const argv = process.argv.slice(2);
  const sub = argv.shift();
  const opt = (key: string) => {
    const index = argv.indexOf(key);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const positional = argv.find((item) => !item.startsWith("--"));
  try {
    let output: unknown;
    if (sub === "start") {
      const workflowId = opt("--workflow-id");
      if (!workflowId) throw new Error("worker start requires --workflow-id");
      const roleName = opt("--role") ?? "executor";
      if (!PluginRole.safeParse(roleName).success)
        throw new Error("--role must be one of planner, executor, qa, reviewer");
      const role = roleName as PluginRole;
      const plugin = opt("--plugin") ?? configuredPluginId(role);
      output = startWorker(plugin, workflowId, opt("--owner"), role);
    } else if (sub === "stop") {
      if (!positional) throw new Error("usage: worker stop <worker-id>");
      output = stopWorker(positional);
    } else if (sub === "list") {
      output = listWorkers(opt("--workflow-id"));
    } else if (sub === "status") {
      if (!positional) throw new Error("usage: worker status <worker-id>");
      output = workerStatus(positional);
    } else {
      throw new Error(
        "usage: worker <start|stop|list|status> [--workflow-id ID] [--plugin ID] [--role ROLE] [--owner ROLE]",
      );
    }
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(`ERROR: ${(error as Error).message}`);
    process.exitCode = 2;
  }
}
