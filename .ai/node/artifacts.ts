import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { displayPath, WORK } from "./engine.js";

export class ArtifactError extends Error {}
export const PluginRole = z.enum(["planner", "executor", "qa", "reviewer"]);
export type PluginRole = z.infer<typeof PluginRole>;

const base = z.object({ version: z.literal(1), kind: z.string(), workflow_id: z.string(), actor: z.string().min(1) });
export const ResultArtifact = base.extend({
  kind: z.literal("result"),
  task: z.string(),
  attempt_id: z.string(),
  status: z.enum(["pass", "fail"]),
  summary: z.string().min(1),
  changed_paths: z.array(z.string()).default([]),
  commands: z.array(z.string()).default([]),
  // Provider adapters may not have a checked-out branch (for example Codex
  // can emit an explicit null), so preserve both forms as valid metadata.
  branch: z.string().nullable().optional(),
});
export const QaArtifact = base.extend({
  kind: z.literal("qa"),
  task: z.string(),
  status: z.enum(["pass", "fail"]),
  summary: z.string().min(1),
  commands: z.array(z.string()).default([]),
});
export const ReviewArtifact = base.extend({
  kind: z.literal("review"),
  task: z.string(),
  verdict: z.enum(["approve", "changes-requested"]),
  notes: z.string(),
});
export const PlanArtifact = base.extend({
  kind: z.literal("plan"),
  goal: z.string().min(1),
  tasks: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      owner: z.string().min(1),
      phase: z.string().min(1),
      needs: z.array(z.string()).default([]),
      acceptance: z.array(z.string().min(1)).min(1),
      files: z.array(z.string()).default([]),
      tags: z.array(z.string()).default([]),
    }),
  ),
});
export const AssignmentArtifact = base.extend({
  kind: z.literal("assignment"),
  role: PluginRole,
  task: z.string().optional(),
  attempt_id: z.string().optional(),
  input: z.record(z.string(), z.unknown()),
});
export type ResultOutput = z.infer<typeof ResultArtifact>;
export type QaOutput = z.infer<typeof QaArtifact>;
export type ReviewOutput = z.infer<typeof ReviewArtifact>;
export type PlanOutput = z.infer<typeof PlanArtifact>;

// The context manifest written per claim: the Router route, hashed sources, and
// the Context Engine's ranked, token-budgeted selection. Standardized like every
// other artifact in .ai-work.
export const ContextManifest = z.object({
  version: z.literal(1),
  task: z.string(),
  attempt_id: z.string(),
  route: z.record(z.string(), z.unknown()),
  sources: z.array(z.object({ path: z.string(), sha256: z.string().nullable() })),
  context: z.object({
    budget_tokens: z.number(),
    total_tokens: z.number(),
    included: z.array(z.object({ path: z.string(), tokens: z.number() })),
    skipped: z.array(z.object({ path: z.string(), tokens: z.number() })),
  }),
  // The Context Builder's multi-source gather (Workspace/Git/Architecture/
  // Requirement/Memory) that produced the ranked selection above.
  bundle: z.object({
    workspace: z.array(z.string()),
    git: z.object({ branch: z.string().nullable(), changed: z.array(z.string()) }),
    architecture: z.array(z.string()),
    requirement: z.object({ acceptance: z.array(z.string()), docs: z.array(z.string()) }),
    memory: z.array(z.object({ kind: z.string(), title: z.string(), path: z.string() })),
  }),
  completion: z.object({
    required_action: z.literal("ai-kit agent result"),
    reminder: z.string().min(1),
  }),
  git_status: z.array(z.string()),
  generated_at: z.string(),
});
export type ContextManifest = z.infer<typeof ContextManifest>;
export function parseContextManifest(value: unknown): ContextManifest {
  const result = ContextManifest.safeParse(value);
  if (!result.success)
    throw new ArtifactError(`context manifest is invalid: ${result.error.issues[0]?.message ?? "schema error"}`);
  return result.data;
}

const schemas = {
  result: ResultArtifact,
  qa: QaArtifact,
  review: ReviewArtifact,
  plan: PlanArtifact,
  assignment: AssignmentArtifact,
};
export type ArtifactKind = keyof typeof schemas;
export type Artifact = z.infer<(typeof schemas)[ArtifactKind]>;

export function parseArtifact(kind: ArtifactKind, value: unknown) {
  const result = schemas[kind].safeParse(value);
  if (!result.success)
    throw new ArtifactError(`${kind} artifact is invalid: ${result.error.issues[0]?.message ?? "schema error"}`);
  return result.data;
}

export function readArtifact(path: string, kind: ArtifactKind) {
  if (!existsSync(path)) throw new ArtifactError(`artifact not found: ${path}`);
  try {
    return parseArtifact(kind, JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    throw new ArtifactError(`invalid JSON artifact: ${path}`);
  }
}

export const workflowRoot = (workflowId: string) => join(WORK, "workflows", workflowId);
export const artifactDirectory = (workflowId: string, kind: ArtifactKind) =>
  join(workflowRoot(workflowId), "artifacts", kind);
export const artifactPath = (workflowId: string, kind: ArtifactKind, name: string) =>
  join(artifactDirectory(workflowId, kind), `${name}.json`);
export const displayArtifactPath = (path: string) => displayPath(path);

export function managedArtifactPath(workflowId: string, path: string) {
  const root = resolve(workflowRoot(workflowId));
  const item = relative(root, resolve(path));
  return !item.startsWith("..") && !isAbsolute(item);
}

export function writeArtifact(path: string, kind: ArtifactKind, value: unknown) {
  const payload = parseArtifact(kind, value);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(temporary, path);
  return path;
}
