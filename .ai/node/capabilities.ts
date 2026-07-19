// Capability manifests — a thin packaging layer over the existing Agents and
// Skills. A capability does NOT move or replace `.ai/agents` or `.ai/skills`
// (those remain the source of truth). It only *references* them by name so a
// bundle of role + curated knowledge can be named, versioned, and validated as
// a unit. Manifests live in `.ai/capabilities/<id>.json`.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { displayPath, ROOT } from "./engine.js";

export class CapabilityError extends Error {}

const DIR = join(ROOT, ".ai", "capabilities");
const AGENTS = join(ROOT, ".ai", "agents");
const SKILLS = join(ROOT, ".ai", "skills");

export const CapabilityManifest = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  kind: z.enum(["knowledge", "framework", "language", "tool"]),
  description: z.string().optional(),
  // Agents referenced by role directory name under .ai/agents/.
  agents: z.array(z.string().min(1)).default([]),
  // Skills referenced as "<domain>/<technology>" or "core/<name>".
  skills: z.array(z.string().min(1)).default([]),
});
export type CapabilityManifest = z.infer<typeof CapabilityManifest>;

// A skill reference resolves to whichever entry file exists:
//   <domain>/<tech>/overview.md   (curated technology knowledge)
//   core/<name>/SKILL.md          (core skill)
function resolveSkill(reference: string): string | null {
  for (const candidate of [join(SKILLS, reference, "overview.md"), join(SKILLS, reference, "SKILL.md")])
    if (existsSync(candidate)) return candidate;
  return null;
}

export function loadCapability(id: string): CapabilityManifest {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) throw new CapabilityError("invalid capability id");
  const path = join(DIR, `${id}.json`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CapabilityError(`capability not found: ${id}`);
  }
  const parsed = CapabilityManifest.safeParse(raw);
  if (!parsed.success)
    throw new CapabilityError(
      `invalid capability manifest ${id}: ${parsed.error.issues[0]?.message ?? "schema error"}`,
    );
  if (parsed.data.id !== id) throw new CapabilityError(`capability id mismatch: ${id} vs ${parsed.data.id}`);
  return parsed.data;
}

export type ResolvedCapability = {
  id: string;
  kind: string;
  description?: string;
  agents: string[]; // resolved role-contract paths (.ai/agents/<role>)
  skills: string[]; // resolved skill entry paths
  missing: { agents: string[]; skills: string[] };
};

// Resolve references to real paths and report anything that does not exist, so a
// capability can never silently point at missing knowledge.
export function resolveCapability(id: string): ResolvedCapability {
  const manifest = loadCapability(id);
  const agents: string[] = [];
  const skills: string[] = [];
  const missing = { agents: [] as string[], skills: [] as string[] };
  for (const agent of manifest.agents) {
    const dir = join(AGENTS, agent);
    if (existsSync(join(dir, "role.md")) || existsSync(dir)) agents.push(displayPath(dir));
    else missing.agents.push(agent);
  }
  for (const skill of manifest.skills) {
    const resolved = resolveSkill(skill);
    if (resolved) skills.push(displayPath(resolved));
    else missing.skills.push(skill);
  }
  return { id, kind: manifest.kind, description: manifest.description, agents, skills, missing };
}

export function listCapabilities(kind?: CapabilityManifest["kind"]): CapabilityManifest[] {
  let entries: string[];
  try {
    entries = readdirSync(DIR).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  return entries
    .map((name) => loadCapability(name.slice(0, -5)))
    .filter((manifest) => !kind || manifest.kind === kind)
    .sort((a, b) => a.id.localeCompare(b.id));
}

// True when every referenced agent and skill resolves.
export const capabilityComplete = (id: string): boolean => {
  const resolved = resolveCapability(id);
  return resolved.missing.agents.length === 0 && resolved.missing.skills.length === 0;
};
