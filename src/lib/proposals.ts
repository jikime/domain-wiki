import { z } from "zod";
import { wikiMetadataSchema } from "./wiki-metadata";
export const testimonyFields = z
  .object({
    rawNote: z.string().trim().max(12000),
    situation: z.string().trim().min(1).max(5000),
    reasoning: z.string().trim().min(1).max(5000),
    result: z.string().trim().min(1).max(5000),
    followUp: z.string().trim().max(5000),
    chunkIds: z
      .array(z.uuid())
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
export const recordInput = testimonyFields
  .extend({
    title: z.string().trim().min(1).max(160),
    domainId: z.uuid(),
    projectId: z.uuid().nullable(),
  })
  .strict();
export const proposalItemInput = z
  .object({
    kind: z.enum(["new", "update", "merge", "conflict"]),
    pageId: z.uuid().nullable(),
    parentVersionId: z.uuid().nullable(),
    basePublishedVersionId: z.uuid().nullable(),
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(20000),
    chunkIds: z
      .array(z.uuid())
      .min(1)
      .max(30)
      .refine((ids) => new Set(ids).size === ids.length),
    reason: z.string().trim().min(1).max(2000),
    plannedPageId: z.uuid().optional(),
    metadata: wikiMetadataSchema.optional(),
    claimIds: z.array(z.string().min(1).max(120)).max(2000).optional(),
    questions: z.array(z.string().trim().min(1).max(1000)).max(100).optional(),
    requiresResolution: z.boolean().optional(),
    mergedPages: z.array(
      z
        .object({
          pageId: z.uuid(),
          publishedVersionId: z.uuid(),
          latestVersionId: z.uuid(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      (v.kind === "new" &&
        (v.pageId || v.parentVersionId || v.basePublishedVersionId)) ||
      (v.kind !== "new" && !v.pageId) ||
      (v.kind === "merge" ? !v.mergedPages.length : !!v.mergedPages.length)
    )
      ctx.addIssue({
        code: "custom",
        message: "제안 종류와 기준 위키를 확인하세요.",
      });
  });
export const batchInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    domainId: z.uuid(),
    projectId: z.uuid().nullable(),
    predecessorId: z.uuid().nullable().default(null),
    items: z.array(proposalItemInput).min(1),
  })
  .strict();
export const batchLabels = {
  draft: "초안",
  submitted: "검토 대기",
  approved: "승인·게시",
  rejected: "수정 요청",
};
export const proposalLabels = {
  new: "새 위키",
  update: "기존 위키 수정",
  merge: "위키 병합",
  conflict: "모순 확인 필요",
};
