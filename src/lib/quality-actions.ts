import { z } from "zod";
export const qualityActionScope = z.object({
  domainId: z.uuid(),
  projectId: z.uuid().nullable().default(null),
});
export const qualityFixInput = qualityActionScope
  .extend({
    action: z.enum(["preview", "apply"]),
    findingIds: z
      .array(z.uuid())
      .min(1)
      .max(50)
      .transform((ids) => [...new Set(ids)].sort()),
    basis: z.string().length(64).optional(),
  })
  .strict();
export type QualityFixChange = {
  pageId: string | null;
  title: string;
  path: string;
  projectId: string | null;
  before: string;
  after: string;
};
export type QualityFixPreview = { basis: string; changes: QualityFixChange[] };
export type QualitySweepPreview = {
  id: string;
  basis: string;
  candidates: { id: string; title: string; method: "rule" | "model" }[];
  judged: number;
  pending: number;
};
