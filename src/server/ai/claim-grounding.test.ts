import { describe, expect, it, vi } from "vitest";
import {
  validateClaimBindings,
  validateMergedGrounding,
} from "@/lib/claim-grounding";
import {
  type GenerationClaim,
  validateGeneratedSections,
  type WikiPagePlan,
} from "@/lib/wiki-generation";

const claims: GenerationClaim[] = [
  {
    id: "c1",
    unitId: "u1",
    kind: "requirement",
    subject: "주 화면",
    predicate: "갱신 주기",
    text: "주 화면은 30초마다 갱신한다.",
    polarity: "affirmed",
    value: "30",
    unit: "초",
    condition: null,
    evidence: [
      {
        partId: "p1",
        chunkId: "11111111-1111-4111-8111-111111111111",
        quote: "주 화면은 30초마다 갱신한다.",
      },
    ],
  },
  {
    id: "c2",
    unitId: "u1",
    kind: "requirement",
    subject: "보조 화면",
    predicate: "갱신 주기",
    text: "보조 화면은 90초마다 갱신한다.",
    polarity: "affirmed",
    value: "90",
    unit: "초",
    condition: null,
    evidence: [
      {
        partId: "p2",
        chunkId: "22222222-2222-4222-8222-222222222222",
        quote: "보조 화면은 90초마다 갱신한다.",
      },
    ],
  },
];
const page: WikiPagePlan = {
  key: "page-1",
  kind: "new",
  type: "concept",
  title: "화면 갱신",
  subject: "화면",
  scope: "검토 표본",
  pageId: null,
  mergedPageIds: [],
  claimIds: ["c1", "c2"],
  aliases: [],
  links: [],
  reason: "점검",
  questions: [],
};
const correct = "주 화면은 30초마다 갱신한다. 보조 화면은 90초마다 갱신한다.";
const wrong = "주 화면은 90초마다 갱신한다. 보조 화면은 30초마다 갱신한다.";
const sections = [
  { heading: "화면별 갱신", content: correct, claimIds: ["c1", "c2"] },
];

