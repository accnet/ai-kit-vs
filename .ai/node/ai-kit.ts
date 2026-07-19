#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addTask,
  createWorkflow,
  displayPath,
  EngineError,
  event,
  load,
  loadRegistry,
  newState,
  now,
  PROJECT_ROOT,
  ROOT,
  WORK,
  routeTask,
  runnable,
  save,
  STATE,
  syncPhases,
  taskMap,
  transition,
  validate,
  workspace,
} from "./engine.js";
import { buildLock, LOCK_PATH, verifyLock } from "./lockfile.js";
import { aiKitHome, initHome } from "./home.js";
import { kitScalar } from "./config.js";
import { type MemoryKind } from "./memory.js";
import { runtime } from "./runtime.js";

const argv = process.argv.slice(2);
let statePath = STATE;
if (argv[0] === "--state") {
  statePath = argv[1];
  argv.splice(0, 2);
}
const command = argv.shift();
const values = new Map<string, string[]>();
for (let index = 0; index < argv.length; index++) {
  const item = argv[index];
  if (item.startsWith("--")) {
    const key = item.slice(2);
    const collected: string[] = [];
    while (argv[index + 1] && !argv[index + 1].startsWith("--")) collected.push(argv[++index]);
    values.set(key, collected);
  }
}
const one = (key: string, required = false) => {
  const value = values.get(key)?.[0];
  if (required && !value) throw new EngineError(`--${key} is required`);
  return value;
};
const many = (key: string) => values.get(key) ?? [];
const flag = (key: string) => values.has(key);

