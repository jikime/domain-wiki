// Adapted from llm_wiki src/lib/ingest.ts generation contract, Git 8bcf9b5.
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
// File output is replaced by validated DB page plans and evidence-backed sections.
import { z } from "zod";
import { validateClaimBindings } from "./claim-grounding";
import { analysisClaimSchema, messageChars } from "./document-analysis";
import { purposeContextInstruction } from "./domain-purpose";
import { markdownReferences } from "./wiki-links";
import { type WikiMetadata, wikiTypeSchema } from "./wiki-metadata";
import { validateTopicIdentity } from "./wiki-topic";

export const WIKI_GENERATION_PROMPT_VERSION = "wiki-generation-v10-topic-scope";
const uniqueStrings = (max: number) =>
  z
    .array(z.string().min(1).max(120))
    .max(max)
    .refine((values) => new Set(values).size === values.length);
export const generationClaimSchema = analysisClaimSchema.extend({
  id: z.string().min(1),
  unitId: z.string().min(1),
});
export type GenerationClaim = z.infer<typeof generationClaimSchema>;
export const generationAnalysisSchema = z.object({
  summaries: z.array(z.object({ unitId: z.string(), text: z.string() })),
  claims: z.array(generationClaimSchema),
  comparisons: z.array(
    z.object({ claimIds: z.array(z.string()), reason: z.string() }),
  ),
  questions: z.array(z.string()),
  dispositions: z.array(
    z.object({
      partId: z.string(),
      status: z.enum(["analyzed", "no_facts"]),
      reason: z.string(),
      unitId: z.string(),
    }),
  ),
  coverage: z.object({
    totalChunks: z.number(),
    processedChunks: z.number(),
    totalUnits: z.number(),
    processedUnits: z.number(),
    totalParts: z.number(),
    processedParts: z.number(),
    totalChars: z.number(),
    processedChars: z.number(),
    excluded: z.array(z.object({ chunkId: z.uuid(), reason: z.string() })),
  }),
  warnings: z.array(z.string()),
});
export type GenerationAnalysis = z.infer<typeof generationAnalysisSchema>;
export type WikiCandidate = {
  pageId: string;
  publishedVersionId: string;
  latestVersionId: string;
  projectId: string | null;
  title: string;
  body: string;
  chunkIds: string[];
  sourceIds?: string[];
  metadata: WikiMetadata;
  score: number;
  revision?: {
    sourceId: string;
    previousChunkIds: string[];
    mappings: { previousId: string; currentId: string }[];
    unresolvedChunkIds: string[];
  };
  reusable?: {
    taskId: string;
    stepId: string;
    rootStepId: string;
    body: string;
    claims: GenerationClaim[];
    sections: GeneratedSections;
  };
};
export type GenerationEvidence = {
  id: string;
  sourceId: string;
  versionId: string;
  title: string;
  text: string;
  locator: Record<string, unknown>;
};
const pagePlanSchema = z
  .object({
    key: z.string().regex(/^page-[1-9]\d{0,2}$/),
    kind: z.enum(["new", "update", "merge", "conflict"]),
    type: wikiTypeSchema,
    title: z.string().trim().min(1).max(160),
    subject: z.string().trim().min(1).max(200),
    scope: z.string().trim().min(1).max(600),
    pageId: z.uuid().nullable(),
    mergedPageIds: z.array(z.uuid()),
    claimIds: uniqueStrings(2000).refine((ids) => ids.length > 0),
    aliases: z.array(z.string().trim().min(1).max(100)).max(20),
    links: z
      .array(
        z
          .object({
            key: z.string().min(1).max(80),
            reason: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(500),
    reason: z.string().trim().min(1).max(2000),
    questions: z.array(z.string().trim().min(1).max(1000)).max(30),
  })
  .strict();
export const wikiPlanSchema = z
  .object({
    summary: z.string().trim().min(1).max(4000),
    pages: z.array(pagePlanSchema).min(1),
    questions: z.array(z.string().trim().min(1).max(1000)).max(100),
  })
  .strict();
export type WikiPagePlan = z.infer<typeof pagePlanSchema>;
export type WikiPlan = z.infer<typeof wikiPlanSchema>;
export type PlannedWikiPage = WikiPagePlan & { plannedPageId: string };
export type GenerationGroup = {
  ordinal: number;
  pageKeys: string[];
  dependencies: number[];
};
export type GenerationPlan = Omit<WikiPlan, "pages"> & {
  pages: PlannedWikiPage[];
  groups: GenerationGroup[];
};

export const wikiPlanPrompt = [
  "여러 위키 변경 계획. 완료된 문서 분석을 현재 공개된 위키·원문과 비교하세요. 한국어 JSON만 반환하고 사고 과정·파일 경로·FILE 블록을 출력하지 마세요.",
  purposeContextInstruction,
  "분석의 모든 claim을 적어도 하나의 문서 요약(type=source) 페이지에 배정하세요. 문서 끝·표·각주·조건을 누락하지 마세요. 출처 요약 외에도 독립적으로 쓸 가치가 있는 대상·개념·절차·사례 페이지를 제안하세요. 근거 없는 페이지 수 늘리기는 금지합니다.",
  "기존 위키 metadata.subject와 metadata.scope는 페이지의 대상·정리 범위입니다. 본문에 현재 한 종류의 사례만 있어도 정리 범위에 다른 대상·예외가 포함되어 있다면 그 범위 안에서 기존 위키를 보완하세요. 주 화면과 보조 화면처럼 서로 다른 대상의 수치는 구분한 단락·표로 보존할 수 있으며, 같은 페이지에 정리하는 것과 같은 조건으로 일반화하는 것은 다릅니다. 정리 범위는 작성 기준이며 사실 근거가 아닙니다. 기존 정리 범위를 새 자료만으로 임의로 확대하지 마세요.",
  "새 자료마다 같은 주제의 페이지를 복제하지 마세요. 기존 제목·별칭과 겹치는 비문서요약 페이지는 대상·적용 범위를 먼저 대조하고, 동일하면 기존 pageId의 update/conflict로 연결하세요. 다른 대상이면 구분되는 제목을 사용하세요. 문서 요약은 원문별로 별도 유지합니다.",
  "제목이나 공통 단어만으로 같은 대상을 확정하지 마세요. 각 페이지의 subject와 scope에 정확한 대상·적용 범위를 적고, 기존 위키와 동일한 대상인지 reason에서 설명하세요. 서로 다른 대상·사업의 수치·부정·예외를 합치지 마세요.",
  '모든 페이지에는 kind와 type 두 필드를 각각 반드시 작성하세요. kind는 변경 작업(new/update/merge/conflict), type은 지식 분류입니다. 새 절차 페이지는 {"kind":"new","type":"procedure"}이며 kind에 procedure를 넣거나 type을 생략하면 실패합니다.',
  "kind=new는 pageId=null, update/merge/conflict는 제공된 수정 가능한 기존 pageId가 필요합니다. merge에서만 mergedPageIds를 사용하며 같은 범위·같은 대상인지 비교하세요. 같은 페이지를 두 번 수정하거나 병합할 수 없습니다. 모순 가능성이 있으면 conflict로 분리하고 questions에 확인할 조건을 적으세요.",
  "기존 위키 보완·병합은 현재 본문을 보존하면서 근거 있는 단락을 추가합니다. 기존 문장을 삭제·대체해야 하는 제안은 conflict로 표시해 검토자가 수정하게 하세요. 공통 프로젝트(null)의 위키는 특정 프로젝트에서 참고할 수 있으나 다른 범위의 위키를 수정할 수 없습니다.",
  "페이지 key는 page-1, page-2처럼 유일한 번호입니다. links는 이 계획의 key 또는 제공된 기존 위키의 wiki:<pageId>만 사용하세요. 링크는 관련 보기이며 사실 근거가 아닙니다. 원문 근거는 claimIds에서 서버가 연결합니다.",
  "관련 페이지가 서로 참조할 수 있습니다. 순환 참조하는 페이지는 한 검토 묶음에서 함께 게시하며 페이지 수 때문에 관계를 생략하지 마세요.",
  '형식: {summary:"이 문서에서 만들고 보완할 지식",pages:[{key:"page-1",kind:"new",type:"source",title:"...",subject:"정확한 대상",scope:"적용 범위",pageId:null,mergedPageIds:[],claimIds:["제공된 분석 ID"],aliases:[],links:[{key:"page-2",reason:"함께 확인할 이유"}],reason:"신규 또는 보완 이유",questions:[]}],questions:[]}. type은 도메인 schemaMarkdown의 Page Types에 정의된 유형을 우선 사용하세요. 기본 유형은 source/entity/concept/comparison/query/synthesis/thesis/methodology/finding/procedure/case/other입니다. 출력에 없는 ID는 만들지 마세요.',
  `반환 JSON 구조: ${JSON.stringify(z.toJSONSchema(wikiPlanSchema))}`,
].join("\n");
export const wikiPagePrompt = [
  "위키 단락 생성. 제공된 페이지 계획과 검증된 분석 주장만 이용해 한국어 JSON을 작성하세요. 사고 과정은 출력하지 마세요.",
  purposeContextInstruction,
  "현재 페이지에 배정된 모든 claimId를 sections의 claimIds에 적어도 한 번 사용하세요. 각 단락은 해당 ID의 원문 구절에 근거해야 하며 수치·단위·대상·부정·예외·불확실성을 보존하세요. 입력의 명시적 value·unit·condition은 정확한 문자열로 남기세요. 인용 구절에 없는 새 수치나 의무를 만들지 마세요.",
  "각 단락에서 인용한 모든 claim의 subject를 그 단락 heading 또는 content에 정확한 문자열로 포함하세요. 페이지 제목이나 앞 단락에만 대상이 있으면 부족합니다. 긴 문서 이름을 ‘이 지침’으로 줄이는 대신 정확한 이름을 단락 제목에 적고, 별도 claim의 subject가 ‘이 지침’이면 본문에도 그대로 남기세요. 원문 근거를 벗어나는 설명을 추가하지 마세요.",
  "수치가 있는 주장은 대상·값·단위·적용 조건을 같은 문장 또는 같은 표의 행에 적으세요. 여러 대상의 수치를 각각이라고 묶거나 다른 문장에 흩어 쓰지 마세요. 표의 수치 셀에도 단위를 명시하세요.",
  "sections.content는 마크다운 단락·목록·표·코드 블록을 쓸 수 있습니다. 표·SQL·설정의 정확한 구조를 원문대로 보존하세요. 링크·이미지·HTML·frontmatter·FILE 블록을 만들지 마세요. 위키 링크와 원문 근거는 서버가 별도로 붙입니다.",
  "sections는 이 페이지에 배정된 모든 현재 claim을 재구성한 근거 단락입니다. 기존 본문과 내용이 겹쳐도 해당 claim을 생략하지 마세요. new/update/merge/conflict 모두 같은 규칙이며 conflict=true여도 모든 claim을 포함한 하나 이상의 sections가 필요합니다. 변경된 사실만 쓰거나 빈 sections를 반환하면 실패합니다.",
  "existingWiki와 mergedWikis는 중복·모순 비교용입니다. 기존 본문과 새 사실의 통합 병합은 다음 단계에서 처리하므로 기존 본문을 sections로 복사하지 마세요. 현재 claims를 모두 사용해 단락을 작성하세요. 기존 문장을 삭제·교체하거나 조건이 모순되면 conflict=true와 questions에 이유를 적으세요. 임시 가정은 사실로 적지 마세요.",
  "개정 전 본문의 수치·조건을 비교 설명하더라도 현재 claim 근거에 없으면 sections의 heading·content에 넣지 마세요. 예를 들어 현재 근거가 45일이고 이전 본문이 30일이면 sections에는 현재의 45일만 쓰고, 30일에서 45일로 바뀌었다는 비교는 questions에만 적으세요. 개정 전 본문 보존·대조는 서버가 별도로 처리합니다.",
  '형식: {sections:[{heading:"단락 제목",content:"근거 있는 마크다운 본문",claimIds:["이번 페이지의 분석 ID"]}],conflict:false,questions:[]}. 각 단락 heading은 160자 이하, content는 12000자 이하. sections 최대 40개. 하나 이상의 근거가 없는 단락은 만들지 마세요.',
].join("\n");
export function generationMessages(prompt: string, payload: unknown) {
  return [
    { role: "system" as const, content: prompt },
    { role: "user" as const, content: JSON.stringify(payload) },
  ];
}
export function generationInputLimit(contextChars: number) {
  return Math.floor(contextChars * 0.85);
}
export class GenerationBudgetError extends Error {}
export function assertGenerationBudget(
  messages: { content: string }[],
  contextChars: number,
) {
  if (messageChars(messages) > generationInputLimit(contextChars))
    throw new GenerationBudgetError(
      "전체 분석과 기존 지식을 포함할 생성 입력 공간이 부족합니다. 지식 생성 입력 상한을 늘려 새 작업을 시작해 주세요. 내용을 잘라 생성하지 않았습니다.",
    );
}
export function validateWikiPlan(
  value: unknown,
  analysis: GenerationAnalysis,
  candidates: WikiCandidate[],
  projectId: string | null,
) {
  const plan = wikiPlanSchema.parse(value);
  for (const previous of candidates.filter(
    (c) => c.revision?.previousChunkIds.length,
  )) {
    if (
      !plan.pages.some(
        (p) => p.pageId === previous.pageId && p.kind !== "merge",
      )
    )
      throw new Error(
        "개정 전 위키는 같은 페이지 주소의 수정안으로 연결해야 합니다. 이전 위키를 누락하거나 새 페이지로 복제할 수 없습니다.",
      );
    if (plan.pages.some((p) => p.mergedPageIds.includes(previous.pageId)))
      throw new Error(
        "근거를 갱신하는 개정 전 위키는 먼저 수정·검토한 뒤 병합해 주세요.",
      );
  }
  const claims = new Set(analysis.claims.map((c) => c.id));
  const keys = new Set(plan.pages.map((p) => p.key));
  if (keys.size !== plan.pages.length)
    throw new Error("페이지 계획의 식별자가 중복되었습니다.");
  const usedTargets = new Set<string>();
  const summaryClaims = new Set<string>();
  const linkedExisting = new Map(
    candidates.map((c) => [`wiki:${c.pageId}`, c]),
  );
  for (const page of plan.pages) {
    const seen = new Map<string, string>();
    const originalKeys = new Set<string>();
    page.links = page.links.flatMap((link) => {
      const original = link.key;
      if (originalKeys.has(original))
        throw new Error("페이지 계획에 같은 표기의 중복 위키 링크가 있습니다.");
      originalKeys.add(original);
      if (link.key.startsWith("wiki:")) {
        const changed = plan.pages.find((p) => p.pageId === link.key.slice(5));
        if (changed) link.key = changed.key;
      }
      const previous = seen.get(link.key);
      // The existing UUID and this plan's key can denote the same destination.
      // Collapse only those equivalent spellings, not raw duplicate/unknown links.
      if (previous !== undefined && previous !== original) return [];
      seen.set(link.key, original);
      return [link];
    });
  }
  for (const page of plan.pages) {
    if (page.claimIds.some((id) => !claims.has(id)))
      throw new Error("제공되지 않은 분석 근거를 사용한 페이지 계획입니다.");
    if (page.type === "source")
      for (const id of page.claimIds) summaryClaims.add(id);
    if (
      (page.kind === "new") !== (page.pageId === null) ||
      (page.kind === "merge"
        ? !page.mergedPageIds.length
        : !!page.mergedPageIds.length)
    )
      throw new Error("페이지 종류와 기존 대상이 일치하지 않습니다.");
    for (const id of [
      ...(page.pageId ? [page.pageId] : []),
      ...page.mergedPageIds,
    ]) {
      const target = candidates.find((c) => c.pageId === id);
      if (!target || target.projectId !== projectId)
        throw new Error("같은 범위의 공개 위키만 수정·병합할 수 있습니다.");
      if (usedTargets.has(id))
        throw new Error("같은 위키를 여러 페이지 계획에서 변경할 수 없습니다.");
      usedTargets.add(id);
    }
    const links = new Set<string>();
    for (const link of page.links) {
      if (
        link.key === page.key ||
        links.has(link.key) ||
        (!keys.has(link.key) && !linkedExisting.has(link.key))
      )
        throw new Error(
          "페이지 계획에 중복·자기 참조 또는 존재하지 않는 위키 링크가 있습니다.",
        );
      links.add(link.key);
    }
  }
  if (!claims.size || [...claims].some((id) => !summaryClaims.has(id)))
    throw new Error("문서 요약 계획에 전체 분석 근거가 포함되지 않았습니다.");
  validateTopicIdentity(plan.pages, candidates, projectId);
  groupWikiPlans(plan.pages);
  return plan;
}

// Strongly connected pages must be approved together. Pack the resulting DAG
// in dependency order; never resolve a cycle by exposing unapproved pages.
export function groupWikiPlans(
  pages: Pick<WikiPagePlan, "key" | "links">[],
): GenerationGroup[] {
  const map = new Map(pages.map((p) => [p.key, p]));
  const indexes = new Map<string, number>(),
    low = new Map<string, number>();
  const stack: string[] = [],
    active = new Set<string>(),
    components: string[][] = [];
  let index = 0;
  const required = (values: Map<string, number>, key: string) => {
    const result = values.get(key);
    if (result === undefined)
      throw new Error("관계 순서를 확인하지 못했습니다.");
    return result;
  };
  const visit = (key: string) => {
    indexes.set(key, index);
    low.set(key, index++);
    stack.push(key);
    active.add(key);
    for (const link of map.get(key)?.links ?? []) {
      if (!map.has(link.key)) continue;
      if (!indexes.has(link.key)) {
        visit(link.key);
        low.set(key, Math.min(required(low, key), required(low, link.key)));
      } else if (active.has(link.key))
        low.set(key, Math.min(required(low, key), required(indexes, link.key)));
    }
    if (low.get(key) === indexes.get(key)) {
      const members: string[] = [];
      let current: string;
      do {
        const popped = stack.pop();
        if (popped === undefined)
          throw new Error("순환 관계를 확인하지 못했습니다.");
        current = popped;
        active.delete(current);
        members.push(current);
      } while (current !== key);
      components.push(
        members.sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))),
      );
    }
  };
  for (const page of pages) if (!indexes.has(page.key)) visit(page.key);
  const groups: GenerationGroup[] = [];
  for (const component of components) {
    let group = groups.at(-1);
    if (!group || group.pageKeys.length + component.length > 5) {
      group = { ordinal: groups.length + 1, pageKeys: [], dependencies: [] };
      groups.push(group);
    }
    group.pageKeys.push(...component);
  }
  const byKey = new Map(
    groups.flatMap((g) => g.pageKeys.map((key) => [key, g.ordinal] as const)),
  );
  for (const group of groups)
    group.dependencies = [
      ...new Set(
        group.pageKeys.flatMap((key) =>
          (map.get(key)?.links ?? []).flatMap((link) => {
            const target = byKey.get(link.key);
            return target && target !== group.ordinal ? [target] : [];
          }),
        ),
      ),
    ].sort((a, b) => a - b);
  if (groups.some((g) => g.dependencies.some((n) => n >= g.ordinal)))
    throw new Error("검토 묶음의 의존 순서를 구성하지 못했습니다.");
  return groups;
}
export const generatedSectionsSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            heading: z.string().trim().min(1).max(160),
            content: z.string().trim().min(1).max(12000),
            claimIds: uniqueStrings(2000).refine((ids) => ids.length > 0),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    conflict: z.boolean(),
    questions: z.array(z.string().trim().min(1).max(1000)).max(100),
  })
  .strict();
