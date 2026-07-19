// Provider Adapter — the single, normalized boundary between the AI-Kit runtime
// and any model/agent provider. A provider is an opaque CLI process. The runtime
// hands it three rendered arguments (an assignment JSON, an expected output path,
// and a prompt) and requires exactly one artifact JSON written to the output path
// with a zero exit code. This module normalizes every failure mode into one
// result shape so the orchestrator never has to reason about provider internals.
//
// The provider runs asynchronously so a long run can renew its claim lease via
// the optional `onHeartbeat` callback instead of being reclaimed mid-flight.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { delimiter, dirname, extname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PROJECT_ROOT } from "./engine.js";
import { pluginCommand, type Plugin } from "./plugins.js";

export const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
export const RETRY_BACKOFF_MS = 250;

// Normalized outcomes. Everything a provider can do collapses into one of these.
export type AdapterOutcome =
  | "ok" // exit 0 and the expected artifact exists
  | "timeout" // killed after exceeding the deadline
  | "spawn-error" // command could not be launched (missing binary, EACCES, ...)
  | "nonzero-exit" // ran to completion but returned a non-zero status
  | "no-output"; // exit 0 but the required artifact was not produced

// Outcomes worth retrying are transient; a contract violation (no-output) is not.
const RETRYABLE: ReadonlySet<AdapterOutcome> = new Set(["timeout", "spawn-error", "nonzero-exit"]);

export type AdapterResult = {
  outcome: AdapterOutcome;
  ok: boolean;
  exit_code: number | null;
  signal: string | null;
  duration_ms: number;
  attempts: number;
  output_path: string;
  command: string[];
  stdout: string;
  stderr: string;
  error?: string; // human-readable reason when ok === false
};

export type InvokeOptions = {
  input: string; // assignment JSON path -> {input}
  output: string; // required artifact path  -> {output}
  prompt: string; // instruction string      -> {prompt}
  cwd?: string;
  timeoutMs?: number;
  retries?: number;
  env?: NodeJS.ProcessEnv;
  // Called periodically while a provider runs, so a long job can renew its lease.
  onHeartbeat?: () => void;
  heartbeatMs?: number;
};

// The minimal process outcome the classifier reasons about.
type RunResult = {
  error?: (Error & { code?: string }) | null;
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

// Windows launches .cmd/.bat shims through the shell; POSIX never needs it.
export function windowsScript(command: string, path = process.env.PATH ?? ""): boolean {
  if (process.platform !== "win32") return false;
  if ([".cmd", ".bat"].includes(extname(command).toLowerCase())) return true;
  if (extname(command)) return false;
  return path
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => [".cmd", ".bat"].some((ext) => existsSync(join(dir, `${command}${ext}`))));
}

// `cmd.exe /c` is needed for Windows .cmd/.bat shims, but the prompt and paths
// are task-controlled values. Quote every argument before handing the command
// to cmd so metacharacters remain data instead of becoming shell syntax.
function quoteWindowsArg(value: string): string {
  if (!value || /[\s"&<>^|()]/.test(value)) {
    const escaped = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1");
    return `"${escaped}"`;
  }
  return value;
}

export function windowsCommandLine(command: string[]): string {
  return command.map(quoteWindowsArg).join(" ");
}

function launchSpec(command: string[]): { file: string; args: string[] } {
  if (process.platform === "win32" && windowsScript(command[0]))
    return {
      file: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", windowsCommandLine(command)],
    };
  return { file: command[0], args: command.slice(1) };
}

// Run the process once, resolving a normalized RunResult. Enforces the timeout by
// killing the child, and fires onHeartbeat on an interval while it runs.
function runProcess(
  command: string[],
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv | undefined,
  onHeartbeat?: () => void,
  heartbeatMs?: number,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const launch = launchSpec(command);
    // Providers receive their prompt as an argument. Close stdin immediately
    // so CLIs that also probe stdin do not wait forever for a second prompt.
    const child = spawn(launch.file, launch.args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    const beat =
      onHeartbeat && heartbeatMs && heartbeatMs > 0
        ? setInterval(() => {
            try {
              onHeartbeat();
            } catch {
              /* heartbeat failures must not abort the run */
            }
          }, heartbeatMs)
        : undefined;
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (beat) clearInterval(beat);
      resolve(result);
    };
    child.on("error", (error) => finish({ error, status: null, signal: null, stdout, stderr }));
    child.on("close", (code, signal) =>
      finish({
        error: timedOut ? Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) : null,
        status: code,
        signal,
        stdout,
        stderr,
      }),
    );
  });
}

function classify(run: RunResult, output: string): AdapterOutcome {
  if (run.error?.code === "ETIMEDOUT") return "timeout";
  if (run.error) return "spawn-error";
  if (run.status !== 0) return "nonzero-exit";
  if (!existsSync(output)) return "no-output";
  return "ok";
}

function describe(outcome: AdapterOutcome, run: RunResult): string {
  const tail = (run.stderr || run.stdout || "").trim().slice(-500);
  switch (outcome) {
    case "timeout":
      return "provider timed out before producing an artifact";
    case "spawn-error":
      return run.error?.message ?? "provider could not be started";
    case "nonzero-exit":
      return `provider exited with status ${run.status ?? "unknown"}${tail ? `: ${tail}` : ""}`;
    case "no-output":
      return "provider exited cleanly but wrote no artifact to the output path";
    default:
      return "";
  }
}

// Runs the provider up to (retries + 1) times, retrying only transient outcomes,
// and resolves a single normalized result. Never rejects for provider failures —
// callers branch on `result.ok` / `result.outcome`.
export async function invokeProvider(plugin: Plugin, options: InvokeOptions): Promise<AdapterResult> {
  const command = pluginCommand(plugin, options.input, options.output, options.prompt);
  const timeoutMs = options.timeoutMs ?? plugin.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = (options.retries ?? plugin.retries ?? 0) + 1;
  const cwd = options.cwd ?? PROJECT_ROOT;
  const started = Date.now();
  let attempts = 0;
  let run: RunResult = { error: null, status: null, signal: null, stdout: "", stderr: "" };
  let outcome: AdapterOutcome = "spawn-error";

  // Guarantee the provider can write its artifact (the provider must not have to
  // create the workflow's artifact directory itself).
  mkdirSync(dirname(options.output), { recursive: true });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    // Clear any stale artifact so `no-output` reflects this attempt only.
    if (existsSync(options.output)) rmSync(options.output, { force: true });
    run = await runProcess(command, cwd, timeoutMs, options.env, options.onHeartbeat, options.heartbeatMs);
    outcome = classify(run, options.output);
    if (outcome === "ok" || !RETRYABLE.has(outcome)) break;
    if (attempt < maxAttempts) await delay(RETRY_BACKOFF_MS * attempt);
  }

  const ok = outcome === "ok";
  return {
    outcome,
    ok,
    exit_code: run.status,
    signal: run.signal,
    duration_ms: Date.now() - started,
    attempts,
    output_path: options.output,
    command,
    stdout: run.stdout,
    stderr: run.stderr,
    ...(ok ? {} : { error: describe(outcome, run) }),
  };
}
