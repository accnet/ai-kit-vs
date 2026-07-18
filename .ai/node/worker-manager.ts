import { openSync, closeSync, readdirSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ROOT, WORK, EngineError, displayPath, load, loadRegistry, now, roleNames, saveJson } from "./engine.js";
import { type PluginRole } from "./artifacts.js";
import { loadPlugin } from "./plugins.js";

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
  if (!loadRegistry().workflows.some((item: any) => item.id === workflowId))
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
    child = spawn(process.execPath, args, { cwd: ROOT, detached: true, stdio: ["ignore", fd, fd] });
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
