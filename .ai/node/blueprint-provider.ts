import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { PROJECT_ROOT } from "./engine.js";
import { nestedScalar, readKit } from "./config.js";
import { SourceContext, SourceDocument, type SourceProvider, type SourceValidation } from "./source-provider.js";

export type BlueprintManifestDocument = { id: string; kind: string; path: string };
export type BlueprintManifest = { version: 1; root?: string; documents: BlueprintManifestDocument[] };

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function normalized(path: string) {
  return path.replaceAll("\\", "/");
}

function inside(parent: string, child: string) {
  const item = relative(parent, child);
  return item === "" || (item !== ".." && !item.startsWith("../") && !isAbsolute(item));
}

function safePath(root: string, child: string, label: string) {
  if (!child || isAbsolute(child)) throw new Error(`${label} must be a relative path`);
  const absolute = resolve(root, child);
  if (!inside(root, absolute)) throw new Error(`${label} escapes the Blueprint root`);
  if (existsSync(root) && existsSync(absolute) && !inside(realpathSync(root), realpathSync(absolute)))
    throw new Error(`${label} escapes the Blueprint root through a symlink`);
  return absolute;
}

function hash(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function metadata(path: string) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).slice(0, 40);
  const values: Record<string, string> = {};
  if (lines[0]?.trim() === "---") {
    for (const line of lines.slice(1)) {
      if (line.trim() === "---") break;
      const match = /^(\w[\w-]*):\s*(.*?)\s*$/.exec(line);
      if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return {
    title: values.title ?? lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, "") ?? null,
    status: values.status ?? "unclassified",
  };
}

function findMarkdown(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return findMarkdown(root, absolute);
    return entry.isFile() && entry.name.endsWith(".md") ? [normalized(relative(root, absolute))] : [];
  });
}

function documentInfo(document: BlueprintManifestDocument, root: string) {
  const absolute = safePath(root, document.path, `document ${document.id} path`);
  if (!existsSync(absolute) || !statSync(absolute).isFile())
    return SourceDocument.parse({
      id: document.id,
      kind: document.kind,
      path: normalized(relative(PROJECT_ROOT, absolute)),
      status: "missing",
      sha256: null,
      exists: false,
    });
  return SourceDocument.parse({
    id: document.id,
    kind: document.kind,
    path: normalized(relative(PROJECT_ROOT, absolute)),
    status: metadata(absolute).status,
    sha256: hash(absolute),
    exists: true,
  });
}

function loadManifest(manifestPath: string): { path: string; root: string; documents: BlueprintManifestDocument[] } {
  const path = resolve(PROJECT_ROOT, manifestPath);
  if (!existsSync(path)) throw new Error(`Blueprint manifest not found: ${path}`);
  let value: BlueprintManifest;
  try {
    value = JSON.parse(readFileSync(path, "utf8")) as BlueprintManifest;
  } catch (error) {
    throw new Error(`invalid Blueprint manifest: ${(error as Error).message}`);
  }
  if (value.version !== 1 || !Array.isArray(value.documents))
    throw new Error("Blueprint manifest requires version 1 and a documents array");
  const root = safePath(dirname(path), value.root ?? ".", "manifest root");
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const document of value.documents) {
    if (!document || !idPattern.test(document.id) || !document.kind || !document.path)
      throw new Error("Blueprint manifest contains an invalid document");
    if (ids.has(document.id)) throw new Error(`duplicate Blueprint document id: ${document.id}`);
    ids.add(document.id);
    const relativePath = normalized(relative(root, safePath(root, document.path, `document ${document.id} path`)));
    if (paths.has(relativePath)) throw new Error(`duplicate Blueprint document path: ${relativePath}`);
    paths.add(relativePath);
  }
  return {
    path,
    root,
    documents: value.documents.map((document) => ({ ...document, path: normalized(document.path) })),
  };
}

export class BlueprintProvider implements SourceProvider {
  readonly version = 1 as const;
  readonly id = "blueprint";
  private readonly manifest: ReturnType<typeof loadManifest>;

  constructor(manifestPath: string) {
    this.manifest = loadManifest(manifestPath);
  }

  discover() {
    return this.listDocuments();
  }

  listDocuments() {
    return this.manifest.documents.map((document) => documentInfo(document, this.manifest.root));
  }

  resolve(id: string) {
    const document = this.manifest.documents.find((item) => item.id === id);
    if (!document) throw new Error(`unknown Blueprint document: ${id}`);
    const result = documentInfo(document, this.manifest.root);
    if (!result.exists) throw new Error(`Blueprint document is missing: ${document.path}`);
    return result;
  }

  status() {
    const documents = this.listDocuments();
    const counts = documents.reduce<Record<string, number>>((result, document) => {
      result[document.status] = (result[document.status] ?? 0) + 1;
      return result;
    }, {});
    return { valid: documents.every((document) => document.exists), documents, counts };
  }

  validate(): SourceValidation {
    const documents = this.listDocuments();
    const indexed = new Set(this.manifest.documents.map((document) => normalized(document.path)));
    const discovered = findMarkdown(this.manifest.root).sort();
    const missing = documents.filter((document) => !document.exists).map((document) => document.path);
    const unindexed = discovered.filter((path) => !indexed.has(path));
    return { valid: missing.length === 0 && unindexed.length === 0, missing, unindexed, errors: [] };
  }
}

export function createBlueprintProvider(manifestPath: string) {
  return new BlueprintProvider(manifestPath);
}

export function configuredBlueprintProvider() {
  const source = readKit();
  const provider = nestedScalar(["knowledge", "provider"], source);
  if (provider !== "blueprint") return null;
  const manifest = nestedScalar(["knowledge", "manifest"], source) ?? "Blueprint/blueprint.json";
  return createBlueprintProvider(manifest);
}

export function resolveBlueprintReferences(references: string[]): SourceContext | undefined {
  if (!references.length) return undefined;
  const provider = configuredBlueprintProvider();
  if (!provider) throw new Error("Blueprint references require knowledge.provider: blueprint in project configuration");
  const documents = provider.listDocuments();
  const resolved = references.map((reference) => {
    const document = documents.find(
      (item) => item.id === reference || item.path === reference || item.path.endsWith(`/${reference}`),
    );
    if (!document) throw new Error(`unknown Blueprint reference: ${reference}`);
    if (!document.exists) throw new Error(`Blueprint document is missing: ${document.path}`);
    return { reference, ...document };
  });
  return SourceContext.parse({ provider: provider.id, references, resolved });
}

export function assertBlueprintContext(context?: SourceContext) {
  if (!context?.references.length) return;
  const provider = configuredBlueprintProvider();
  if (!provider) throw new Error("Blueprint provider is disabled while a task has Blueprint references");
  for (const item of context.resolved) {
    const current = provider.resolve(item.id);
    if (current.sha256 !== item.sha256) throw new Error(`Blueprint document drift detected: ${item.path}`);
  }
}
