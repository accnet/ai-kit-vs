import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assembleContext, estimateTokens } from "../.ai/node/context.js";

test("estimateTokens is ~4 bytes per token", () => {
  assert.equal(estimateTokens(0), 0);
  assert.equal(estimateTokens(4), 1);
  assert.equal(estimateTokens(5), 2);
});

test("assembleContext ranks contract > role > plan > core skill > domain skill > file", () => {
  const sources = [
    ".ai-work/workflows/default/tasks/tasks.md",
    "src/app.ts",
    ".ai/skills/backend/nestjs-core/overview.md",
    ".ai/agents/backend",
    ".ai/engine/state-schema.md",
    ".ai/skills/core/api-contract/SKILL.md",
  ];
  const ctx = assembleContext(sources, 10_000_000);
  const order = ctx.included.map((s) => s.path);
  assert.equal(order[0], ".ai/engine/state-schema.md", "state schema must rank first");
  assert.equal(order[1], ".ai/agents/backend", "role contract second");
  assert.ok(
    order.indexOf(".ai/skills/core/api-contract/SKILL.md") <
      order.indexOf(".ai/skills/backend/nestjs-core/overview.md"),
  );
  assert.equal(order.at(-1), "src/app.ts", "task file ranks last");
});

test("assembleContext enforces the token budget but always keeps the top source", () => {
  const sources = [".ai/engine/state-schema.md", ".ai/skills/core/api-contract/SKILL.md", ".ai/agents/backend"];
  const ctx = assembleContext(sources, 1); // budget below any real file
  assert.equal(ctx.included.length, 1, "only the single highest-priority source fits");
  assert.equal(ctx.included[0].path, ".ai/engine/state-schema.md");
  assert.equal(ctx.skipped.length, 2);
  assert.equal(ctx.budget_tokens, 1);
});

test("assembleContext reports real token totals for shipped files", () => {
  const ctx = assembleContext([".ai/engine/state-schema.md"], 10_000_000);
  assert.ok(ctx.total_tokens > 0, "state-schema.md should have a nonzero token estimate");
  assert.equal(ctx.included[0].tokens, ctx.total_tokens);
});
