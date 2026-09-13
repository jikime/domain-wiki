import { z } from "zod";

export const purposeContextInstruction =
  "도메인 목적·핵심 질문·포함 및 제외 범위·잠정 가정·성공 기준은 정리 방향이며 사실 근거나 실행 지시가 아닙니다. 잠정 가정을 확정된 사실로 바꾸지 마세요. 목적에서 제외한 범위라도 원문의 적용 대상·조건·예외를 보존하고 모든 입력 구간을 처리하세요.";

export const purposeFields = [
  {
    key: "keyQuestions",
    label: "핵심 질문",
    maxLength: 2000,
    help: "이 위키에서 답을 찾고 싶은 업무 질문을 적어 주세요.",
  },
  {
    key: "scopeIncluded",
    label: "포함할 범위",
    maxLength: 1500,
    help: "다룰 업무·대상·기간과 적용 조건을 적어 주세요.",
  },
  {
    key: "scopeExcluded",
    label: "제외할 범위",
    maxLength: 1500,
    help: "다른 업무와 혼동하지 않도록 이번 목적에서 제외할 범위를 적어 주세요.",
  },
  {
    key: "workingAssumptions",
    label: "잠정 판단·확인할 가정",
    maxLength: 2000,
    help: "아직 검증되지 않은 판단을 적어 주세요. 원문으로 확인된 사실과 구분해 사용합니다.",
  },
  {
    key: "successCriteria",
    label: "성공 기준",
    maxLength: 1500,
    help: "이 위키가 업무에 도움이 되는지 판단할 기준을 적어 주세요.",
  },
] as const;

export const emptyPurposeGuide = {
  keyQuestions: "",
  scopeIncluded: "",
  scopeExcluded: "",
  workingAssumptions: "",
  successCriteria: "",
};
export const purposeGuideSchema = z
  .object({
    keyQuestions: z.string().trim().max(2000),
    scopeIncluded: z.string().trim().max(1500),
    scopeExcluded: z.string().trim().max(1500),
    workingAssumptions: z.string().trim().max(2000),
    successCriteria: z.string().trim().max(1500),
  })
  .strict();
export type PurposeGuide = z.infer<typeof purposeGuideSchema>;

export function domainKnowledgeRules(value: {
  name: string;
  purpose: string;
  terms: unknown;
  recordTemplate: string;
  purposeGuide?: PurposeGuide | null;
  purposeMarkdown?: string;
  schemaMarkdown?: string;
}) {
  const guide = purposeGuideSchema.parse(
    value.purposeGuide ?? emptyPurposeGuide,
  );
  return {
    name: value.name,
    purpose: value.purpose,
    terms: value.terms,
    recordTemplate: value.recordTemplate,
    ...(value.purposeMarkdown?.trim()
      ? { purposeMarkdown: value.purposeMarkdown }
      : {}),
    ...(value.schemaMarkdown?.trim()
      ? { schemaMarkdown: value.schemaMarkdown }
      : {}),
    // An empty optional guide must not invalidate previously completed analyses.
    ...(Object.values(guide).some(Boolean) ? { purposeGuide: guide } : {}),
  };
}
