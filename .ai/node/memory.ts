// Memory Engine — durable, human-readable project memory kept in `.ai-memory/`,
// separate from disposable session state in `.ai-work/`. Records decisions,
// conventions, and postmortems as markdown files with a small frontmatter block,
// and can list or search them at runtime.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { displayPath, now, PROJECT_ROOT } from "./engine.js";

export class MemoryError extends Error {}

// Shared kit memory is installer knowledge and must never enter a project's
// context bundle. Every project gets an independent memory namespace.
export const MEMORY_DIR = join(PROJECT_ROOT, ".ai-memory");
export const MEMORY_KINDS = ["decision", "convention", "postmortem", "note"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type MemoryEntry = { kind: string; title: string; date: string; path: string };

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "entry";

export function addMemory(
  input: { kind: MemoryKind; title: string; body?: string },
  dir: string = MEMORY_DIR,
): MemoryEntry {
  if (!MEMORY_KINDS.includes(input.kind)) throw new MemoryError(`kind must be one of: ${MEMORY_KINDS.join(", ")}`);
  if (!input.title?.trim()) throw new MemoryError("memory requires a title");
  const date = now();
  const kindDir = join(dir, `${input.kind}s`);
  mkdirSync(kindDir, { recursive: true });
  const file = join(kindDir, `${date.slice(0, 10)}-${slug(input.title)}.md`);
  writeFileSync(
    file,
    `---\nkind: ${input.kind}\ntitle: ${input.title}\ndate: ${date}\n---\n\n# ${input.title}\n\n${input.body ?? ""}\n`,
  );
  return { kind: input.kind, title: input.title, date, path: displayPath(file) };
}

type Parsed = MemoryEntry & { body: string };

function parseEntry(file: string, kindHint: string): Parsed {
  const text = readFileSync(file, "utf8");
  const meta: Record<string, string> = {};
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatter)
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) meta[match[1]] = match[2].trim();
    }
  const kind = meta.kind || kindHint;
  const title = meta.title || text.match(/^#\s+(.+)$/m)?.[1] || basename(file, ".md");
  const date =
    meta.date ||
    statSync(file)
      .mtime.toISOString()
      .replace(/\.\d{3}Z$/, "Z");
  return { kind, title, date, path: displayPath(file), body: text };
}

// Walk the memory tree and parse every markdown entry.
function collect(dir: string): Parsed[] {
  const out: Parsed[] = [];
  const walk = (current: string, kindHint: string) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full, entry.name.replace(/s$/, ""));
      else if (entry.name.endsWith(".md") && entry.name.toLowerCase() !== "readme.md")
        out.push(parseEntry(full, kindHint));
    }
  };
  walk(dir, "document");
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export function listMemory(kind?: MemoryKind, dir: string = MEMORY_DIR): MemoryEntry[] {
  return collect(dir)
    .filter((entry) => !kind || entry.kind === kind)
    .map(({ kind, title, date, path }) => ({ kind, title, date, path }));
}

export function searchMemory(query: string, dir: string = MEMORY_DIR): MemoryEntry[] {
  const needle = query.toLowerCase();
  return collect(dir)
    .filter((entry) => `${entry.title}\n${entry.body}`.toLowerCase().includes(needle))
    .map(({ kind, title, date, path }) => ({ kind, title, date, path }));
}

export const memoryExists = (dir: string = MEMORY_DIR): boolean => existsSync(dir);