describe("생성 주장의 대상과 수치 대응", () => {
  it("실제 생성 검증 경로에서 값만 뒤바꾼 본문을 거부한다", () => {
    expect(() =>
      validateGeneratedSections(
        { sections, conflict: false, questions: [] },
        page,
        claims,
      ),
    ).not.toThrow();
    expect(() =>
      validateGeneratedSections(
        {
          sections: [{ ...sections[0], content: wrong }],
          conflict: false,
          questions: [],
        },
        page,
        claims,
      ),
    ).toThrow("대상과 수치");
  });
  it.each([
    correct,
    "주 화면은 **30초**, 보조 화면은 **90초**마다 갱신한다.",
    "- 주 화면: 30초\n- 보조 화면: 90초",
    "| 화면 | 갱신 주기 |\n| --- | --- |\n| 주 화면 | 30초 |\n| 보조 화면 | 90초 |",
    "## 주 화면\n\n30초마다 갱신한다.\n\n## 보조 화면\n\n90초마다 갱신한다.",
    "주 화면은\n30초마다 갱신한다. 보조 화면은 90초마다 갱신한다.",
  ])("정상 문장·목록·표·제목 문맥을 보존한다: %s", (body) => {
    expect(() => validateClaimBindings(body, claims)).not.toThrow();
  });
  it.each([
    wrong,
    "주 화면은 90초, 보조 화면은 30초마다 갱신한다.",
    "| 화면 | 주기 |\n| --- | --- |\n| 주 화면 | 90초 |\n| 보조 화면 | 30초 |",
    "## 주 화면\n\n90초마다 갱신한다.\n\n## 보조 화면\n\n30초마다 갱신한다.",
    "주 화면과 보조 화면은 각각 30초와 90초마다 갱신한다.",
    `${correct} 주 화면은 90초마다 갱신한다.`,
    "주 화면은 130초마다 갱신한다. 보조 화면은 90초마다 갱신한다.",
  ])("뒤바뀜·모호한 대응·추가 오류를 차단한다: %s", (body) => {
    expect(() => validateClaimBindings(body, claims)).toThrow();
  });
  it("링크 주소의 숫자를 근거로 쓰지 않는다", () => {
    expect(() =>
      validateClaimBindings(
        "[주 화면](https://example.test/30초)과 보조 화면은 90초다.",
        claims,
      ),
    ).toThrow();
  });
  it("소수와 천 단위 구분자를 정확히 비교한다", () => {
    const values = [
      { ...claims[0], value: "1.5" },
      { ...claims[1], value: "1,500" },
    ];
    expect(() =>
      validateClaimBindings(
        "주 화면은 1.5초마다 갱신한다. 보조 화면은 1,500초마다 갱신한다.",
        values,
      ),
    ).not.toThrow();
    expect(() =>
      validateClaimBindings(
        "주 화면은 11.5초마다 갱신한다. 보조 화면은 1,500초마다 갱신한다.",
        values,
      ),
    ).toThrow();
  });
  it("수치의 부호를 바꾸어 같은 값인 것처럼 통과시키지 않는다", () => {
    expect(() =>
      validateClaimBindings("주 화면은 -30초마다 갱신한다.", [claims[0]]),
    ).toThrow();
    const negative = [{ ...claims[0], value: "-30" }];
    expect(() =>
      validateClaimBindings("주 화면은 -30초마다 갱신한다.", negative),
    ).not.toThrow();
    expect(() =>
      validateClaimBindings("주 화면은 30초마다 갱신한다.", negative),
    ).toThrow();
  });
  it("같은 단락의 다른 문장에 있는 조건으로 대응을 통과시키지 않는다", () => {
    const values = [{ ...claims[0], condition: "정상 상태에서" }];
    expect(() =>
      validateClaimBindings(
        "정상 상태에서 주 화면은 30초마다 갱신한다.",
        values,
      ),
    ).not.toThrow();
    expect(() =>
      validateClaimBindings(
        "주 화면은 30초마다 갱신한다. 정상 상태에서 확인한다.",
        values,
      ),
    ).toThrow("조건");
  });
  it("상위 제목에만 대상이 있으면 같은 단락 문맥으로 사용한다", () => {
    expect(() =>
      validateClaimBindings("30초마다 갱신한다.", [claims[0]], "주 화면"),
    ).not.toThrow();
    expect(() =>
      validateClaimBindings("90초마다 갱신한다.", [claims[0]], "주 화면"),
    ).toThrow();
  });
  it("수치가 없는 주장을 숫자 규칙으로 거부하지 않는다", () => {
    expect(() =>
      validateClaimBindings("관찰 결과를 검토한다.", [
        { ...claims[0], value: null, unit: null },
      ]),
    ).not.toThrow();
  });
});

describe("병합 후 근거 재검증", () => {
  const previous = "비상 전원은 8시간 동안 유지해야 한다.";
  it("검증된 문장과 기존 조건의 순서·서식 변경은 허용한다", () => {
    expect(() =>
      validateMergedGrounding(
        `## 기존 조건\n\n${previous}\n\n## 새 내용\n\n${correct}`,
        sections,
        claims,
        [previous],
      ),
    ).not.toThrow();
  });
  it("숫자를 바꾸거나 이전 조건을 생략한 병합문을 거부한다", () => {
    expect(() =>
      validateMergedGrounding(`${previous}\n\n${wrong}`, sections, claims, [
        previous,
      ]),
    ).toThrow("병합 후");
    expect(() =>
      validateMergedGrounding(correct, sections, claims, [previous]),
    ).toThrow("병합 후");
  });
  it("정상 문장을 남긴 채 잘못된 조건을 추가해도 거부한다", () => {
    expect(() =>
      validateMergedGrounding(`${correct}\n\n${wrong}`, sections, claims, []),
    ).toThrow();
  });
});

vi.mock("@/server/db", () => ({ getDb: () => ({}) }));

import type { TaskExecution } from "./task-execution";
import { mergeGeneratedWiki } from "./wiki-merge";