export type GeneratedSections = z.infer<typeof generatedSectionsSchema>;
const numbers = (text: string) =>
  text.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "").match(/\d+(?:\.\d+)?/g) ?? [];
const numericUnits = (text: string) =>
  [
    ...text.matchAll(
      /(\d+(?:\.\d+)?)\s*(밀리초|초|분|시간|일|주|개월|년|킬로미터|미터|센티미터|밀리미터|킬로그램|그램|%|ms\b|km\b|cm\b|mm\b|kg\b|MB\b|GB\b|kWh\b|kW\b)/g,
    ),
  ].map((m) => `${m[1]}:${m[2]}`);
const negated = (text: string) =>
  /않|아니|금지|불가(?!피)|불허|무관|미적용|미완료|제외|없|(?:^|\s)안\s|하지\s*말|\b(?:not|never|no|without|prohibited)\b/i.test(
    text,
  );
export function validateGeneratedSections(
  value: unknown,
  page: WikiPagePlan,
  claims: GenerationClaim[],
) {
  const result = generatedSectionsSchema.parse(value);
  const allowed = new Map(
    claims.filter((c) => page.claimIds.includes(c.id)).map((c) => [c.id, c]),
  );
  const used = new Set<string>();
  for (const section of result.sections) {
    const refs = markdownReferences(section.content);
    if (
      refs.urls.length ||
      refs.hasHtml ||
      refs.hasImages ||
      refs.hasUnresolvedWikiLinks
    )
      throw new Error(
        "생성 단락의 링크·HTML·이미지는 허용하지 않습니다. 제공된 페이지 계획의 관계를 사용해 주세요.",
      );
    const facts = section.claimIds.map((id) => {
      const c = allowed.get(id);
      if (!c)
        throw new Error(
          "단락이 다른 페이지 또는 존재하지 않는 분석을 인용했습니다.",
        );
      used.add(id);
      return c;
    });
    const quotes = facts
      .flatMap((c) => c.evidence.map((e) => e.quote))
      .join("\n");
    const text = `${section.heading}\n${section.content}`.replace(
      /^\s*\d+[.)]\s+/gm,
      "",
    );
    const originalNumbers = new Set(numbers(quotes)),
      originalUnits = new Set(numericUnits(quotes));
    if (numbers(text).some((n) => !originalNumbers.has(n)))
      throw new Error("생성 단락의 수치가 배정된 원문 근거와 다릅니다.");
    if (numericUnits(text).some((n) => !originalUnits.has(n)))
      throw new Error("생성 단락의 수치·단위 조합이 원문과 다릅니다.");
    if (negated(quotes) !== negated(section.content))
      throw new Error("생성 단락에서 원문의 부정·제외 조건이 달라졌습니다.");
    for (const fact of facts) {
      if (
        [fact.value, fact.unit, fact.condition].some(
          (v) => v && !section.content.includes(v),
        )
      )
        throw new Error("생성 단락에 분석한 수치·단위·적용 조건이 빠졌습니다.");
      if (fact.subject && !text.includes(fact.subject))
        throw new Error("생성 단락에서 사실의 적용 대상이 빠졌습니다.");
      if (
        fact.polarity === "uncertain" &&
        !/확인|불명확|불확실|잠정|가능|추정|미정|의문|\?/.test(text)
      )
        throw new Error("불확실한 분석을 확정된 사실로 생성할 수 없습니다.");
    }
    validateClaimBindings(section.content, facts, section.heading);
    if (/---\s*FILE:|---END FILE---/i.test(section.content))
      throw new Error("파일 출력 형식 대신 위키 단락을 생성해 주세요.");
  }
  if (page.claimIds.some((id) => !used.has(id)))
    throw new Error(
      "페이지에 배정된 분석 근거가 생성 단락에서 누락되었습니다.",
    );
  return result;
}
