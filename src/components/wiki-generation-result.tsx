import Link from "next/link";
import { z } from "zod";
import { Markdown } from "@/components/markdown";
import { batchLabels } from "@/lib/proposals";
import { generatedSectionsSchema, wikiPlanSchema } from "@/lib/wiki-generation";
import { wikiTypeLabels } from "@/lib/wiki-metadata";
import type { aiTaskDetails } from "@/server/services/ai-tasks";

export function WikiGenerationResult({
  task,
  workspaceId,
}: {
  task: Awaited<ReturnType<typeof aiTaskDetails>>;
  workspaceId: string;
}) {
  const base = `/w/${workspaceId}`;
  const plan = wikiPlanSchema.safeParse(
    task.steps.find((s) => s.kind === "plan-wiki")?.result,
  );
  const prepared = task.steps.find(
    (s) => s.kind === "generation-prepare",
  )?.result;
  const coverage = z
    .object({
      totalChunks: z.number(),
      processedChunks: z.number(),
      totalUnits: z.number(),
      processedUnits: z.number(),
      totalChars: z.number(),
      processedChars: z.number(),
    })
    .safeParse(prepared?.coverage);
  const questions = z
    .array(z.string())
    .safeParse(task.result?.questions ?? prepared?.analysisQuestions);
  const excluded = z
    .array(z.object({ title: z.string(), reason: z.string() }))
    .safeParse(task.result?.excluded);
  const written = task.steps.filter(
    (s) => s.kind === "generate-wiki" && s.state === "completed",
  ).length;
  return (
    <>
      <section className="panel" aria-label="위키 생성 계획과 검토">
        <h2 className="content-subtitle">생성 계획과 검토 묶음</h2>
        {task.analysisTaskId && (
          <Link
            className="back-link"
            href={`${base}/ai-tasks/${task.analysisTaskId}`}
          >
            전체 문서 분석과 주장별 근거 확인 →
          </Link>
        )}
        {coverage.success && (
          <p className="field-help">
            분석 범위: 문단 {coverage.data.processedChunks}/
            {coverage.data.totalChunks}개 · 구간 {coverage.data.processedUnits}/
            {coverage.data.totalUnits}개 ·{" "}
            {coverage.data.processedChars.toLocaleString("ko-KR")}/
            {coverage.data.totalChars.toLocaleString("ko-KR")}자
          </p>
        )}
        {plan.success ? (
          <>
            <Markdown>{plan.data.summary}</Markdown>
            <p className="notice-box">
              본문 작성 {written}/{plan.data.pages.length}개 완료 · 전체 작성을
              마치면 페이지 관계에 따라 검토 묶음을 준비합니다.
            </p>
            <ul>
              {plan.data.pages.map((p) => (
                <li key={p.key}>
                  <strong>{p.title}</strong> ·{" "}
                  {wikiTypeLabels[p.type] ?? p.type}
                  <p className="field-help">
                    {p.scope} · {p.reason}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="field-help">
            완료 분석과 현재 공개 지식을 대조하고 있습니다.
          </p>
        )}
        {task.groups.map((g) => (
          <article className="source-passage" key={g.id}>
            <Link href={`${base}/proposals/${g.id}`}>
              <strong>
                {g.ordinal}번 검토 묶음 · {batchLabels[g.state]} · 수정{" "}
                {g.revision}
              </strong>{" "}
              →
            </Link>
            <p>{g.pages.map((p) => p.title).join(" · ")}</p>
            {g.dependencies.length > 0 && (
              <p className="field-help">
                먼저 승인할 묶음: {g.dependencies.join(", ")}번
              </p>
            )}
          </article>
        ))}
        {questions.success && questions.data.length > 0 && (
          <details>
            <summary>해결되지 않은 질문 {questions.data.length}개</summary>
            <ul>
              {questions.data.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </details>
        )}
        {excluded.success && excluded.data.length > 0 && (
          <details>
            <summary>
              대조에 포함하지 못한 후보 {excluded.data.length}개
            </summary>
            <ul>
              {excluded.data.map((e, i) => (
                <li key={`${i}-${e.title}`}>
                  {e.title}: {e.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {task.state !== "completed" && written > 0 && (
        <section className="panel">
          <h2 className="content-subtitle">완료한 페이지의 추가 단락</h2>
          <p className="field-help">
            아직 검토·게시 전입니다. 재시도하면 완료한 본문은 다시 생성하지 않고
            이어서 처리합니다.
          </p>
          {task.steps
            .filter(
              (s) => s.kind === "generate-wiki" && s.state === "completed",
            )
            .map((step) => {
              const result = generatedSectionsSchema.safeParse(step.result);
              const page = z
                .object({ title: z.string() })
                .safeParse(step.input?.page);
              return (
                result.success && (
                  <details key={step.id}>
                    <summary>
                      {page.success ? page.data.title : "작성된 페이지"}
                    </summary>
                    {result.data.sections.map((s, i) => (
                      <article key={`${i}-${s.heading}`}>
                        <h3>{s.heading}</h3>
                        <Markdown>{s.content}</Markdown>
                      </article>
                    ))}
                  </details>
                )
              );
            })}
        </section>
      )}
    </>
  );
}
