#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addTask,
  bindWorkProject,
  createWorkflow,
  currentWorkflowStatePath,
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
  runnableTasks,
  save,
  STATE,
  syncPhases,
  syncWorkflowDocs,
  taskMap,
  transition,
  validate,
  workspace,
  workflowStatePath,
  roleNames,
} from "./engine.js";
import {
  buildLock,
  buildProjectLock,
  LOCK_PATH,
  PROJECT_LOCK_PATH,
  verifyLock,
  verifyProjectLock,
} from "./lockfile.js";
import { aiKitHome, initHome } from "./home.js";
import { kitScalar, microTaskPolicy } from "./config.js";
import { type MemoryKind } from "./memory.js";
import { runtime } from "./runtime.js";
import { status as boardStatus } from "./board.js";
import { events as workflowEvents, waitForEvents } from "./board.js";

const argv = process.argv.slice(2);
let statePath = STATE;
if (argv[0] === "--state") {
  statePath = argv[1];
  argv.splice(0, 2);
}
const command = argv.shift();
const explicitState = statePath !== STATE;
const workflowState = () => (explicitState ? statePath : currentWorkflowStatePath(statePath));

const HELP_TEXT: Record<string, string> = {
  init: `Usage: ai-kit init --title <title> --workflow <id> [options]

Options:
  --title <text>       Workflow title (required)
  --workflow <id>      Workflow type (required)
  --actor <id>         Event actor
  --force              Replace existing state after creating a snapshot
  --state <path>       State file path (global option, before the command)
  -h, --help           Show this help`,
  setup: `Usage: ai-kit setup [options]

Options:
  --planner <plugin>   Planner provider, or off
  --executor <plugin>  Executor provider, or off
  --qa <plugin>        QA provider, or local/off
  --reviewer <plugin>  Reviewer provider, or off
  --force              Refresh managed bridge files
  -h, --help           Show this help`,
  plan: `Usage: ai-kit plan --idea <text> --owner <role> --acceptance <text> [options]

Options:
  --idea <text>        Feature or project goal (required)
  --owner <role>       Implementation owner (required)
  --acceptance <text> Acceptance criterion (repeatable, required)
  --workflow <id>      Workflow type (default: feature)
  --phase <id>         Implementation phase (default: build)
  --files <path>       Declared file path (repeatable)
  --scope <text>       Scope statement
  --out-of-scope <text> Exclusions
  --risks <text>       Risk (repeatable)
  --assumptions <text> Assumptions
  --tags <tag>         Task tag (repeatable)
  --actor <id>         Event actor
  --force              Replace existing workflow state
  -h, --help           Show this help`,
  "workflow-create": `Usage: ai-kit workflow-create <id> --title <title> [options]

Options:
  --title <text>       Workflow title (required)
  --workflow <id>      Workflow type (default: feature)
  --actor <id>         Event actor
  -h, --help           Show this help`,
  "add-task": `Usage: ai-kit add-task <task-id> --title <title> --owner <role> --phase <phase> [options]

Options:
  --title <text>       Task title (required)
  --owner <role>       Task owner (required)
  --phase <id>         Task phase (required)
  --acceptance <text> Acceptance criterion (repeatable)
  --needs <task-id>    Dependency (repeatable)
  --files <path>       Declared file path (repeatable)
  --tags <tag>         Task tag (repeatable)
  --actor <id>         Event actor
  -h, --help           Show this help`,
  "micro-task": `Usage: ai-kit micro-task <task-id> --title <title> --owner <role> --files <path> [options]

Options:
  --title <text>       Task title (required)
  --owner <role>       Task owner (required)
  --workflow-id <id>   Target workflow
  --phase <id>         Task phase (default: build)
  --files <path>       Changed file path (repeatable, policy-limited)
  --acceptance <text> Acceptance criterion (repeatable)
  --needs <task-id>    Dependency (repeatable)
  --tags <tag>         Task tag (repeatable)
  --actor <id>         Event actor
  -h, --help           Show this help`,
  transition: `Usage: ai-kit transition <task-id> <action> --actor <id> [options]

Options:
  --actor <id>         Transition actor (required)
  --detail <text>      Transition detail
  --evidence <path>    Evidence path (repeatable)
  -h, --help           Show this help`,
  route: `Usage: ai-kit route <task-id>

Returns the role contract, scoped skills, and task context for a task.

Options:
  -h, --help           Show this help`,
  context: `Usage: ai-kit context <task-id> [--budget <tokens>]

Options:
  --budget <tokens>    Context token budget
  -h, --help           Show this help`,
  status: `Usage: ai-kit status

Shows workflow status, task counts, and phases.
When multiple workflows have active claims, pass --state <path> before status.

Options:
  -h, --help           Show this help`,
  ready: `Usage: ai-kit ready

Lists runnable tasks.

Options:
  -h, --help           Show this help`,
  show: `Usage: ai-kit show

Shows the complete workflow state.

Options:
  -h, --help           Show this help`,
  timeline: `Usage: ai-kit timeline

Shows the append-only workflow event history.

Options:
  -h, --help           Show this help`,
  events: `Usage: ai-kit events --workflow-id <id> [options]

Reads workflow events after a cursor and waits for up to 30 seconds.

Options:
  --workflow-id <id>   Target workflow (required)
  --after-cursor <n>   Return events after this sequence (default: 0)
  --wait-ms <n>        Bounded wait from 0 to 30000 milliseconds
  -h, --help           Show this help`,
  watch: `Usage: ai-kit watch --workflow-id <id> [options]

Streams workflow events as newline-delimited JSON for editor clients.

Options:
  --workflow-id <id>   Target workflow (required)
  --after-cursor <n>   Start after this sequence (default: 0)
  --wait-ms <n>        Poll wait from 0 to 30000 milliseconds (default: 30000)
  --once               Poll once and return a JSON envelope
  -h, --help           Show this help`,
  lock: `Usage: ai-kit lock

Writes the device lock from the kit root or the project lock from a consuming project.

Options:
  -h, --help           Show this help`,
  "verify-lock": `Usage: ai-kit verify-lock

Verifies the device runtime lock and, when present, the project lock.

Options:
  -h, --help           Show this help`,
  bind: `Usage: ai-kit bind

Binds an existing external AIKIT_WORK directory to the current project.

Options:
  -h, --help           Show this help`,
  memory: `Usage: ai-kit memory <add|list|search> [options]

Options:
  --kind <kind>        decision, convention, postmortem, or note
  --title <text>       Memory title
  --body <text>        Memory body
  --query <text>       Search query
  -h, --help           Show this help`,
  "memory add": `Usage: ai-kit memory add --kind <kind> --title <title> [options]

Options:
  --kind <kind>        decision, convention, postmortem, or note (required)
  --title <text>       Memory title (required)
  --body <text>        Memory body
  -h, --help           Show this help`,
  "memory list": `Usage: ai-kit memory list [--kind <kind>]

Options:
  --kind <kind>        Filter by memory kind
  -h, --help           Show this help`,
  "memory search": `Usage: ai-kit memory search --query <text>

Options:
  --query <text>       Search project memory (required)
  -h, --help           Show this help`,
  agent: `Usage: ai-kit agent <claim|context|heartbeat|result|qa|review> [options]

Common options:
  --workflow-id <id>   Target workflow (required)
  --client-id <id>     Calling extension or worker (required)
  --lease-seconds <n>  Claim lease duration for agent claim (15..3600)
  --task-id <id>       Task for context, heartbeat, result, QA, or review
  --attempt-id <id>    Active claim attempt for context, heartbeat, or result
  --status <status>    pass or fail for result or QA
  --summary <text>     Evidence summary for result or QA
  --verdict <value>    approve or changes-requested for review
  -h, --help           Show this help`,
  roles: `Usage: ai-kit roles

Lists valid task owner roles and provider roles.

Options:
  -h, --help           Show this help`,
};

