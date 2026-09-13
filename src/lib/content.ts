import { z } from "zod";
import type { SourceLocator } from "@/server/db/schema";
import { wikiMetadataSchema } from "./wiki-metadata";
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const sourceCategories = {
  guideline: "지침·규정",
  project: "사업 자료",
  reference: "참고 자료",
  testimony: "작성자 진술",
} as const;
export const processingLabels = {
  queued: "처리 대기",
  processing: "문서 읽는 중",
  completed: "처리 완료",
  failed: "처리 실패",
  canceled: "처리 취소",
} as const;
export const publicationLabels = {
  pending: "공개 검토 대기",
  published: "공개",
  rejected: "반려",
  withdrawn: "공개 철회",
  superseded: "이전 버전",
} as const;
export const wikiLabels = {
  draft: "초안",
  submitted: "검토 대기",
  approved: "게시",
  rejected: "반려",
  withdrawn: "게시 철회",
  superseded: "이전 게시본",
} as const;
export function locatorLabel(locator: SourceLocator) {
  if (locator.kind === "spreadsheet")
    return `${locator.sheet} · ${locator.row}행`;
  if (locator.kind === "document")
    return `${locator.format.toUpperCase()} · ${locator.section ?? "본문"} · 블록 ${locator.block}${locator.table ? ` · 표 ${locator.table}` : ""}${locator.row ? ` · ${locator.row}행` : ""}`;
  if (locator.kind === "image")
    return `${locator.page ? `${locator.page}쪽 · ` : ""}이미지 ${locator.image}`;
  if (locator.kind === "lines")
    return `${locator.startLine}~${locator.endLine}행${locator.heading ? ` · ${locator.heading}` : ""}`;
  const table = locator.table
    ? ` · 표 ${locator.table}${locator.row ? ` · ${locator.row}행` : ""}`
    : "";
  if (locator.kind === "html")
    return `웹 원문 · 문단 ${locator.block}${locator.heading ? ` · ${locator.heading}` : ""}${table}`;
  if (locator.kind === "pdf") return `${locator.page}쪽${table}`;
  if (locator.kind === "docx")
    return `${locator.section} · 블록 ${locator.block}${table}`;
  return `슬라이드 ${locator.slide} · ${locator.section === "notes" ? "발표자 노트" : "본문"}${locator.shapeId ? ` · 도형 ${locator.shapeId}` : ""}${locator.paragraph ? ` · 문단 ${locator.paragraph}` : ""}${table}${locator.x !== undefined && locator.y !== undefined ? ` · 위치 ${locator.x}, ${locator.y} EMU` : ""}`;
}
export const sourceInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    domainId: z.uuid(),
    projectId: z.uuid().nullable(),
    category: z.enum(["guideline", "project", "reference", "testimony"]),
  })
  .strict();
export const wikiInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    body: z.string().max(40_000),
    classification: wikiMetadataSchema
      .pick({ type: true, aliases: true })
      .optional(),
    domainId: z.uuid(),
    projectId: z.uuid().nullable(),
    parentVersionId: z.uuid().nullable(),
    basePublishedVersionId: z.uuid().nullable(),
    chunkIds: z
      .array(z.uuid())
      .max(30)
      .refine((ids) => ids.length === new Set(ids).size),
  })
  .strict();
export const reviewInput = z
  .object({
    action: z.enum([
      "approve",
      "reject",
      "withdraw",
      "submit",
      "retry",
      "cancel",
    ]),
    note: z.string().trim().max(2000).default(""),
  })
  .strict();
