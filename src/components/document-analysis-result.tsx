import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { locatorLabel } from "@/lib/content";
import {
  type AnalysisPart,
  type AnalysisUnit,
  unitAnalysisSchema,
} from "@/lib/document-analysis";

type Step = {
  id: string;
  kind: string;
  ordinal: number;
  state: string;
  input: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
};
const kindLabels = {
  entity: "대상",
  concept: "개념",
  fact: "사실",
  requirement: "의무",
  exception: "예외",
  value: "수치",
  uncertainty: "불명확 사항",
};
export function DocumentAnalysisResult({
  steps,
  sourceUrl,
  completed,
}: {
  steps: Step[];
  sourceUrl: string;
  completed: boolean;
}) {
  const prepare = steps.find((s) => s.kind === "prepare")?.result;
  if (!prepare) return null;
  const units = steps.filter((s) => s.kind === "analyze");
  const done = units.filter((s) => s.state === "completed");
  const allParts = units.flatMap(
    (s) => (s.input?.unit as AnalysisUnit | undefined)?.parts ?? [],
  );
  const doneParts = done.flatMap(
    (s) => (s.input?.unit as AnalysisUnit | undefined)?.parts ?? [],
  );
  const doneIds = new Set(doneParts.map((p) => p.id));
  const chunkIds = [...new Set(allParts.map((p) => p.chunkId))];
  const processedChunks = chunkIds.filter((id) =>
    allParts.filter((p) => p.chunkId === id).every((p) => doneIds.has(p.id)),
  ).length;
  const warnings = Array.isArray(prepare.warnings)
    ? (prepare.warnings as string[])
    : [];
  const excluded = Array.isArray(prepare.excluded)
    ? (prepare.excluded as { chunkId: string; reason: string }[])
    : [];
  const integrated = steps.find(
    (s) => s.kind === "integrate" && s.state === "completed",
  )?.result;
  const comparisons = (integrated?.comparisons ?? []) as {
    claimIds: string[];
    reason: string;
  }[];
  return (
    <section className="panel" aria-label="문서 전체 분석 범위">
      <div className="section-heading">
        <h2>분석 범위와 근거</h2>
        <span>
          {completed ? "전체 분석 완료" : "부분 결과 · 전체 분석 미완료"}
        </span>
      </div>
      <p className="notice-box">
        추출 문단 {processedChunks} / {Number(prepare.totalChunks)}개 · 분석
        구간 {done.length} / {units.length}개 · 원문{" "}
        {doneParts
          .reduce((n, p) => n + p.text.length, 0)
          .toLocaleString("ko-KR")}{" "}
        / {Number(prepare.totalChars).toLocaleString("ko-KR")}자 처리
      </p>
      <p className="field-help">
        텍스트로 추출한 범위의 결과입니다. 이미지 속 글자와 추출하지 못한 내용은
        포함하지 않습니다. 각 구간을 펼치면 요약·조건·처리한 원문 범위를 확인할
        수 있습니다.
      </p>
      {warnings.map((w) => (
        <p className="notice-box" key={w}>
          {w}
        </p>
      ))}
      {excluded.map((e) => (
        <p className="notice-box" key={e.chunkId}>
          제외: {e.reason}{" "}
          <Link href={`${sourceUrl}#chunk-${e.chunkId}`}>해당 원문</Link>
        </p>
      ))}
      {comparisons.map((c, i) => (
        <p className="notice-box" key={`${c.claimIds[0]}-${i}`}>
          {c.reason}
        </p>
      ))}
      {units.map((step, i) => {
        const unit = step.input?.unit as AnalysisUnit | undefined;
        const parsed = unitAnalysisSchema.safeParse(step.result);
        const parts = unit?.parts ?? [];
        const lookup = new Map(parts.map((p) => [p.id, p]));
        return (
          <details
            className="analysis-unit"
            key={step.id}
            open={units.length === 1}
          >
            <summary>
              구간 {i + 1} ·{" "}
              {step.state === "completed"
                ? "완료"
                : step.state === "failed"
                  ? "실패"
                  : step.state === "running"
                    ? "처리 중"
                    : "대기"}{" "}
              · {parts[0]?.headingPath || "본문"}
            </summary>
            {parsed.success ? (
              <>
                <Markdown>{parsed.data.summary}</Markdown>
                {parsed.data.claims.map((claim, j) => (
                  <article className="source-passage" key={`${step.id}-${j}`}>
                    <span className="eyebrow">
                      {kindLabels[claim.kind]} · {claim.subject || "해당 구절"}
                    </span>
                    <strong>{claim.text}</strong>
                    {claim.condition && (
                      <p className="field-help">적용 조건: {claim.condition}</p>
                    )}
                    {claim.value && (
                      <p className="field-help">
                        수치: {claim.value}
                        {claim.unit ? ` ${claim.unit}` : ""}
                      </p>
                    )}
                    {claim.evidence.map((e, k) => (
                      <div key={`${e.partId}-${k}`}>
                        <blockquote>{e.quote}</blockquote>
                        <PartLink
                          sourceUrl={sourceUrl}
                          part={lookup.get(e.partId)}
                        />
                      </div>
                    ))}
                  </article>
                ))}
                {parsed.data.questions.length > 0 && (
                  <>
                    <h3>확인이 필요한 질문</h3>
                    <ul>
                      {parsed.data.questions.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ul>
                  </>
                )}
                <details>
                  <summary>원문 구간별 처리 내역</summary>
                  <ul className="analysis-part-list">
                    {parsed.data.parts.map((p) => (
                      <li key={p.partId}>
                        <PartLink
                          sourceUrl={sourceUrl}
                          part={lookup.get(p.partId)}
                        />{" "}
                        ·{" "}
                        {p.status === "analyzed" ? "분석" : "추출할 주장 없음"}:{" "}
                        {p.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            ) : (
              <ul className="analysis-part-list">
                {parts.map((p) => (
                  <li key={p.id}>
                    <PartLink sourceUrl={sourceUrl} part={p} />
                  </li>
                ))}
              </ul>
            )}
          </details>
        );
      })}
    </section>
  );
}
function PartLink({
  sourceUrl,
  part,
}: {
  sourceUrl: string;
  part: AnalysisPart | undefined;
}) {
  if (!part) return null;
  return (
    <Link href={`${sourceUrl}#chunk-${part.chunkId}`}>
      원문 구절 확인 → {locatorLabel(part.locator)} · 문자 {part.start + 1}~
      {part.end}
    </Link>
  );
}