function topHelp(): string {
  const commands = [
    "setup",
    "init",
    "plan",
    "workflow-create",
    "add-task",
    "micro-task",
    "ready",
    "status",
    "show",
    "timeline",
    "events",
    "watch",
    "route",
    "context",
    "agent",
    "memory",
    "lock",
    "verify-lock",
    "bind",
    "validate",
    "providers",
    "provider",
    "roles",
    "version",
  ];
  return `Usage: ai-kit <command> [options]\n\nCommands:\n${commands.map((item) => `  ${item}`).join("\n")}\n\nGlobal options:\n  --state <path>       Use an explicit workflow state file\n  -h, --help           Show help for a command`;
}

function printHelp(requested?: string): never {
  const key = requested === "memory" && argv[0] && !argv[0].startsWith("-") ? `memory ${argv[0]}` : requested;
  const text =
    (key && HELP_TEXT[key]) ||
    (requested ? `Usage: ai-kit ${requested} [options]\n\nOptions:\n  -h, --help           Show this help` : topHelp());
  console.log(text);
  process.exit(0);
}

if (command === "--help" || command === "-h") printHelp();
if (command === "help") printHelp(argv[0]);
if (argv.includes("--help") || argv.includes("-h")) printHelp(command);

const values = new Map<string, string[]>();
for (let index = 0; index < argv.length; index++) {
  const item = argv[index];
  if (item.startsWith("--")) {
    const key = item.slice(2);
    const collected: string[] = [];
    while (argv[index + 1] && !argv[index + 1].startsWith("--")) collected.push(argv[++index]);
    values.set(key, [...(values.get(key) ?? []), ...collected]);
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
      ".claude/commands/setup-ai-kit.md",
      ".claude/commands/qa.md",
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
    const projectConfigTemplates = ["project.yaml", "models.yaml"];
    const initializedProjectConfigs: string[] = [];
    for (const name of projectConfigTemplates) {
      const destination = join(WORK, name);
      if (existsSync(destination)) continue;
      writeFileSync(destination, readFileSync(join(ROOT, ".ai", "templates", name)));
      initializedProjectConfigs.push(displayPath(destination));
    }
    const memoryReadme = join(PROJECT_ROOT, ".ai-memory", "README.md");
    if (!existsSync(memoryReadme)) {
      mkdirSync(join(PROJECT_ROOT, ".ai-memory"), { recursive: true });
      writeFileSync(memoryReadme, readFileSync(join(ROOT, ".ai", "templates", "memory", "README.md")));
    }
    const providerRoles = ["planner", "executor", "qa", "reviewer"] as const;
    const selectedProviderRoles = providerRoles.filter((role) => values.has(role));
    if (selectedProviderRoles.length) {
      const modelsPath = join(WORK, "models.yaml");
      if (existsSync(modelsPath) && !initializedProjectConfigs.includes(displayPath(modelsPath)) && !flag("force"))
        throw new EngineError(
          `models.yaml already exists: ${displayPath(modelsPath)}; use --force to change providers`,
        );
      const selected = providerRoles.map((role) => {
        const value = one(role) ?? "off";
        if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new EngineError(`--${role} must be a plugin id or off`);
        return `${role}: ${value}`;
      });
      writeFileSync(modelsPath, `${selected.join("\n")}\n`);
    }
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
      marker = "# AI-Kit workspace state",
      ignoreBlock = `${marker}\n.ai-work/*\n!.ai-work/\n!.ai-work/project.yaml\n!.ai-work/models.yaml\n!.ai-work/security.yaml\n!.ai-work/plugins/\n!.ai-work/plugins/**\n`;
    if (!existsSync(gitignore)) writeFileSync(gitignore, ignoreBlock);
    else {
      const current = readFileSync(gitignore, "utf8");
      if (current.includes(`${marker}\n.ai-work/\n`))
        writeFileSync(gitignore, current.replace(`${marker}\n.ai-work/\n`, ignoreBlock));
      else if (!current.includes(marker)) writeFileSync(gitignore, `\n${ignoreBlock}`, { flag: "a" });
    }
    validate(load<any>(statePath));
    return { project: PROJECT_ROOT, home: ROOT, work: WORK, copied, initializedProjectConfigs };
  },
  plan: () => {
    const targetState = workflowState();
    if (existsSync(targetState) && !flag("force"))
      throw new EngineError(`state already exists: ${targetState}; use --force to replace`);
    const idea = one("idea", true)!,
      workflow = one("workflow") ?? "feature",
      acceptance = many("acceptance");
    if (!acceptance.length) throw new EngineError("--acceptance is required");
    const root = workspace(targetState);
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
    event(state, targetState, "plan", null, one("actor") ?? "planner", null, null, "idea converted to draft plan");
    save(state, targetState);
    return {
      state: targetState,
      workspace: root,
      tasks: ["T1", "T2"],
      assumptions: one("assumptions") ?? "none recorded",
    };
  },
  "workflow-create": () =>
    createWorkflow(argv[0], one("title", true)!, one("workflow") ?? "feature", one("actor") ?? "planner"),
  "sync-docs": () => {
    const path = workflowState();
    const state = load<any>(path);
    validate(state);
    syncWorkflowDocs(state, path);
    return { state: path, workspace: workspace(path) };
  },
  workflows: () => loadRegistry().workflows,
  "add-task": () =>
    addTask(workflowState(), {
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
  "micro-task": () => {
    const policy = microTaskPolicy();
    if (!policy.enabled) throw new EngineError("micro-tasks are disabled in project policy");
    const files = many("files");
    if (!files.length) throw new EngineError("micro-task requires at least one --files path");
    if (files.length > policy.maxFiles)
      throw new EngineError(`micro-task allows at most ${policy.maxFiles} file paths`);
    const workflowId = one("workflow-id");
    const task = addTask(workflowId ? workflowStatePath(workflowId) : workflowState(), {
      id: argv[0],
      title: one("title", true),
      owner: one("owner", true),
      phase: one("phase") ?? "build",
      acceptance: many("acceptance"),
      needs: many("needs"),
      files,
      tags: [...new Set([...many("tags"), "micro"])],
      actor: one("actor") ?? "micro-task",
    });
    return { policy, task };
  },
  ready: () => {
    const state = load<any>(workflowState());
    return runnableTasks(state);
  },
  transition: () =>
    transition(workflowState(), argv[0], argv[1], one("actor", true)!, one("detail") ?? "", many("evidence")),
  validate: () => {
    validate(load<any>(workflowState()));
    return { valid: true };
  },
  show: () => {
    const state = load<any>(workflowState());
    syncPhases(state);
    return state;
  },
  status: () => {
    return boardStatus(undefined, workflowState());
  },
  timeline: () => {
    const state = load<any>(workflowState());
    validate(state);
    return state.events;
  },
  events: async () => {
    const workflowId = one("workflow-id", true)!;
    const cursor = Number(one("after-cursor") ?? "0");
    const waitMs = Number(one("wait-ms") ?? "0");
    if (!Number.isInteger(cursor) || cursor < 0) throw new EngineError("--after-cursor must be a non-negative integer");
    return waitForEvents(workflowId, cursor, waitMs);
  },
  watch: async () => {
    const workflowId = one("workflow-id", true)!;
    let cursor = Number(one("after-cursor") ?? "0");
    const waitMs = Number(one("wait-ms") ?? "30000");
    if (!Number.isInteger(cursor) || cursor < 0) throw new EngineError("--after-cursor must be a non-negative integer");
    if (flag("once")) return waitForEvents(workflowId, cursor, waitMs);
    for (;;) {
      const result = await waitForEvents(workflowId, cursor, waitMs);
      for (const event of result.events)
        process.stdout.write(`${JSON.stringify({ workflow_id: workflowId, cursor: event.seq, event })}\n`);
      cursor = result.cursor;
    }
  },
  blocked: () => {
    const state = load<any>(workflowState());
    return state.tasks
      .filter((task: any) => task.status === "blocked")
      .map((task: any) => ({ id: task.id, title: task.title, reason: task.blocked_reason }));
  },
  graph: () => {
    const state = load<any>(workflowState());
    const dot = (value: string) => String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    return `digraph workflow {\n${state.tasks.flatMap((task: any) => [`  "${dot(task.id)}" [label="${dot(`${task.id}: ${task.title}`)}"];`, ...task.needs.map((need: string) => `  "${dot(need)}" -> "${dot(task.id)}";`)]).join("\n")}\n}`;
  },
  route: () => {
    const path = workflowState();
    const state = load<any>(path),
      task = taskMap(state).get(argv[0]);
    if (!task) throw new EngineError(`unknown task: ${argv[0]}`);
    return routeTask(task, path);
  },
  context: () => {
    const path = workflowState();
    const state = load<any>(path),
      task = taskMap(state).get(argv[0]);
    if (!task) throw new EngineError(`unknown task: ${argv[0]}`);
    const route = routeTask(task, path);
    const budget = one("budget") ? Number(one("budget")) : undefined;
    return {
      task: task.id,
      ...runtime.artifacts.assembleContext([route.role_contract, ...route.context, ...route.skills], budget),
    };
  },
  agent: () => {
    const sub = argv.shift();
    const workflowId = one("workflow-id", true)!;
    const clientId = one("client-id", true)!;
    if (sub === "claim") {
      const rawLease = one("lease-seconds");
      let leaseSeconds: number | undefined;
      if (rawLease !== undefined) {
        const parsed = Number(rawLease);
        if (!Number.isInteger(parsed) || parsed < 15 || parsed > 3600)
          throw new EngineError("--lease-seconds must be an integer between 15 and 3600");
        leaseSeconds = parsed;
      }
      return runtime.agent.claim(workflowId, clientId, one("owner"), leaseSeconds);
    }
    if (sub === "context")
      return runtime.agent.context(workflowId, one("task-id", true)!, clientId, one("attempt-id", true)!);
    if (sub === "heartbeat")
      return runtime.agent.heartbeat(workflowId, one("task-id", true)!, clientId, one("attempt-id", true)!);
    if (sub === "result")
      return runtime.agent.submitResult(
        workflowId,
        one("task-id", true)!,
        clientId,
        one("attempt-id", true)!,
        one("summary", true)!,
        (one("status", true) ?? "fail") as "pass" | "fail",
        many("changed-path"),
        many("command"),
        one("branch"),
      );
    if (sub === "qa")
      return runtime.agent.submitQa(
        workflowId,
        one("task-id", true)!,
        clientId,
        (one("status", true) ?? "fail") as "pass" | "fail",
        one("summary", true)!,
        many("command"),
      );
    if (sub === "review")
      return runtime.agent.submitReview(
        workflowId,
        one("task-id", true)!,
        clientId,
        (one("verdict", true) ?? "changes-requested") as "approve" | "changes-requested",
        one("notes") ?? "",
      );
    throw new EngineError(
      "usage: agent <claim|context|heartbeat|result|qa|review> --workflow-id ID --client-id ID [options]",
    );
  },
  bundle: () => {
    const path = workflowState();
    const state = load<any>(path),
      task = taskMap(state).get(argv[0]);
    if (!task) throw new EngineError(`unknown task: ${argv[0]}`);
    return runtime.context.build(task, path, one("budget") ? Number(one("budget")) : undefined);
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
  roles: () => ({ task_owners: [...roleNames()].sort(), provider_roles: ["planner", "executor", "qa", "reviewer"] }),
  lock: () => {
    if (PROJECT_ROOT !== ROOT) {
      const lock = buildProjectLock();
      writeFileSync(PROJECT_LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);
      return lock;
    }
    const lock = buildLock();
    writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);
    return lock;
  },
  "verify-lock": () => {
    const device = verifyLock();
    const project = existsSync(PROJECT_LOCK_PATH) ? verifyProjectLock() : { ok: true, drift: [] };
    const result = { ok: device.ok && project.ok, drift: [...device.drift, ...project.drift] };
    if (!result.ok) process.exitCode = 1;
    return result;
  },
  bind: () => bindWorkProject(),
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
    name: kitScalar("id", readFileSync(join(ROOT, ".ai", "kit.yaml"), "utf8")) ?? "ai-kit",
    version: kitScalar("version", readFileSync(join(ROOT, ".ai", "kit.yaml"), "utf8")) ?? "0.0.0",
  }),
};

try {
  const handler = command ? handlers[command] : undefined;
  if (!handler) throw new EngineError(`commands: ${Object.keys(handlers).join(", ")}`);
  const result = await handler();
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}`);
  process.exitCode = 2;
}
