import { strict as assert } from "node:assert";
import { test } from "node:test";
import { kitArray, kitScalar, testCommand } from "../.ai/node/config.js";

const SAMPLE = ["kit:", "  id: ai-kit", "  test_command: npm run test:ci", "project:", "  stack: [node, php]"].join(
  "\n",
);

test("kitScalar reads a key and preserves colons in the value", () => {
  assert.equal(kitScalar("id", SAMPLE), "ai-kit");
  assert.equal(kitScalar("test_command", SAMPLE), "npm run test:ci");
  assert.equal(kitScalar("missing", SAMPLE), undefined);
});

test("kitArray parses an inline array and empties on absence", () => {
  assert.deepEqual([...kitArray("stack", SAMPLE)].sort(), ["node", "php"]);
  assert.deepEqual([...kitArray("source_dirs", SAMPLE)], []);
});

test("testCommand reads the shipped kit.yaml", () => {
  // The repo's kit.yaml sets test_command: npm test
  assert.equal(testCommand(), "npm test");
});
