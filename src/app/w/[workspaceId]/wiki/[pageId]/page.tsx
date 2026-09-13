import { diffLines } from "diff";
import { headers } from "next/headers";
import Link from "next/link";
import { ContentActions } from "@/components/content-controls";
import { Decisions, SearchResults } from "@/components/content-view";
import { IssueReport } from "@/components/operations-controls";
import { SelectionReader } from "@/components/selection-assistant";
import { locatorLabel, wikiLabels } from "@/lib/content";
import { wikiTypeLabels } from "@/lib/wiki-metadata";
import { contentPage } from "@/server/page-access";
import { wikiRelations } from "@/server/services/discovery";
import { wikiDetails } from "@/server/services/wiki";
export default async function WikiPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; pageId: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { workspaceId, pageId } = await params;
  const { version: selected } = await searchParams;
  const data = await contentPage(async () =>
    wikiDetails(await headers(), workspaceId, pageId, selected),
  );
  const version = data.version;
  const base = `/w/${workspaceId}`;
  const relations =
    data.evidenceValid && version.id === data.page.publishedVersionId
      ? await wikiRelations(await headers(), workspaceId, pageId)
      : null;
  const actions: { value: string; label: string }[] = [];
  if (data.canSubmit && version.state === "draft")
    actions.push({ value: "submit", label: "검토 요청" });
  if (data.canReview && version.state === "submitted") {
    if (data.canApprove)
      actions.push({ value: "approve", label: "위키 게시 승인" });
    actions.push({ value: "reject", label: "반려" });
  }
  if (data.canReview && data.page.publishedVersionId === version.id)
    actions.push({ value: "withdraw", label: "게시 철회" });
  return (
    <>
      <Link className="back-link" href={`${base}/wiki`}>
        ← 위키 목록
      </Link>
      <div className="page-heading detail-heading">
        <div>
          <span className="eyebrow">
            {wikiLabels[version.state]} · 버전 {version.number}
          </span>
          <h1>{version.title}</h1>
          <p>기록한 주장과 연결한 원문을 함께 확인해 주세요.</p>
          <p className="field-help">
            유형:{" "}
            {wikiTypeLabels[version.metadata.type] ?? version.metadata.type}
            {version.metadata.aliases.length
              ? ` · 별칭: ${version.metadata.aliases.join(", ")}`
              : ""}
          </p>
        </div>
        {data.canWrite && (
          <Link className="action-link" href={`${base}/wiki/${pageId}/edit`}>
            새 변경안 작성
          </Link>
        )}
      </div>
      {!data.evidenceValid && (
        <p className="notice-box">
          연결한 원문이 철회되거나 새 버전으로 바뀌었습니다. 일반 직원의
          조회·검색에서 제외되며 근거를 다시 연결해야 합니다.
        </p>
      )}
      {data.evidenceValid && version.id === data.page.publishedVersionId && (
        <Link
          href={`${base}/graph?domainId=${data.page.domainId}${data.page.projectId ? `&projectId=${data.page.projectId}` : ""}&focusId=${data.page.id}`}
        >
          지식 그래프에서 주변 탐색 →
        </Link>
      )}
      {version.state !== "approved" && (
        <p className="notice-box">
          현재 보고 있는 버전은 게시본이 아닙니다. 승인 전에는 일반 직원에게
          보이지 않습니다.
        </p>
      )}
      <nav className="detail-tabs" aria-label="위키 상세 탐색">
        <a href="#wiki-body">본문</a>
        <a href="#wiki-evidence">원문 근거 {data.evidence.length}</a>
        {data.canWrite && <a href="#wiki-versions">버전·변경</a>}
        {relations && <a href="#wiki-relations">관련 지식</a>}
      </nav>
      <div className="detail-layout">
        <div className="detail-body">
          <section className="panel wiki-reading" id="wiki-body">
            <SelectionReader
              workspaceId={workspaceId}
              scope={{
                domainId: data.page.domainId,
                projectId: data.page.projectId,
                pageId,
                versionId: version.id,
                latestVersionId: data.page.latestVersionId ?? null,
              }}
              value={version.body}
              linkDestinations={data.linkDestinations}
            />
          </section>
          <section className="panel" id="wiki-evidence">
            <div className="section-heading">
              <h2>연결한 원문 근거</h2>
              <span>{data.evidence.length}개</span>
            </div>
            {data.evidence.map((item, index) => (
              <article className="source-passage" key={item.id}>
                <a
                  href={`${base}/sources/${item.sourceId}?version=${item.versionId}#chunk-${item.id}`}
                >
                  <strong>
                    [{index + 1}] {item.sourceTitle}
                  </strong>
                  <span className="passage-label">
                    {" "}
                    · 버전 {item.versionNumber} · {locatorLabel(item.locator)} ↗
                  </span>
                </a>
                {!item.available && (
                  <span className="state-label state-warning">
                    현재 근거 사용 불가
                  </span>
                )}
                <pre>{item.text}</pre>
              </article>
            ))}
            {!data.evidence.length && (
              <p className="empty-copy">
                공개된 원문의 문단을 연결한 뒤 검토를 요청해 주세요.
              </p>
            )}
          </section>
          <div id="wiki-relations">
            {relations && (
              <>
                <section className="panel">
                  <h2 className="content-subtitle">지식 연결 보기</h2>
                  <div className="knowledge-connections">
                    <div className="relation-node">
                      <strong>검토된 원문 근거</strong>
                      <p>{data.evidence.length}개 문단 · 위의 근거에서 확인</p>
                    </div>
                    <span className="relation-arrow" aria-hidden="true">
                      →
                    </span>
                    <div className="relation-node relation-current">
                      <strong>{version.title}</strong>
                      <p>현재 게시 위키</p>
                    </div>
                    <span className="relation-arrow" aria-hidden="true">
                      ⇢
                    </span>
                    <div className="relation-node relation-suggested">
                      <strong>함께 살펴볼 자료</strong>
                      <p>
                        {relations.suggestions.length}개 · 위키 관계와 검색어로
                        찾은 자료
                      </p>
                    </div>
                  </div>
                  <p className="field-help">
                    오른쪽 자료는 자동으로 찾은 관련 자료입니다. 이 위키의
                    주장을 뒷받침하는 승인 근거는 위의 ‘연결한 원문 근거’에서
                    확인해 주세요.
                  </p>
                </section>
                <section className="panel">
                  <h2 className="content-subtitle">관련 규정·사례 살펴보기</h2>
                  {relations.suggestions.length ? (
                    <SearchResults items={relations.suggestions} />
                  ) : (
                    <p className="empty-copy">
                      현재 공개 자료에서 연관된 규정·사례를 찾지 못했습니다.
                    </p>
                  )}
                </section>
                <section className="panel">
                  <h2 className="content-subtitle">
                    업무에 적용하기 전 확인할 질문
                  </h2>
                  <p className="field-help">
                    답변을 확정하기 전에 점검할 공통 질문입니다.
                  </p>
                  <ul className="reading-list">
                    {relations.questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                  <Link
                    className="action-link"
                    href={`${base}/chat?wikiId=${pageId}&domainId=${data.page.domainId}${data.page.projectId ? `&projectId=${data.page.projectId}` : ""}`}
                  >
                    이 위키를 바탕으로 질문하기
                  </Link>
                </section>
              </>
            )}
          </div>
        </div>
        <aside className="detail-aside" aria-label="위키 정보와 작업">
          <div>
            <span className="eyebrow">현재 열람 중인 버전</span>
            <h2 className="content-subtitle">위키 정보</h2>
            <dl className="model-summary">
              <dt>공개 상태</dt>
              <dd>{wikiLabels[version.state]}</dd>
              <dt>문서 버전</dt>
              <dd>{version.number}</dd>
            </dl>
            <p className="field-help">
              연결한 원문 근거 {data.evidence.length}개
            </p>
          </div>
          {version.state === "approved" &&
            data.evidenceValid &&
            data.page.publishedVersionId === version.id && (
              <Link
                className="action-link"
                href={`${base}/chat?wikiId=${pageId}&domainId=${data.page.domainId}${data.page.projectId ? `&projectId=${data.page.projectId}` : ""}`}
              >
                이 위키에 질문하기
              </Link>
            )}
          {actions.length > 0 && (
            <section className="panel">
              <h2 className="content-subtitle">검토와 게시</h2>
              <ContentActions
                endpoint={`/api/workspaces/${workspaceId}/wiki-versions/${version.id}/action`}
                actions={actions}
              />
            </section>
          )}
          {data.canWrite && (
            <section className="panel" id="wiki-versions">
              <h2 className="content-subtitle">버전과 변경 내용</h2>
              <div className="version-links">
                {data.versions.map((item) => (
                  <Link
                    key={item.id}
                    href={`${base}/wiki/${pageId}?version=${item.id}`}
                    aria-current={item.id === version.id ? "page" : undefined}
                  >
                    버전 {item.number} · {wikiLabels[item.state]}
                  </Link>
                ))}
              </div>
              <details className="diff-details">
                <summary>기준 게시본과 차이 보기</summary>
                <p className="field-help">
                  추가된 줄은 +, 삭제된 줄은 −로 표시합니다. 비교 기준:{" "}
                  {data.base
                    ? `버전 ${data.base.number}`
                    : "이전 게시본 없음 또는 접근 제한"}
                </p>
                <div className="diff-block">
                  {diffLines(data.base?.body ?? "", version.body).map(
                    (part, index) => (
                      <pre
                        className={
                          part.added
                            ? "diff-added"
                            : part.removed
                              ? "diff-removed"
                              : "diff-same"
                        }
                        key={`${index}-${part.count}`}
                      >
                        {part.added ? "+ " : part.removed ? "− " : "  "}
                        {part.value}
                      </pre>
                    ),
                  )}
                </div>
              </details>
            </section>
          )}
          <IssueReport
            workspaceId={workspaceId}
            kind="wiki"
            targetId={pageId}
          />
          <Decisions items={data.decisions} />
        </aside>
      </div>
    </>
  );
}
