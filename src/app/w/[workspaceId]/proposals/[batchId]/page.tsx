import { diffLines } from "diff";
import { headers } from "next/headers";
import Link from "next/link";
import { ContentActions } from "@/components/content-controls";
import { Decisions } from "@/components/content-view";
import { Markdown } from "@/components/markdown";
import { ProposalEditor } from "@/components/proposal-editor";
import { locatorLabel } from "@/lib/content";
import { batchLabels, proposalLabels } from "@/lib/proposals";
import { wikiTypeLabels } from "@/lib/wiki-metadata";
import { contentPage } from "@/server/page-access";
import { batchDetails } from "@/server/services/proposals";
import { workspaceData } from "@/server/services/workspace";
export default async function BatchPage({
  params,
}: {
  params: Promise<{ workspaceId: string; batchId: string }>;
}) {
  const { workspaceId, batchId } = await params;
  const requestHeaders = await headers();
  const data = await contentPage(() =>
    batchDetails(requestHeaders, workspaceId, batchId),
  );
  const { batch } = data;
  const base = `/w/${workspaceId}`;
  const workspace = await workspaceData(requestHeaders, workspaceId);
  const linkDestinations = Object.fromEntries(
    data.groups.flatMap((g) =>
      g.state === "approved"
        ? []
        : g.pages.flatMap((p) =>
            p.id
              ? [
                  [
                    `${base}/wiki/${p.id}`,
                    `${base}/proposals/${g.id}#page-${p.id}`,
                  ],
                ]
              : [],
          ),
    ),
  );
  const mayRevise =
    data.available &&
    data.isLatest &&
    (!batch.taskId || (data.canSubmit && batch.state !== "approved"));
  const actions: { value: string; label: string }[] = [];
  if (data.canSubmit && batch.state === "draft")
    actions.push({ value: "submit", label: "묶음 검토 요청" });
  if (data.canReview && batch.state === "submitted") {
    if (data.canApprove)
      actions.push({ value: "approve", label: "전체 변경 승인·게시" });
    actions.push({ value: "reject", label: "수정 요청" });
  }
  return (
    <>
      <Link className="back-link" href={`${base}/proposals`}>
        ← 변경 묶음
      </Link>
      <div className="page-heading detail-heading">
        <div>
          <span className="eyebrow">
            {batchLabels[batch.state]} · 변경안 {batch.items.length}개
          </span>
          <h1>{batch.title}</h1>
          <p>이 묶음의 본문·대상 버전·근거는 저장 시점에 고정되었습니다.</p>
        </div>
      </div>
      {!data.available && (
        <p className="notice-box">
          {data.unavailableReason} 이전 생성 본문은 표시하지 않습니다.
        </p>
      )}
      {!data.isLatest && data.latestBatchId && (
        <p className="notice-box">
          새로 수정한 검토 묶음이 있습니다.{" "}
          <Link href={`${base}/proposals/${data.latestBatchId}`}>
            최신 묶음으로 이동 →
          </Link>
        </p>
      )}
      {batch.taskId && (
        <section className="panel">
          <h2 className="content-subtitle">
            전체 생성 작업 · {batch.groupOrdinal}번 묶음
          </h2>
          <div className="form-actions">
            <Link href={`${base}/ai-tasks/${batch.taskId}`}>
              전체 생성 계획과 진행 상태 →
            </Link>
            {data.analysisTaskId && (
              <Link href={`${base}/ai-tasks/${data.analysisTaskId}`}>
                분석 범위와 원문 주장 →
              </Link>
            )}
          </div>
          {data.groups.map((g) => (
            <p className="field-help" key={g.id}>
              <Link href={`${base}/proposals/${g.id}`}>
                {g.ordinal}번 · {batchLabels[g.state]}
              </Link>
              {batch.dependencies.includes(g.ordinal as number) &&
                " · 이 묶음보다 먼저 승인 필요"}
            </p>
          ))}
        </section>
      )}
      {batch.warnings.map((warning) => (
        <p className="notice-box" key={warning}>
          {warning}
        </p>
      ))}
      {batch.predecessorId && (
        <Link
          className="back-link"
          href={`${base}/proposals/${batch.predecessorId}`}
        >
          이전 변경 묶음 확인 →
        </Link>
      )}
      <nav className="detail-tabs" aria-label="변경 묶음 탐색">
        <a href="#batch-body">변경 내용·근거</a>
        <a href="#batch-review">검토와 이력</a>
        {mayRevise && <a href="#batch-revise">새 묶음 작성</a>}
      </nav>
      <div className="detail-layout">
        <div className="detail-body" id="batch-body">
          {batch.items.map((item, index) => (
            <section
              className="panel"
              id={item.plannedPageId ? `page-${item.plannedPageId}` : undefined}
              key={`${batch.id}-${index}`}
            >
              <span className="eyebrow">
                {proposalLabels[item.kind]}
                {item.metadata
                  ? ` · ${wikiTypeLabels[item.metadata.type] ?? item.metadata.type}`
                  : ""}
              </span>
              <h2 className="content-subtitle">{item.title}</h2>
              <p className="notice-box">{item.reason}</p>
              {item.requiresResolution && (
                <p className="notice-box">
                  모순·적용 조건 확인이 필요합니다. 본문을 수정하고 확인 완료를
                  표시해 새 묶음으로 저장해 주세요.
                </p>
              )}
              <Markdown linkDestinations={linkDestinations}>
                {item.body}
              </Markdown>
              {!!item.questions?.length && (
                <details>
                  <summary>확인할 질문 {item.questions.length}개</summary>
                  <ul>
                    {item.questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </details>
              )}
              {!!item.metadata?.links.length && (
                <details>
                  <summary>위키 연결 이유</summary>
                  <ul>
                    {item.metadata.links.map((l) => (
                      <li key={l.pageId}>
                        <Link
                          href={
                            linkDestinations[`${base}/wiki/${l.pageId}`] ??
                            `${base}/wiki/${l.pageId}`
                          }
                        >
                          {l.reason} →
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {item.mergedPages.length > 0 && (
                <p className="notice-box">
                  병합 시 기존 위키 {item.mergedPages.length}개의 게시가
                  철회됩니다. 원문 근거와 이전 버전은 보존됩니다.
                </p>
              )}
              <details className="diff-details">
                <summary>기준 게시본과 차이 보기</summary>
                <p className="field-help">
                  {data.bases[index]
                    ? `비교 버전 ${data.bases[index]?.number}`
                    : "비교 가능한 이전 게시본 없음"}
                </p>
                <div className="diff-block">
                  {diffLines(data.bases[index]?.body ?? "", item.body).map(
                    (part, n) => (
                      <pre
                        key={`${n}-${part.count}`}
                        className={
                          part.added
                            ? "diff-added"
                            : part.removed
                              ? "diff-removed"
                              : "diff-same"
                        }
                      >
                        {part.added ? "+ " : part.removed ? "− " : "  "}
                        {part.value}
                      </pre>
                    ),
                  )}
                </div>
              </details>
              <details>
                <summary>
                  이 변경안의 원문 근거 {item.chunkIds.length}개
                </summary>
                {item.chunkIds.map((id) => {
                  const ref = data.evidence.find((r) => r.id === id);
                  return (
                    <article className="source-passage" key={id}>
                      {ref ? (
                        <>
                          <a
                            href={`${base}/sources/${ref.sourceId}?version=${ref.versionId}#chunk-${ref.id}`}
                          >
                            {ref.title} · {locatorLabel(ref.locator)} →
                          </a>
                          {!ref.available && (
                            <p className="form-error">
                              개정·철회로 현재 사용 불가
                            </p>
                          )}
                          <pre>{ref.text}</pre>
                        </>
                      ) : (
                        <p>근거를 찾을 수 없습니다.</p>
                      )}
                    </article>
                  );
                })}
              </details>
            </section>
          ))}
          {batch.results.length > 0 && (
            <section className="panel">
              <h2 className="content-subtitle">게시된 위키</h2>
              {batch.results.map((r, index) => (
                <Link
                  className="review-row"
                  key={r.versionId}
                  href={`${base}/wiki/${r.pageId}?version=${r.versionId}`}
                >
                  {batch.items[index].title} →
                </Link>
              ))}
            </section>
          )}
        </div>
        <aside
          className="detail-aside"
          id="batch-review"
          aria-label="변경 묶음 검토"
        >
          <div>
            <span className="eyebrow">함께 검토할 변경</span>
            <h2 className="content-subtitle">{batchLabels[batch.state]}</h2>
            <p className="field-help">변경안 {batch.items.length}개</p>
          </div>
          {actions.length > 0 && (
            <section className="panel">
              <h2 className="content-subtitle">묶음 검토</h2>
              <p className="field-help">
                승인 직전에 모든 대상 버전과 원문 공개 상태를 다시 검사합니다.
                하나라도 충돌하면 전체 게시를 멈춥니다.
              </p>
              <ContentActions
                endpoint={`/api/workspaces/${workspaceId}/proposals/${batchId}/action`}
                actions={actions}
              />
            </section>
          )}
          <Decisions items={data.decisions} />
        </aside>
      </div>
      {mayRevise && (
        <details className="panel upload-panel" id="batch-revise">
          <summary>내용을 수정해 새 묶음으로 작성</summary>
          <ProposalEditor
            workspaceId={workspaceId}
            domains={workspace.domains}
            projects={workspace.projects}
            initial={batch}
          />
        </details>
      )}
    </>
  );
}
