import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AiTaskStart } from "@/components/ai-task-controls";
import {
  ContentActions,
  ProcessingRefresh,
  UploadForm,
} from "@/components/content-controls";
import { Decisions } from "@/components/content-view";
import { GenerateSource } from "@/components/generation-controls";
import { IngestControls } from "@/components/ingest-controls";
import { Markdown } from "@/components/markdown";
import { IssueReport } from "@/components/operations-controls";
import {
  locatorLabel,
  processingLabels,
  publicationLabels,
} from "@/lib/content";
import { contentPage } from "@/server/page-access";
import { listAiTasks } from "@/server/services/ai-tasks";
import { listIngest } from "@/server/services/ingest";
import { sourceDetails } from "@/server/services/sources";
import { listWiki } from "@/server/services/wiki";
export default async function SourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; sourceId: string }>;
  searchParams: Promise<{ version?: string; duplicate?: string }>;
}) {
  const { workspaceId, sourceId } = await params;
  const query = await searchParams;
  const data = await contentPage(async () =>
    sourceDetails(await headers(), workspaceId, sourceId, query.version),
  );
  const version = data.version;
  if (!version) notFound();
  const tasks = data.canWrite
    ? await listAiTasks(await headers(), workspaceId, {
        sourceVersionId: version.id,
      })
    : [];
  const base = `/w/${workspaceId}`;
  const ingest = data.canWrite
    ? await listIngest(await headers(), workspaceId, {
        sourceId,
        sourceVersionId: version.id,
      })
    : null;
  const proposalWikis =
    data.canWrite && version.publication === "published"
      ? (await listWiki(await headers(), workspaceId, data.source.domainId))
          .filter((p) => p.projectId === data.source.projectId)
          .map((p) => ({ id: p.pageId, title: p.version.title }))
      : [];
  const fileUrl = `/api/workspaces/${workspaceId}/source-versions/${version.id}/file`;
  const actions: { value: string; label: string }[] = [];
  if (
    data.canManage &&
    version.publication === "rejected" &&
    version.processing === "completed" &&
    version.id === data.source.latestVersionId
  )
    actions.push({ value: "submit", label: "다시 검토 요청" });
  if (data.canManage && ["queued", "processing"].includes(version.processing))
    actions.push({ value: "cancel", label: "처리 취소" });
  if (data.canManage && ["failed", "canceled"].includes(version.processing))
    actions.push({ value: "retry", label: "처리 재시도" });
  if (data.canReview && version.publication === "pending") {
    if (data.canApprove && version.processing === "completed")
      actions.push({ value: "approve", label: "자료 공개 승인" });
    actions.push({ value: "reject", label: "반려" });
  }
  if (data.canReview && version.id === data.source.publishedVersionId)
    actions.push({ value: "withdraw", label: "공개 철회" });
  return (
    <>
      <Link className="back-link" href={`${base}/sources`}>
        ← 자료실
      </Link>
      {version.originUrl && (
        <p className="field-help">
          수집한 웹 원문:{" "}
          <a href={version.originUrl} target="_blank" rel="noreferrer">
            {version.originUrl}
          </a>
        </p>
      )}
      <div className="page-heading detail-heading">
        <div>
          <span className="eyebrow">
            {data.source.category === "testimony"
              ? "작성자 진술 · 실무 경험"
              : "원본과 근거 위치"}
          </span>
          <h1>{data.source.title}</h1>
          <p>
            {version.filename} · 버전 {version.number} ·{" "}
            {(version.byteSize / 1024).toFixed(1)} KiB
          </p>
        </div>
        <a className="action-link" href={fileUrl}>
          원본 내려받기
        </a>
      </div>
      {query.duplicate && (
        <p className="notice-box">
          같은 파일이 이미 등록되어 있어 기존 버전을 열었습니다.
        </p>
      )}
      <nav className="detail-tabs" aria-label="자료 상세 탐색">
        <a href="#source-text">원문</a>
        <a href="#source-status">상태·버전</a>
        <a href="#source-history">처리 이력</a>
      </nav>
      <div className="detail-layout">
        <div className="detail-body">
          {version.testimony && (
            <section className="panel">
              <h2 className="content-subtitle">작성자 진술</h2>
              <p className="notice-box">
                이 기록은 작성자의 경험과 판단입니다. 공식 규정과 적용 범위를
                구분해 읽어 주세요.
              </p>
              {Object.entries({
                situation: "상황",
                reasoning: "판단과 이유",
                result: "결과",
                followUp: "추가 확인할 내용",
              }).map(([key, label]) => (
                <div className="decision-row" key={key}>
                  <strong>{label}</strong>
                  <p className="whitespace-pre-wrap">
                    {version.testimony?.[
                      key as "situation" | "reasoning" | "result" | "followUp"
                    ] || "없음"}
                  </p>
                </div>
              ))}
              <details>
                <summary>작성 당시 메모 확인</summary>
                <pre className="whitespace-pre-wrap">
                  {version.testimony.rawNote || "별도 메모 없음"}
                </pre>
              </details>
              {data.canManage && (
                <Link
                  className="action-link"
                  href={`${base}/records/${sourceId}`}
                >
                  기록 개정하기
                </Link>
              )}
            </section>
          )}
          <section className="panel" id="source-text">
            <div className="section-heading">
              <h2>추출한 원문</h2>
              <span>{data.chunks.length}개 문단</span>
            </div>
            {data.chunks.map((chunk) => (
              <article
                className="source-passage"
                id={`chunk-${chunk.id}`}
                key={chunk.id}
              >
                <div className="section-heading">
                  <span className="passage-label">
                    {locatorLabel(chunk.locator)}
                  </span>
                  {chunk.locator.kind === "pdf" ? (
                    <a
                      href={`${fileUrl}?inline=1#page=${chunk.locator.page}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      PDF {chunk.locator.page}쪽 열기 ↗
                    </a>
                  ) : (
                    <a href={`#chunk-${chunk.id}`}>이 문단 위치</a>
                  )}
                </div>
                {chunk.text.includes("/source-assets/") ? (
                  <>
                    <Markdown>{chunk.text}</Markdown>
                    <details>
                      <summary>추출 원문 보기</summary>
                      <pre>{chunk.text}</pre>
                    </details>
                  </>
                ) : (
                  <pre>{chunk.text}</pre>
                )}
              </article>
            ))}
            {!data.chunks.length && (
              <p className="empty-copy">
                처리가 완료되면 문단·행 또는 PDF 페이지 위치를 확인할 수
                있습니다.
              </p>
            )}
          </section>
          <div id="source-history">
            <Decisions items={data.decisions} />
          </div>
        </div>
        <aside className="detail-aside" aria-label="자료 정보와 작업">
          <section className="panel source-status" id="source-status">
            <h2 className="content-subtitle">자료 상태와 버전</h2>
            <div className="row-tags">
              <span
                className={`state-label ${version.publication === "published" ? "state-good" : ""}`}
              >
                {publicationLabels[version.publication]}
              </span>
              <span className="state-label">
                {processingLabels[version.processing]}
              </span>
            </div>
            <ProcessingRefresh
              active={["queued", "processing"].includes(version.processing)}
            />
            {version.errorMessage && (
              <p role="alert" className="form-error">
                {version.errorMessage}
              </p>
            )}
            {version.warnings.map((warning) => (
              <p className="notice-box" key={warning}>
                {warning}
              </p>
            ))}
            {version.publication !== "published" && (
              <p className="muted">
                이 버전은 일반 직원의 검색과 근거 선택에 포함되지 않습니다.
              </p>
            )}
            {data.canReview &&
              !data.canApprove &&
              version.publication === "pending" && (
                <p className="muted">
                  본인이 등록한 버전은 다른 검토 직원의 승인이 필요합니다.
                </p>
              )}
            <details>
              <summary>버전·무결성 정보</summary>
              <p className="file-hash">SHA-256: {version.sha256}</p>
              <p className="field-help">
                추출기: {version.parserVersion ?? "처리 전"}
              </p>
              <div className="version-links">
                {data.versions.map((item) => (
                  <Link
                    key={item.id}
                    href={`${base}/sources/${sourceId}?version=${item.id}`}
                    aria-current={item.id === version.id ? "page" : undefined}
                  >
                    버전 {item.number} · {publicationLabels[item.publication]}
                  </Link>
                ))}
              </div>
            </details>
            <ContentActions
              endpoint={`/api/workspaces/${workspaceId}/source-versions/${version.id}/action`}
              actions={actions}
            />
          </section>
          {version.publication === "published" &&
            version.processing === "completed" && (
              <Link
                className="action-link"
                href={`${base}/chat?sourceId=${data.source.id}&domainId=${data.source.domainId}${data.source.projectId ? `&projectId=${data.source.projectId}` : ""}`}
              >
                이 자료에 질문하기
              </Link>
            )}
          {data.canWrite &&
            version.publication === "published" &&
            version.processing === "completed" &&
            version.id === data.source.publishedVersionId && (
              <AiTaskStart
                workspaceId={workspaceId}
                sourceId={sourceId}
                tasks={tasks}
              />
            )}
          {ingest && (
            <IngestControls
              workspaceId={workspaceId}
              sourceId={sourceId}
              enabled={ingest.enabled}
              items={ingest.items}
              canStart={
                version.publication === "published" &&
                version.processing === "completed" &&
                version.id === data.source.publishedVersionId
              }
            />
          )}
          {data.canWrite &&
            version.publication === "published" &&
            version.processing === "completed" &&
            version.id === data.source.publishedVersionId && (
              <GenerateSource
                workspaceId={workspaceId}
                sourceId={sourceId}
                chunks={data.chunks}
                wikis={proposalWikis}
              />
            )}
          {data.canWrite &&
            version.publication === "published" &&
            data.source.category !== "testimony" && (
              <Link
                className="action-link"
                href={`${base}/tools/rfp/new?sourceId=${sourceId}`}
              >
                이 자료로 RFP 분석 작성 →
              </Link>
            )}
          {data.canManage && !version.testimony && (
            <details className="panel upload-panel">
              <summary>새 원본 버전 등록</summary>
              <UploadForm
                workspaceId={workspaceId}
                domains={[]}
                projects={[]}
                existing={data.source}
              />
            </details>
          )}
          {data.canManage && (
            <Link
              className="action-link"
              href={`${base}/sources/${sourceId}/impact`}
            >
              개정·철회 영향 확인 →
            </Link>
          )}
          <IssueReport
            workspaceId={workspaceId}
            kind="source"
            targetId={sourceId}
          />
        </aside>
      </div>
    </>
  );
}
