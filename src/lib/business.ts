import { z } from "zod";
export const rfpKindLabels = {
  requirement: "RFP 명시 요구",
  standard: "관련 기준·의무",
  case: "과거 사례",
  inference: "분석·추론",
  unclear: "불명확한 범위",
} as const;
const chunkIds = z
  .array(z.uuid())
  .max(30)
  .refine((ids) => ids.length === new Set(ids).size);
export const rfpSectionInput = z
  .object({
    kind: z.enum(["requirement", "standard", "case", "inference", "unclear"]),
    title: z.string().trim().min(1).max(160),
    meaning: z.string().trim().min(1).max(4000),
    quote: z.string().trim().max(2000),
    chunkIds,
    questions: z.array(z.string().trim().min(1).max(1000)).max(8),
  })
  .strict();
export const rfpInput = z
  .object({
    sourceId: z.uuid(),
    title: z.string().trim().min(1).max(160),
    sections: z.array(rfpSectionInput).min(1).max(30),
    parentVersionId: z.uuid().nullable().default(null),
    basePublishedVersionId: z.uuid().nullable().default(null),
  })
  .strict();
export const rfpStateLabels: Record<string, string> = {
  draft: "초안",
  submitted: "검토 대기",
  approved: "검토 완료·게시",
  rejected: "수정 요청",
  withdrawn: "게시 철회",
  superseded: "이전 게시본",
};
export const officialStateLabels: Record<string, string> = {
  fetching: "원문 수집 중",
  captured: "원문 확보·확인 대기",
  verified: "원문·메타정보 확인",
  rejected: "후보 반려",
  failed: "수집 실패",
};
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
  );
