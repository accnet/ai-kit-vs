// AI-Kit VS Code extension — a thin UI client. It contains NO orchestration
// logic: it runs the AI-Kit runtime from the project or global home and renders
// the result as a tree. Six sections: Workflow, Task Tree, Current Step,
// Providers (plugin + provider), and Logs.

import { spawn } from "node:child_process";
import { join } from "node:path";
import * as vscode from "vscode";
import { resolveRuntime, tailLogCommand, terminalNameFor, workerLogPath, type RuntimeCli } from "./runtime.js";

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Run an AI-Kit CLI in the workspace via Node + tsx and return stdout.
function runCli(cli: RuntimeCli | string, args: string[], cwd: string): Promise<string> {
  const node = vscode.workspace.getConfiguration("aiKit").get<string>("nodePath") ?? "node";
  const configuredHome = vscode.workspace.getConfiguration("aiKit").get<string>("home");
  const runtime = resolveRuntime(cwd, cli, { home: configuredHome, envHome: process.env.AIKIT_HOME });
  return new Promise((resolve, reject) => {
    const child = spawn(node, [runtime.tsx, runtime.target, ...args], {
      cwd,
      env: {
        ...process.env,
        ...(runtime.global ? { AIKIT_HOME: runtime.root, AIKIT_ROOT: runtime.root } : {}),
        AIKIT_PROJECT_ROOT: cwd,
        AIKIT_WORK: join(cwd, ".ai-work"),
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`))));
  });
}

// Run a CLI and parse JSON; returns undefined on any error.
async function json<T>(cli: string, args: string[]): Promise<T | undefined> {
  const cwd = workspaceRoot();
  if (!cwd) return undefined;
  try {
    return JSON.parse(await runCli(cli, args, cwd)) as T;
  } catch {
    return undefined;
  }
}

type Loader = () => Promise<Item[]> | Item[];

class Item extends vscode.TreeItem {
  loader?: Loader;
  constructor(
    label: string,
    opts: { description?: string; icon?: string; expanded?: boolean; leaf?: boolean; loader?: Loader } = {},
  ) {
    super(
      label,
      opts.leaf
        ? vscode.TreeItemCollapsibleState.None
        : opts.expanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
    );
    if (opts.description) this.description = opts.description;
    if (opts.icon) this.iconPath = new vscode.ThemeIcon(opts.icon);
    this.loader = opts.loader;
  }
}

const STATUS_ICON: Record<string, string> = {
  todo: "circle-outline",
  "in-progress": "sync",
  "implementation-complete": "check",
  "qa-passed": "verified",
  "review-approved": "pass",
  done: "pass-filled",
  blocked: "error",
  replaced: "history",
};

function leaf(label: string, description?: string, icon?: string): Item {
  return new Item(label, { description, icon, leaf: true });
}

class AiKitTree implements vscode.TreeDataProvider<Item> {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  refresh(): void {
    this.changed.fire();
  }
  getTreeItem(item: Item): vscode.TreeItem {
    return item;
  }
  async getChildren(item?: Item): Promise<Item[]> {
    if (!item) return this.sections();
    return item.loader ? await item.loader() : [];
  }

  private sections(): Item[] {
    return [
      new Item("Workflow", { icon: "project", expanded: true, loader: () => this.workflow() }),
      new Item("Task Tree", { icon: "list-tree", expanded: true, loader: () => this.tasks() }),
      new Item("Current Step", { icon: "play", expanded: true, loader: () => this.current() }),
      new Item("Providers", { icon: "server-process", loader: () => this.providers() }),
      new Item("Logs", { icon: "output", loader: () => this.logs() }),
    ];
  }

  private async workflow(): Promise<Item[]> {
    const status = await json<{ title: string; revision: number; counts: Record<string, number>; phases: any[] }>(
      "ai-kit",
      ["status"],
    );
    if (!status) return [leaf("no workflow", "run bootstrap / init", "info")];
    const counts = Object.entries(status.counts)
      .map(([k, v]) => `${k}:${v}`)
      .join("  ");
    return [
      leaf(status.title, `rev ${status.revision}`, "info"),
      leaf(counts || "no tasks", undefined, "graph"),
      ...status.phases.map((p: any) => leaf(`phase ${p.id}`, p.status, "milestone")),
    ];
  }

  private async tasks(): Promise<Item[]> {
    const state = await json<{ tasks: any[] }>("ai-kit", ["show"]);
    if (!state?.tasks?.length) return [leaf("no tasks", undefined, "info")];
    return state.tasks.map(
      (t) =>
        new Item(t.id, {
          description: `${t.title} · ${t.status}`,
          icon: STATUS_ICON[t.status] ?? "circle-outline",
          loader: () =>
            [
              leaf(`owner: ${t.owner}`, undefined, "account"),
              leaf(`phase: ${t.phase}`, undefined, "milestone"),
              t.needs?.length ? leaf(`needs: ${t.needs.join(", ")}`, undefined, "references") : undefined,
              t.blocked_reason ? leaf(`blocked: ${t.blocked_reason}`, undefined, "error") : undefined,
            ].filter(Boolean) as Item[],
        }),
    );
  }

  private async current(): Promise<Item[]> {
    const ready = (await json<any[]>("ai-kit", ["ready"])) ?? [];
    const state = await json<{ tasks: any[] }>("ai-kit", ["show"]);
    const active = (state?.tasks ?? []).filter((t) => t.status === "in-progress");
    const items = [
      ...active.map((t) => leaf(`▶ ${t.id}`, `${t.owner} · in-progress`, "sync")),
      ...ready.map((t: any) => leaf(`• ${t.id}`, `${t.owner} · ready`, "debug-start")),
    ];
    return items.length ? items : [leaf("nothing runnable", undefined, "info")];
  }

  private async providers(): Promise<Item[]> {
    const providers = (await json<any[]>("ai-kit", ["providers"])) ?? [];
    return providers.map((p) =>
      leaf(p.role, p.plugin ? `${p.plugin} → ${p.provider}` : "not configured", p.provider ? "server" : "warning"),
    );
  }

  private async logs(): Promise<Item[]> {
    const events = (await json<any[]>("ai-kit", ["timeline"])) ?? [];
    return events
      .slice(-20)
      .reverse()
      .map((e) => leaf(`${e.seq}. ${e.action}`, [e.task, e.actor].filter(Boolean).join(" · "), "circle-small-filled"));
  }
}

async function askWorkflowId(): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({ title: "AI-Kit workflow id", ignoreFocusOut: true });
  return value?.trim() || undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const tree = new AiKitTree();
  context.subscriptions.push(vscode.window.registerTreeDataProvider("aiKit.tree", tree));
  context.subscriptions.push(vscode.commands.registerCommand("aiKit.refresh", () => tree.refresh()));

  // Optional auto-refresh.
  const seconds = vscode.workspace.getConfiguration("aiKit").get<number>("autoRefreshSeconds") ?? 0;
  if (seconds > 0) {
    const timer = setInterval(() => tree.refresh(), seconds * 1000);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
  }

  // Control commands that drive providers (require a registered workflow id).
  // Returns the CLI's raw stdout on success so a caller (e.g. startRole) can
  // read fields like `log` out of it; undefined on any failure.
  const run = async (cli: string, args: string[]): Promise<string | undefined> => {
    const cwd = workspaceRoot();
    if (!cwd) {
      vscode.window.showErrorMessage("AI-Kit: open a workspace folder first.");
      return undefined;
    }
    try {
      const stdout = await runCli(cli, args, cwd);
      tree.refresh();
      return stdout;
    } catch (error) {
      vscode.window.showErrorMessage(`AI-Kit: ${(error as Error).message}`);
      return undefined;
    }
  };
  // Open (or reuse) a terminal tailing the worker's log so its provider
  // (Codex, Claude, ...) is visible working in real time, not just its outcome.
  const openWorkerTerminal = (cwd: string, workerId: string, logPath: string) => {
    const name = terminalNameFor(workerId);
    const terminal =
      vscode.window.terminals.find((item) => item.name === name) ?? vscode.window.createTerminal({ name, cwd });
    terminal.sendText(tailLogCommand(logPath));
    terminal.show(true);
  };
  const startRole = (role: string) => async () => {
    const id = await askWorkflowId();
    if (!id) return;
    const stdout = await run("ai-kit:worker", ["start", "--workflow-id", id, "--role", role]);
    const cwd = workspaceRoot();
    if (!stdout || !cwd) return;
    try {
      const started = JSON.parse(stdout) as { id?: string };
      const logPath = workerLogPath(started);
      if (started.id && logPath) openWorkerTerminal(cwd, started.id, logPath);
    } catch {
      /* malformed worker-start output: no terminal, run() already reported the outcome */
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("aiKit.startExecutor", startRole("executor")),
    vscode.commands.registerCommand("aiKit.startQa", startRole("qa")),
    vscode.commands.registerCommand("aiKit.startReviewer", startRole("reviewer")),
    vscode.commands.registerCommand("aiKit.runGates", async () => {
      const id = await askWorkflowId();
      if (id) await run("ai-kit:gate", [id, "--once"]);
    }),
    vscode.commands.registerCommand("aiKit.stopWorker", async () => {
      const id = await vscode.window.showInputBox({ title: "AI-Kit worker id", ignoreFocusOut: true });
      if (id?.trim()) await run("ai-kit:worker", ["stop", id.trim()]);
    }),
  );
}

export function deactivate(): void {}