// One handler per command. Order is preserved for the usage message.
const handlers: Record<string, () => unknown> = {
  init: () => {
    if (existsSync(statePath) && !flag("force"))
      throw new EngineError(`state already exists: ${statePath}; use --force to replace`);
    if (existsSync(statePath) && flag("force")) {
      const snapshots = `${workspace(statePath)}/snapshots`;
      mkdirSync(snapshots, { recursive: true });
      writeFileSync(`${snapshots}/workflow-${now().replaceAll(":", "-")}.json`, readFileSync(statePath));
    }
    const workflow = one("workflow", true)!;
    const state = newState(one("title", true)!, workflow);
    validate(state);
    event(state, statePath, "init", null, one("actor") ?? "planner", null, null, "workflow initialized");
    save(state, statePath);
    return state;
  },
  setup: () => {
    if (PROJECT_ROOT === ROOT)
      throw new EngineError("run 'ai-kit setup' from a project directory, not the AI-Kit home");
    const workspaceFiles = [
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      ".github/copilot-instructions.md",
      ".cursor/rules/ai-kit.mdc",
      ".codex/config.toml",
      ".claude/commands/implement.md",
      ".claude/commands/plan.md",
      ".claude/commands/review.md",
      ".claude/commands/status.md",
      ".vscode/extensions.json",
      ".vscode/settings.json",
      ".vscode/tasks.json",
    ];
    const sourceFor = (relative: string) =>
      relative === "AGENTS.md"
        ? join(ROOT, ".ai", "templates", "AGENTS.project.md")
        : relative.startsWith(".vscode/")
          ? join(ROOT, ".ai", "templates", "workspace", relative.slice(".vscode/".length))
          : join(ROOT, relative);
    const copied: string[] = [];
    for (const relative of workspaceFiles) {
      const source = sourceFor(relative),
        destination = join(PROJECT_ROOT, relative);
      if (!existsSync(source)) throw new EngineError(`workspace template missing: ${relative}`);
      const expected = readFileSync(source);
      if (existsSync(destination) && !flag("force")) {
        if (!readFileSync(destination).equals(expected)) throw new EngineError(`workspace file conflict: ${relative}`);
        continue;
      }
      mkdirSync(join(destination, ".."), { recursive: true });
      writeFileSync(destination, expected);
      copied.push(relative);
    }

    for (const relative of [
      "state",
      "run/workers",
      "workflows/default/state",
      "workflows/default/plan",
      "workflows/default/roadmap",
      "workflows/default/tasks",
      "workflows/default/context",
      "workflows/default/artifacts",
      "workflows/default/logs",
    ])
      mkdirSync(join(WORK, relative), { recursive: true });
    const registry = join(WORK, "registry.json");
    if (!existsSync(registry)) writeFileSync(registry, '{\n  "version": 1,\n  "revision": 0,\n  "workflows": []\n}\n');
    if (!existsSync(statePath)) {
      const state = newState("Untitled workspace workflow", "feature");
      validate(state);
      event(state, statePath, "init", null, "planner", null, null, "workspace initialized");
      save(state, statePath);
    }
    for (const template of ["plan", "roadmap", "tasks"]) {
      const destination = join(WORK, "workflows", "default", template, `${template}.md`);
      if (!existsSync(destination))
        writeFileSync(destination, readFileSync(join(ROOT, ".ai", "templates", `${template}.md`)));
    }
    const gitignore = join(PROJECT_ROOT, ".gitignore"),
      marker = "# AI-Kit workspace state";
    if (!existsSync(gitignore)) writeFileSync(gitignore, `${marker}\n.ai-work/\n`);
    else if (!readFileSync(gitignore, "utf8").includes(marker))
      writeFileSync(gitignore, `\n${marker}\n.ai-work/\n`, { flag: "a" });
    validate(load<any>(statePath));
    return { project: PROJECT_ROOT, home: ROOT, work: WORK, copied };
  },
  plan: () => {
    if (existsSync(statePath) && !flag("force"))
      throw new EngineError(`state already exists: ${statePath}; use --force to replace`);
    const idea = one("idea", true)!,
      workflow = one("workflow") ?? "feature",
      acceptance = many("acceptance");
    if (!acceptance.length) throw new EngineError("--acceptance is required");
    const root = workspace(statePath);
    const planFiles = ["roadmap/roadmap.md", "plan/plan.md", "tasks/tasks.md"].map((name) =>
      displayPath(join(root, name)),
    );
    const state = newState(idea, workflow);
    state.tasks = [
      {
        id: "T1",
        title: `Confirm scope and plan: ${idea}`,
        owner: "planner",
        phase: "plan",
        needs: [],
        status: "todo",
        acceptance: ["Scope, exclusions, risks, and acceptance criteria confirmed"],
        files: planFiles,
        tags: ["planning"],
        attempts: 0,
        evidence: [],
        blocked_reason: null,
      },
      {
        id: "T2",
        title: idea,
        owner: one("owner", true)!,
        phase: one("phase") ?? "build",
        needs: ["T1"],
        status: "todo",
        acceptance,
        files: many("files"),
        tags: many("tags"),
        attempts: 0,
        evidence: [],
        blocked_reason: null,
      },
    ];
    validate(state);
    syncPhases(state);
    mkdirSync(`${root}/roadmap`, { recursive: true });
    mkdirSync(`${root}/plan`, { recursive: true });
    mkdirSync(`${root}/tasks`, { recursive: true });
    const phase = one("phase") ?? "build",
      tags = many("tags");
    writeFileSync(
      `${root}/roadmap/roadmap.md`,
      `# Roadmap\n\nGoal: ${idea}\n\n1. Confirm scope, risks, and acceptance criteria.\n2. Implement in phase \`${phase}\` and verify evidence.\n`,
    );
    writeFileSync(
      `${root}/plan/plan.md`,
      `# Plan\n\nGoal: ${idea}\n\nScope: ${one("scope") ?? "pending Planner confirmation"}\nOut of scope: ${one("out-of-scope") ?? "none recorded"}\nRisks: ${(many("risks").length ? many("risks") : ["none recorded"]).join(", ")}\nAssumptions: ${one("assumptions") ?? "none recorded"}\nTags: ${(tags.length ? tags : ["none"]).join(", ")}\n\nImplementation owner: ${one("owner", true)}\n`,
    );
    writeFileSync(
      `${root}/tasks/tasks.md`,
      `# Tasks\n\n- [ ] T1 Confirm scope and plan | owner: planner | phase: plan\n- [ ] T2 ${idea} | owner: ${one("owner", true)} | needs: T1 | phase: build\n  - Accept: ${acceptance.join("\n  - Accept: ")}\n`,
    );
    event(state, statePath, "plan", null, one("actor") ?? "planner", null, null, "idea converted to draft plan");
    save(state, statePath);
    return {
      state: statePath,
      workspace: root,
      tasks: ["T1", "T2"],
      assumptions: one("assumptions") ?? "none recorded",
    };
  },
  "workflow-create": () =>
    createWorkflow(argv[0], one("title", true)!, one("workflow") ?? "feature", one("actor") ?? "planner"),
  workflows: () => loadRegistry().workflows,
  "add-task": () =>
    addTask(statePath, {
      id: argv[0],
      title: one("title", true),
      owner: one("owner", true),
      phase: one("phase", true),
      acceptance: many("acceptance"),
      needs: many("needs"),
      files: many("files"),
      tags: many("tags"),
      actor: one("actor") ?? "planner",
    }),
  ready: () => {
    const state = load<any>(statePath);
    const tasks = taskMap(state);
    return state.tasks.filter((task: any) => runnable(task, tasks));
  },
  transition: () => transition(statePath, argv[0], argv[1], one("actor", true)!, one("detail") ?? "", many("evidence")),
  validate: () => {
    validate(load<any>(statePath));
    return { valid: true };
  },
  show: () => {
    const state = load<any>(statePath);
    syncPhases(state);
    return state;
  },
  status: () => {
    const state = load<any>(statePath);
    syncPhases(state);
    const counts: Record<string, number> = {};
    for (const task of state.tasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
    return { title: state.title, revision: state.revision, counts, phases: state.phases };
  },
  timeline: () => {
    const state = load<any>(statePath);
    validate(state);
    return state.events;
  },
  blocked: () => {
    const state = load<any>(statePath);
    return state.tasks
      .filter((task: any) => task.status === "blocked")
      .map((task: any) => ({ id: task.id, title: task.title, reason: task.blocked_reason }));
  },
  graph: () => {
    const state = load<any>(statePath);
    const dot = (value: string) => String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    return `digraph workflow {\n${state.tasks.flatMap((task: any) => [`  "${dot(task.id)}" [label="${dot(`${task.id}: ${task.title}`)}"];`, ...task.needs.map((need: string) => `  "${dot(need)}" -> "${dot(task.id)}";`)]).join("\n")}\n}`;
  },
  route: () => {
    const state = load<any>(statePath),
      task = taskMap(state).get(argv[0]);
    if (!task) throw new EngineError(`unknown task: ${argv[0]}`);
    return routeTask(task, statePath);
  },
  context: () => {
    const state = load<any>(statePath),
      task = taskMap(state).get(argv[0]);
    if (!task) throw new EngineError(`unknown task: ${argv[0]}`);
    const route = routeTask(task, statePath);
    const budget = one("budget") ? Number(one("budget")) : undefined;
    return {
      task: task.id,
      ...runtime.artifacts.assembleContext([route.role_contract, ...route.context, ...route.skills], budget),
    };
  },
  bundle: () => {
    const state = load<any>(statePath),
      task = taskMap(state).get(argv[0]);
    if (!task) throw new EngineError(`unknown task: ${argv[0]}`);
    return runtime.context.build(task, statePath, one("budget") ? Number(one("budget")) : undefined);
  },
  onboard: () => {
    const stacks: string[] = [],
      sources: string[] = [];
    const verification: Record<string, string> = {};
    if (existsSync(join(PROJECT_ROOT, "package.json"))) {
      stacks.push("node");
      sources.push("src");
      verification.test_command = "npm test";
    }
    if (existsSync(join(PROJECT_ROOT, "composer.json"))) {
      stacks.push("php", "laravel");
      sources.push("app");
      verification.test_command = "php artisan test";
    }
    if (existsSync(join(PROJECT_ROOT, "pyproject.toml")) || existsSync(join(PROJECT_ROOT, "requirements.txt"))) {
      stacks.push("python");
      sources.push("src");
      verification.test_command = "pytest -q";
    }
    if (!stacks.length) {
      stacks.push("any");
      sources.push(".");
    }
    const proposal: any = {
      stack: [...new Set(stacks)].sort(),
      source_dirs: [...new Set(sources)].sort(),
      verification,
    };
    if (flag("apply")) {
      const manifest = join(PROJECT_ROOT, ".ai", "kit.yaml"),
        text = readFileSync(manifest, "utf8");
      writeFileSync(`${manifest}.bak`, text);
      let updated = text
        .replace(/stack:\s*\[[^\]]*\]/, `stack: [${proposal.stack.join(", ")}]`)
        .replace(/source_dirs:\s*\[[^\]]*\]/, `source_dirs: [${proposal.source_dirs.join(", ")}]`);
      for (const [key, value] of Object.entries(verification))
        updated = updated.replace(new RegExp(`${key}:.*`), `${key}: ${value}`);
      writeFileSync(manifest, updated);
      proposal.applied = true;
    }
    return proposal;
  },
  capabilities: () =>
    argv[0]
      ? runtime.capabilities.resolveCapability(argv[0])
      : runtime.capabilities.listCapabilities(one("kind") as any),
  lock: () => {
    const lock = buildLock();
    writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);
    return lock;
  },
  "verify-lock": () => {
    const result = verifyLock();
    if (!result.ok) process.exitCode = 1;
    return result;
  },
  home: () => (flag("init") ? initHome() : { home: aiKitHome() }),
  memory: () => {
    const sub = argv[0];
    if (sub === "add")
      return runtime.memory.addMemory({
        kind: one("kind", true) as MemoryKind,
        title: one("title", true)!,
        body: one("body"),
      });
    if (sub === "list") return runtime.memory.listMemory(one("kind") as MemoryKind | undefined);
    if (sub === "search") return runtime.memory.searchMemory(one("query", true)!);
    throw new EngineError("usage: memory <add|list|search> [--kind K] [--title T] [--body B] [--query Q]");
  },
  providers: () => runtime.providers.list(),
  provider: () => {
    const sub = argv[0],
      role = argv[1] as any,
      id = argv[2];
    if (!role || !id) throw new EngineError("usage: provider <capability|validate|init> <role> <id>");
    if (sub === "capability") return runtime.providers.capability(role, id);
    if (sub === "validate") return runtime.providers.validate(role, id);
    if (sub === "init") return runtime.providers.init(role, id);
    throw new EngineError("usage: provider <capability|validate|init> <role> <id>");
  },
  version: () => ({
    // Kit identity from .ai/kit.yaml, which is always installed (a consuming
    // project may have no root package.json).
    name: kitScalar("id") ?? "ai-kit",
    version: kitScalar("version") ?? "0.0.0",
  }),
};

try {
  const handler = command ? handlers[command] : undefined;
  if (!handler) throw new EngineError(`commands: ${Object.keys(handlers).join(", ")}`);
  console.log(JSON.stringify(handler(), null, 2));
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exitCode = 2;
}
