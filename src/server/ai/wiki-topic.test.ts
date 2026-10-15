import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WikiCandidate, WikiPagePlan } from "@/lib/wiki-generation";
import { validateWikiPlan } from "@/lib/wiki-generation";
import { validateTopicIdentity } from "@/lib/wiki-topic";

const page: WikiPagePlan = {
  key: "page-1",
  kind: "new",
  type: "concept",
  title: "화면 갱신 조건",
  subject: "화면",
  scope: "사업 A",
  pageId: null,
  mergedPageIds: [],
  claimIds: ["c1"],
  aliases: [],
  links: [],
  reason: "점검",
  questions: [],
};
const candidate: WikiCandidate = {
  pageId: "existing",
  publishedVersionId: "v1",
  latestVersionId: "v1",
  projectId: "A",
  title: page.title,
  body: "기존 조건",
  chunkIds: [],
  metadata: { type: "concept", aliases: ["가시화응답성"], links: [] },
  score: 1,
};
describe("주제 위키 중복 계획", () => {
  it("같은 범위의 같은 제목을 새 페이지로 복제하지 않는다", () => {
    expect(() => validateTopicIdentity([page], [candidate], "A")).toThrow(
      "주제 위키",
    );
  });
  it("별칭과 새 제목이 같아도 기존 대상 비교를 요구한다", () => {
    expect(() =>
      validateTopicIdentity(
        [{ ...page, title: "가시화응답성" }],
        [candidate],
        "A",
      ),
    ).toThrow();
  });
  it("새 별칭·공백·유니코드 표기를 통해 중복 검사를 우회하지 않는다", () => {
    expect(() =>
      validateTopicIdentity(
        [{ ...page, title: "다른 제목", aliases: ["  화면   갱신 조건 "] }],
        [candidate],
        "A",
      ),
    ).toThrow();
    expect(() =>
      validateTopicIdentity(
        [{ ...page, title: "ＡＰＩ" }],
        [{ ...candidate, title: "api" }],
        "A",
      ),
    ).toThrow();
  });
  it("기존 대상 수정과 충돌 계획은 통과시킨다", () => {
    for (const kind of ["update", "conflict"] as const)
      expect(() =>
        validateTopicIdentity(
          [{ ...page, kind, pageId: candidate.pageId }],
          [candidate],
          "A",
        ),
      ).not.toThrow();
  });
  it("다른 사업과 공통 위키를 임의로 같은 대상으로 묶지 않는다", () => {
    expect(() => validateTopicIdentity([page], [candidate], "B")).not.toThrow();
    expect(() =>
      validateTopicIdentity([page], [{ ...candidate, projectId: null }], "A"),
    ).not.toThrow();
  });
  it("원문별 요약과 다른 분류는 유지한다", () => {
    expect(() =>
      validateTopicIdentity(
        [{ ...page, type: "source" }],
        [{ ...candidate, metadata: { ...candidate.metadata, type: "source" } }],
        "A",
      ),
    ).not.toThrow();
    expect(() =>
      validateTopicIdentity([{ ...page, type: "procedure" }], [candidate], "A"),
    ).not.toThrow();
  });
  it("하나의 계획에서 같은 주제를 두 번 생성하지 않는다", () => {
    expect(() =>
      validateTopicIdentity([page, { ...page, key: "page-2" }], [], "A"),
    ).toThrow("한 계획");
  });
  it("대상을 구분한 새 제목은 허용한다", () => {
    expect(() =>
      validateTopicIdentity(
        [{ ...page, title: "관리자 화면 갱신 조건" }],
        [candidate],
        "A",
      ),
    ).not.toThrow();
  });
});

describe("실제 모델의 기존 위키·계획 키 중복 표현", () => {
  const data = JSON.parse(
    readFileSync(
      "docs/evaluation/topic-accumulation-20260924/real-plan-exception-results.json",
      "utf8",
    ),
  ).cases[0];
  const validate = (plan: unknown) =>
    validateWikiPlan(
      plan,
      data.input.analysis,
      data.input.existingWikis,
      data.input.projectId,
    );
  it("같은 대상을 가리키는 두 표기를 한 링크로 정규화한다", () => {
    const result = validate(structuredClone(data.rawPlan));
    expect(result.pages[0].links).toHaveLength(1);
    expect(result.pages[0].links[0].key).toBe("page-2");
    expect(result.pages[1].pageId).toBe(data.input.existingWikis[0].pageId);
  });
  it("자기 참조·존재하지 않는 링크·동일 표기 중복은 계속 거부한다", () => {
    for (const keys of [
      ["page-1"],
      ["wiki:00000000-0000-4000-8000-000000000099"],
      ["page-2", "page-2"],
      [
        "page-2",
        `wiki:${data.input.existingWikis[0].pageId}`,
        `wiki:${data.input.existingWikis[0].pageId}`,
      ],
    ]) {
      const plan = structuredClone(data.rawPlan);
      plan.pages[0].links = keys.map((key) => ({ key, reason: "회귀 표본" }));
      expect(() => validate(plan)).toThrow("링크");
    }
  });
});
