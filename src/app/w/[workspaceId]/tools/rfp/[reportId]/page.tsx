import { headers } from "next/headers";
import Link from "next/link";
import { ContentActions } from "@/components/content-controls";
import { Decisions } from "@/components/content-view";
import { rfpKindLabels, rfpStateLabels } from "@/lib/business";
import { locatorLabel } from "@/lib/content";
import { contentPage, pageContext } from "@/server/page-access";
import { rfpDetails } from "@/server/services/rfp";
export default async function RfpDetail({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; reportId: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { workspaceId, reportId } = await params;
  const { version } = await searchParams;
  const c = await pageContext(workspaceId);
  const d = await contentPage(async () =>
    rfpDetails(await headers(), workspaceId, reportId, version),
  );
  const base = `/w/${workspaceId}`;
  const actions: { value: string; label: string }[] = [];
  if (
    d.canManage &&
    d.version.id === d.report.latestVersionId &&
    d.version.state === "draft"
  )
    actions.push({ value: "submit", label: "검토 요청" });
  if (
    c.role === "reviewer" &&
    d.version.id === d.report.latestVersionId &&
    d.version.state === "submitted"
  ) {
    if (d.version.authorId !== c.user.id && d.evidenceValid)
      actions.push({ value: "approve", label: "검토 완료·게시" });
    actions.push({ value: "reject", label: "수정 요청" });
  }
  if (c.role === "reviewer" && d.version.id === d.report.publishedVersionId)
    actions.push({ value: "withdraw", label: "게시 철회" });
  return (
    <>
      <Link className="back-link" href={`${base}/tools/rfp`}>
        ← RFP 보고서
      </Link>
      <div className="page-heading detail-heading">
        <div>
          <span className="eyebrow">
            {rfpStateLabels[d.version.state]} · 버전 {d.version.number}
          </span>
          <h1>{d.version.title}</h1>
          <p>
            {d.version.origin === "model"
              ? "AI가 제안한 분석을 직원이 검토하는 보고서입니다."
              : "직원이 원문을 바탕으로 작성한 분석입니다."}
          </p>
        </div>
      </div>
      <nav className="detail-tabs" aria-label="보고서 상세 탐색">
        <a href="#rfp-body">분석 내용</a>
        <a href="#rfp-review">검토·버전</a>
      </nav>
      <div className="detail-layout">
        <div className="detail-body" id="rfp-body">
          {!d.evidenceValid && (
            <p className="notice-box">
              근거가 개정·철회되어 직원 공유와 내보내기를 제한했습니다. 최신
              원문을 연결해 새 버전을 검토해 주세요.
            </p>
          )}
          <p className="field-help">
            명시 요구와 기준·사례·추론을 구분합니다. 기준의 적용 여부와 예외는
            아래 원문·확인 질문을 함께 검토하세요.
          </p>
          {d.version.sections.map((s, index) => (
            <section
              className={`panel rfp-section rfp-${s.kind}`}
              key={`${index}-${s.title}`}
            >
              <span className="small-tag">
                {rfpKindLabels[s.kind]}
                {s.kind === "inference" ? " · 확인 필요" : ""}
              </span>
              <h2 className="content-subtitle">{s.title}</h2>
              <p className="whitespace-pre-wrap">{s.meaning}</p>
              {s.quote && (
                <blockquote className="rfp-quote">
                  <strong>원문 구절</strong>
                  <p>{s.quote}</p>
                </blockquote>
              )}
              <div>
                {s.chunkIds.map((id) => {
                  const e = d.evidence.find((e) => e.id === id);
                  return e ? (
                    <Link
                      className="review-row"
                      key={id}
                      href={`${base}/sources/${e.sourceId}?version=${e.versionId}#chunk-${id}`}
                    >
                      <span>
                        {e.title} · {locatorLabel(e.locator)}
                      </span>
                      <span>근거 →</span>
                    </Link>
                  ) : (
                    <p className="notice-box" key={id}>
                      현재 확인할 수 없는 근거입니다.
                    </p>
                  );
                })}
              </div>
              {s.questions.length > 0 && (
                <div className="rfp-questions">
                  <h3>확인할 질문</h3>
                  <ul>
                    {s.questions.map((q, i) => (
                      <li key={`${i}-${q}`}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ))}
        </div>
        <aside
          className="detail-aside"
          id="rfp-review"
          aria-label="보고서 정보와 검토"
        >
          <div>
            <span className="eyebrow">원문을 바탕으로 정리한 분석</span>
            <h2 className="content-subtitle">
              {rfpStateLabels[d.version.state]}
            </h2>
            <p className="field-help">
              버전 {d.version.number} · 분석 항목 {d.version.sections.length}개
            </p>
          </div>
          <div className="form-actions">
            <Link
              className="action-link"
              href={`${base}/sources/${d.report.sourceId}`}
            >
              RFP 원문 확인 →
            </Link>
            {d.canManage && (
              <Link
                className="action-link"
                href={`${base}/tools/rfp/${reportId}/edit`}
              >
                새 버전으로 수정 →
              </Link>
            )}
            {d.evidenceValid && (
              <a
                className="action-link"
                href={`/api/workspaces/${workspaceId}/rfp/${reportId}/file`}
              >
                보고서 내려받기
              </a>
            )}
          </div>
          {actions.length > 0 && (
            <section className="panel">
              <h2 className="content-subtitle">보고서 검토</h2>
              <ContentActions
                endpoint={`/api/workspaces/${workspaceId}/rfp-versions/${d.version.id}/action`}
                actions={actions}
                noteLabel="검토한 범위·원문·적용 조건 (승인·수정 요청·철회 시 필수)"
              />
            </section>
          )}
          <Decisions items={d.decisions} />
          {d.versions.length > 1 && (
            <section className="panel">
              <h2 className="content-subtitle">저장한 버전</h2>
              {d.versions.map((v) => (
                <Link
                  className="review-row"
                  key={v.id}
                  href={`${base}/tools/rfp/${reportId}?version=${v.id}`}
                >
                  버전 {v.number} · {rfpStateLabels[v.state]}
                </Link>
              ))}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
