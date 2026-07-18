#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  addTask,
  createWorkflow,
  EngineError,
  event,
  load,
  loadRegistry,
  newState,
  now,
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

try {
  let output: any;
  if (command === "init") {
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
    output = state;
  } else if (command === "workflow-create")
    output = createWorkflow(argv[0], one("title", true)!, one("workflow") ?? "feature", one("actor") ?? "planner");
  else if (command === "workflows") output = loadRegistry().workflows;
  else if (command === "add-task")
    output = addTask(statePath, {
      id: argv[0],
      title: one("title", true),
      owner: one("owner", true),
      phase: one("phase", true),
      acceptance: many("acceptance"),
      needs: many("needs"),
      files: many("files"),
      tags: many("tags"),
      actor: one("actor") ?? "planner",
    });
  else if (command === "ready") {
    const state = load<any>(statePath);
    const tasks = taskMap(state);
    output = state.tasks.filter((task: any) => runnable(task, tasks));
  } else if (command === "status") {
    const state = load<any>(statePath);
    syncPhases(state);
    const counts: Record<string, number> = {};
    for (const task of state.tasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
    output = { title: state.title, revision: state.revision, counts, phases: state.phases };
  } else if (command === "timeline") {
    const state = load<any>(statePath);
    validate(state);
    output = state.events;
  } else if (command === "blocked") {
    const state = load<any>(statePath);
    output = state.tasks
      .filter((task: any) => task.status === "blocked")
      .map((task: any) => ({ id: task.id, title: task.title, reason: task.blocked_reason }));
  } else if (command === "graph") {
    const state = load<any>(statePath);
    const dot = (value: string) => String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    output = `digraph workflow {\n${state.tasks.flatMap((task: any) => [`  "${dot(task.id)}" [label="${dot(`${task.id}: ${task.title}`)}"];`, ...task.needs.map((need: string) => `  "${dot(need)}" -> "${dot(task.id)}";`)]).join("\n")}\n}`;
  } else if (command === "route") {
    const state = load<any>(statePath),
      task = taskMap(state).get(argv[0]);
    if (!task) throw new EngineError(`unknown task: ${argv[0]}`);
    output = routeTask(task, statePath);
  } else if (command === "transition")
    output = transition(statePath, argv[0], argv[1], one("actor", true)!, one("detail") ?? "", many("evidence"));
  else if (command === "plan") {
    if (existsSync(statePath) && !flag("force"))
      throw new EngineError(`state already exists: ${statePath}; use --force to replace`);
    const idea = one("idea", true)!,
      workflow = one("workflow") ?? "feature",
      acceptance = many("acceptance");
    if (!acceptance.length) throw new EngineError("--acceptance is required");
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
        files: [".ai-work/roadmap/roadmap.md", ".ai-work/plan/plan.md", ".ai-work/tasks/tasks.md"],
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
    const root = workspace(statePath);
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
    output = {
      state: statePath,
      workspace: root,
      tasks: ["T1", "T2"],
      assumptions: one("assumptions") ?? "none recorded",
    };
  } else if (command === "onboard") {
    const stacks: string[] = [],
      sources: string[] = [];
    const verification: Record<string, string> = {};
    if (existsSync("package.json")) {
      stacks.push("node");
      sources.push("src");
      verification.test_command = "npm test";
    }
    if (existsSync("composer.json")) {
      stacks.push("php", "laravel");
      sources.push("app");
      verification.test_command = "php artisan test";
    }
    if (existsSync("pyproject.toml") || existsSync("requirements.txt")) {
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
      const manifest = ".ai/kit.yaml",
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
    output = proposal;
  } else if (command === "validate") {
    validate(load<any>(statePath));
    output = { valid: true };
  } else if (command === "show") {
    const state = load<any>(statePath);
    syncPhases(state);
    output = state;
  } else
    throw new EngineError(
      "commands: init, plan, workflow-create, workflows, add-task, ready, transition, validate, show, status, timeline, blocked, graph, route, onboard",
    );
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exitCode = 2;
}
