import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (key) => {
  const index = argv.indexOf(key);
  return index >= 0 ? argv[index + 1] : undefined;
};

const rootArg = flag("--root");
if (!rootArg) throw new Error("usage: install-node-runtime.mjs --root <runtime-directory> [--pm npm|pnpm|yarn|bun]");
if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("AI-Kit requires Node.js 22 or newer");

const root = resolve(rootArg);
const manifestPath = `${root}/package.json`;
if (!existsSync(manifestPath)) {
  const manifest = { name: "ai-kit-host-runtime", private: true };
  const temporary = `${manifestPath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(temporary, manifestPath);
} else {
  try {
    JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error(`invalid package.json: ${manifestPath}`);
  }
}

const dependencies = ["tsx@4.23.1", "zod@4.3.6"];

// Respect the target project's package manager so we do not strand a second
// lockfile next to an existing pnpm/yarn/bun setup.
const detectManager = () => {
  const override = flag("--pm") ?? process.env.AIKIT_PM;
  if (override) return override;
  if (existsSync(`${root}/pnpm-lock.yaml`)) return "pnpm";
  if (existsSync(`${root}/yarn.lock`)) return "yarn";
  if (existsSync(`${root}/bun.lockb`) || existsSync(`${root}/bun.lock`)) return "bun";
  return "npm";
};

const manager = detectManager();
const argsByManager = {
  npm: ["install", "--save-exact", "--no-audit", "--no-fund", ...dependencies],
  pnpm: ["add", "--save-exact", ...dependencies],
  yarn: ["add", "--exact", ...dependencies],
  bun: ["add", "--exact", ...dependencies],
};
const args = argsByManager[manager];
if (!args) throw new Error(`unsupported package manager: ${manager} (use npm, pnpm, yarn, or bun)`);

console.log(`Installing AI-Kit runtime dependencies with ${manager}...`);
const result =
  process.platform === "win32"
    ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `${manager} ${args.join(" ")}`], {
        cwd: root,
        stdio: "inherit",
      })
    : spawnSync(manager, args, { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`${manager} install failed with exit code ${result.status}`);
