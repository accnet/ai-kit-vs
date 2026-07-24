import { z } from "zod";

// Source providers expose durable project knowledge to AI-Kit without owning
// workflow state. Providers may be backed by Blueprint, docs/, or another
// project-local canonical source.
export const SourceProviderId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
export const SourceDocumentId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const SourceDocument = z.object({
  id: SourceDocumentId,
  kind: z.string().min(1),
  path: z.string().min(1),
  status: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  exists: z.boolean(),
});
export type SourceDocument = z.infer<typeof SourceDocument>;

export const SourceValidation = z.object({
  valid: z.boolean(),
  missing: z.array(z.string()),
  unindexed: z.array(z.string()),
  errors: z.array(z.string()).default([]),
});
export type SourceValidation = z.infer<typeof SourceValidation>;

export type SourceProviderConfig = {
  provider: string;
  root?: string;
  manifest?: string;
};

export const SourceContext = z.object({
  provider: SourceProviderId,
  references: z.array(z.string().min(1)),
  resolved: z.array(
    SourceDocument.pick({ id: true, kind: true, path: true, status: true, sha256: true }).extend({
      reference: z.string().min(1),
    }),
  ),
});
export type SourceContext = z.infer<typeof SourceContext>;

export interface SourceProvider {
  readonly version: 1;
  readonly id: string;
  discover(): SourceDocument[];
  listDocuments(): SourceDocument[];
  resolve(id: string): SourceDocument;
  status(): { valid: boolean; documents: SourceDocument[]; counts: Record<string, number> };
  validate(): SourceValidation;
}

export function parseSourceDocument(value: unknown): SourceDocument {
  return SourceDocument.parse(value);
}

export function parseSourceValidation(value: unknown): SourceValidation {
  return SourceValidation.parse(value);
}
