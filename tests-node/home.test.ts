import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { aiKitHome, HOME_SUBDIRS, initHome, resolvePluginPath } from "../.ai/node/home.js";
import { loadPlugin } from "../.ai/node/plugins.js";

function withHome<T>(fn: (home: string) => T): T {
  const previous = process.env.AIKIT_HOME;
  const home = mkdtempSync(join(tmpdir(), "aikit-home-"));
  process.env.AIKIT_HOME = home;
  try {
    return fn(home);
  } finally {
    if (previous === undefined) delete process.env.AIKIT_HOME;
    else process.env.AIKIT_HOME = previous;
  }
}

test("aiKitHome honors AIKIT_HOME override", () => {
  withHome((home) => assert.equal(aiKitHome(), home));
});

test("initHome scaffolds every home subdirectory", () => {
  withHome((home) => {
    const result = initHome();
    assert.equal(result.home, home);
    assert.deepEqual(result.created.sort(), [...HOME_SUBDIRS].sort());
    for (const name of HOME_SUBDIRS) assert.ok(existsSync(join(home, name)), `${name} not created`);
  });
});

test("resolvePluginPath prefers the project over the global home", () => {
  withHome((home) => {
    const project = mkdtempSync(join(tmpdir(), "proj-"));
    mkdirSync(join(project, ".ai", "plugins", "planner"), { recursive: true });
    mkdirSync(join(home, "plugins", "planner"), { recursive: true });
    writeFileSync(join(project, ".ai", "plugins", "planner", "shared.json"), "{}");
    writeFileSync(join(home, "plugins", "planner", "shared.json"), "{}");
    assert.equal(
      resolvePluginPath(project, "planner", "shared"),
      join(project, ".ai", "plugins", "planner", "shared.json"),
    );
  });
});

test("resolvePluginPath prefers .ai-work project plugins over legacy .ai plugins", () => {
  withHome((home) => {
    const project = mkdtempSync(join(tmpdir(), "proj-work-"));
    mkdirSync(join(project, ".ai-work", "plugins", "reviewer"), { recursive: true });
    mkdirSync(join(project, ".ai", "plugins", "reviewer"), { recursive: true });
    writeFileSync(join(project, ".ai-work", "plugins", "reviewer", "shared.json"), "work");
    writeFileSync(join(project, ".ai", "plugins", "reviewer", "shared.json"), "legacy");
    assert.equal(
      resolvePluginPath(project, "reviewer", "shared"),
      join(project, ".ai-work", "plugins", "reviewer", "shared.json"),
    );
  });
});

test("loadPlugin falls back to a plugin that only exists in the global home", () => {
  withHome((home) => {
    const dir = join(home, "plugins", "planner");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "global-only.json"),
      JSON.stringify({
        version: 1,
        id: "global-only",
        role: "planner",
        transport: "cli",
        command: ["node", "-e", "1"],
      }),
    );
    const plugin = loadPlugin("planner", "global-only");
    assert.equal(plugin.id, "global-only");
    assert.equal(plugin.command[0], "node");
  });
});
