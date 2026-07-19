import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addMemory, listMemory, MemoryError, searchMemory } from "../.ai/node/memory.js";

test("addMemory writes a frontmatter markdown entry and lists it", () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  const entry = addMemory({ kind: "decision", title: "Use PostgreSQL", body: "chosen for JSONB" }, dir);
  assert.equal(entry.kind, "decision");
  assert.equal(entry.title, "Use PostgreSQL");
  assert.match(entry.path, /decisions\/.*use-postgresql\.md$/);

  const file = readFileSync(join(dir, "decisions", entry.path.split("/").at(-1)!), "utf8");
  assert.match(file, /^---\nkind: decision\ntitle: Use PostgreSQL\n/);

  const all = listMemory(undefined, dir);
  assert.equal(all.length, 1);
  assert.equal(all[0].title, "Use PostgreSQL");
});

test("listMemory filters by kind", () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  addMemory({ kind: "decision", title: "D1" }, dir);
  addMemory({ kind: "convention", title: "C1" }, dir);
  assert.deepEqual(
    listMemory("convention", dir).map((e) => e.title),
    ["C1"],
  );
});

test("searchMemory matches title and body", () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  addMemory({ kind: "postmortem", title: "Outage", body: "root cause was a deadlock" }, dir);
  addMemory({ kind: "note", title: "Unrelated", body: "nothing" }, dir);
  assert.equal(searchMemory("deadlock", dir).length, 1);
  assert.equal(searchMemory("Outage", dir).length, 1);
  assert.equal(searchMemory("nonexistent", dir).length, 0);
});

test("addMemory rejects an unknown kind", () => {
  const dir = mkdtempSync(join(tmpdir(), "mem-"));
  assert.throws(() => addMemory({ kind: "bogus" as never, title: "x" }, dir), MemoryError);
});