function fixture(saved?: Record<string, unknown>, output = correct) {
  const save = vi.fn(async () => {});
  const model = vi.fn(async (_ordinal, _messages, validate) =>
    validate({
      content: `---\ntitle: 화면\ntype: concept\nsources: []\n---\n\n${output}`,
    }),
  );
  const run = {
    step: vi.fn(async () => ({
      state: saved ? "completed" : "pending",
      result: saved,
    })),
    save,
    model,
    guard: vi.fn(async () => {}),
    signal: new AbortController().signal,
  } as unknown as TaskExecution;
  return {
    input: {
      run,
      ordinal: 2,
      incoming: `## 화면별 갱신\n\n${correct}`,
      title: "화면",
      type: "concept",
      sourceId: "new-source",
      reuse: false,
      sections,
      claims,
      existing: [
        {
          pageId: "page",
          publishedVersionId: "v1",
          latestVersionId: "v1",
          projectId: null,
          title: "화면",
          body: "기존 안내입니다.",
          chunkIds: [],
          sourceIds: ["old-source"],
          metadata: { type: "concept", aliases: [], links: [] },
          score: 1,
        },
      ],
    },
    save,
    model,
  };
}

describe("병합 실행·재시도의 검토 경계", () => {
  it("정상 병합은 완료하고 변조된 병합은 검토가 필요한 새 초안으로 돌린다", async () => {
    const good = fixture();
    expect((await mergeGeneratedWiki(good.input)).fallback).toBe(false);
    const bad = fixture(undefined, wrong);
    const result = await mergeGeneratedWiki(bad.input);
    expect(result.fallback).toBe(true);
    expect(result.mergedBody).toBe(bad.input.incoming);
    expect(bad.save).toHaveBeenCalledWith(2, result);
  });
  it("이미 완료된 병합 결과도 재검증하고 잘못된 캐시를 재사용하지 않는다", async () => {
    const f = fixture({ mergedBody: wrong, fallback: false, replaced: false });
    const result = await mergeGeneratedWiki(f.input);
    expect(result.fallback).toBe(true);
    expect(result.mergedBody).toBe(f.input.incoming);
    expect(f.model).not.toHaveBeenCalled();
  });
  it("정상 캐시는 모델을 다시 호출하지 않는다", async () => {
    const cached = { mergedBody: correct, fallback: false, replaced: false };
    const f = fixture(cached);
    expect(await mergeGeneratedWiki(f.input)).toEqual(cached);
    expect(f.model).not.toHaveBeenCalled();
  });
  it("한 원문을 개정할 때는 이전 수치를 억지로 보존하지 않고 새 본문으로 교체한다", async () => {
    const f = fixture();
    f.input.existing[0].sourceIds = ["new-source"];
    f.input.existing[0].body = "주 화면은 20초마다 갱신한다.";
    const result = await mergeGeneratedWiki(f.input);
    expect(result.replaced).toBe(true);
    expect(result.fallback).toBe(false);
    expect(result.mergedBody).toBe(f.input.incoming);
    expect(f.model).not.toHaveBeenCalled();
  });
  it("여러 원문 병합에서 기존 조건이 사라지면 명시적 검토 대상으로 돌린다", async () => {
    const f = fixture();
    f.input.existing[0].body = "비상 전원은 8시간 유지해야 한다.";
    const result = await mergeGeneratedWiki(f.input);
    expect(result.fallback).toBe(true);
    expect(result.mergedBody).toBe(f.input.incoming);
  });
  it("재사용 본문도 새 주장의 대응을 확인하며 실패 결과는 저장하지 않는다", async () => {
    const f = fixture();
    f.input.reuse = true;
    f.input.existing[0].body = wrong;
    await expect(mergeGeneratedWiki(f.input)).rejects.toThrow();
    expect(f.model).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });
  it("대체할 새 본문 자체가 잘못됐으면 검토 초안으로도 완료 저장하지 않는다", async () => {
    const f = fixture({ mergedBody: wrong, fallback: false, replaced: false });
    f.input.incoming = wrong;
    await expect(mergeGeneratedWiki(f.input)).rejects.toThrow();
    expect(f.save).not.toHaveBeenCalled();
  });
  it("취소된 병합은 최종 완료 결과를 저장하지 않는다", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    Object.assign(f.input.run, { signal: controller.signal });
    await expect(mergeGeneratedWiki(f.input)).rejects.toThrow();
    expect(f.save).not.toHaveBeenCalled();
  });
});
