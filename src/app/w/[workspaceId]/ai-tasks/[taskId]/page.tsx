import { headers } from "next/headers";
import Link from "next/link";
import { z } from "zod";
import {
  AiTaskControls,
  WikiGenerationStart,
} from "@/components/ai-task-controls";
import { DocumentAnalysisResult } from "@/components/document-analysis-result";
import { Markdown } from "@/components/markdown";
import { WikiGenerationResult } from "@/components/wiki-generation-result";
import { aiTaskLabels } from "@/lib/ai-task";
import { contentPage } from "@/server/page-access";
import { aiTaskDetails } from "@/server/services/ai-tasks";
export default async function AiTaskPage({
  params,
}: {
  params: Promise<{ workspaceId: string; taskId: string }>;
}) {
  const { workspaceId, taskId } = await params;
  const task = await contentPage(async () =>
    aiTaskDetails(await headers(), workspaceId, taskId),
  );
  const sourceUrl = `/w/${workspaceId}/sources/${task.sourceId}?version=${task.sourceVersionId}`;
  const result = z
    .object({
      summary: z.string(),
      claims: z.array(
        z.object({ text: z.string(), chunkId: z.uuid(), quote: z.string() }),
      ),
      coverage: z.object({
        totalChunks: z.number(),
        processedChunks: z.number(),
      }),
      warnings: z.array(z.string()),
    })
    .safeParse(task.result);
  const usage = {
    input: task.usage.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
    output: task.usage.reduce((n, r) => n + (r.outputTokens ?? 0), 0),
    unknown: task.usage.filter(
      (r) => r.inputTokens === null || r.outputTokens === null,
    ).length,
  };
  return (
    <>
      <Link className="back-link" href={sourceUrl}>
        ← 원문과 작업 이력
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">문서 AI 작업</span>
          <h1>{aiTaskLabels[task.kind] ?? "문서 처리"}</h1>
          <p>결과의 원문 근거를 확인한 뒤 업무에 활용해 주세요.</p>
        </div>
        <span className="state-label">
          {aiTaskLabels[task.state] ?? task.state}
        </span>
      </div>
      <section className="panel">
        <h2 className="content-subtitle">처리 상태</h2>
        {task.ingestRunId && (
          <p className="notice-box">
            자료 정리에 연결된 작업입니다.{" "}
            <Link
              href={`/w/${workspaceId}/sources/${task.sourceId}#source-ingest`}
            >
              전체 정리 상태와 재시도 →
            </Link>
          </p>
        )}
        <p className="muted">
          모델 {task.model ?? "설정 대기"} · 작업자 중단 복구 {task.recoveries}
          회
        </p>
        {task.errorMessage && (
          <p className={task.state === "failed" ? "form-error" : "notice-box"}>
            {task.errorMessage}
          </p>
        )}
        {!task.current && (
          <p className="notice-box">
            {task.unavailableReason ||
              "작성 권한 또는 공개 원문이 변경되어 이전 결과를 표시하지 않습니다."}
          </p>
        )}
        <AiTaskControls
          workspaceId={workspaceId}
          id={taskId}
          state={task.state}
          current={task.current}
        />
        <ol className="ai-step-list">
          {task.steps.map((step) => (
            <li key={step.id}>
              <div>
                <strong>
                  {aiTaskLabels[step.kind] ?? step.kind}
                  {step.kind === "analyze" ? ` ${step.ordinal}` : ""}
                  {step.kind === "generate-wiki" &&
                  typeof (step.input?.page as { title?: unknown })?.title ===
                    "string"
                    ? ` · ${(step.input?.page as { title: string }).title}`
                    : ""}
                </strong>
                <span>
                  {aiTaskLabels[step.state] ?? step.state}
                  {[
                    "prepare",
                    "integrate",
                    "generation-prepare",
                    "assemble-wiki",
                  ].includes(step.kind)
                    ? ""
                    : step.reused
                      ? " · 검증된 결과 재사용"
                      : ` · ${step.attempts}회 시도`}
                </span>
              </div>
              {step.errorMessage && (
                <p className="field-help">{step.errorMessage}</p>
              )}
            </li>
          ))}
        </ol>
        <p className="field-help">
          모델 호출 {task.usage.length}회 · 확인된 입력{" "}
          {usage.input.toLocaleString("ko-KR")} / 출력{" "}
          {usage.output.toLocaleString("ko-KR")} 토큰
          {usage.unknown ? ` · 사용량 미확인 ${usage.unknown}회` : ""}
        </p>
      </section>
      {task.kind === "analysis" && task.current && (
        <DocumentAnalysisResult
          steps={task.steps}
          sourceUrl={sourceUrl}
          completed={task.state === "completed"}
        />
      )}
      {task.kind === "analysis" &&
        task.state === "completed" &&
        task.current && (
          <WikiGenerationStart
            workspaceId={workspaceId}
            sourceId={task.sourceId}
            analysisTaskId={task.id}
          />
        )}
      {task.kind === "wiki-generation" && task.current && (
        <WikiGenerationResult task={task} workspaceId={workspaceId} />
      )}
      {result.success && (
        <section className="panel">
          <div className="section-heading">
            <h2>요약과 근거</h2>
            <span>
              추출 문단 {result.data.coverage.processedChunks} /{" "}
              {result.data.coverage.totalChunks}개 처리
            </span>
          </div>
          {result.data.warnings.map((w) => (
            <p className="notice-box" key={w}>
              {w}
            </p>
          ))}
          <Markdown>{result.data.summary}</Markdown>
          {result.data.claims.map((claim, i) => (
            <article className="source-passage" key={`${claim.chunkId}-${i}`}>
              <strong>{claim.text}</strong>
              <blockquote>{claim.quote}</blockquote>
              <Link href={`${sourceUrl}#chunk-${claim.chunkId}`}>
                원문 구절 확인 →
              </Link>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
