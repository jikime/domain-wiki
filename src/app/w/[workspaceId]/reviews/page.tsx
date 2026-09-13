import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProcessingRefresh } from "@/components/content-controls";
import { processingLabels } from "@/lib/content";
import { pageContext } from "@/server/page-access";
import { reviewQueue } from "@/server/services/reviews";
export default async function ReviewsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const context = await pageContext(workspaceId);
  if (context.role !== "reviewer") {
    if (!context.isAdmin) notFound();
    return (
      <section className="panel">
        <h1>검토 직원 역할이 필요합니다</h1>
        <p className="muted">
          관리 권한과 검토 역할은 별도로 부여합니다. 관리 화면에서 담당자의 업무
          역할을 설정해 주세요.
        </p>
        <Link className="space-link" href={`/w/${workspaceId}/admin#members`}>
          직원 역할 관리 →
        </Link>
      </section>
    );
  }
  const queue = await reviewQueue(await headers(), workspaceId);
  const base = `/w/${workspaceId}`;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">팀이 믿고 활용할 수 있도록</span>
          <h1>검토함</h1>
          <p>
            원문과 변경 내용을 확인한 뒤 공개·게시 여부를 결정합니다. 본인 작성
            버전은 다른 검토자가 승인합니다.
          </p>
        </div>
      </div>
      <nav className="segmented-tabs" aria-label="검토 업무">
        <Link href={`/w/${workspaceId}/quality`}>품질 점검</Link>
        <Link href={`${base}/reviews`} aria-current="page">
          공개·게시 검토
        </Link>
        <Link href={`${base}/reviews/desk`}>담당·오류 처리</Link>
      </nav>
      <nav className="detail-tabs" aria-label="검토 종류">
        <a href="#review-batches">변경 묶음 {queue.batches.length}</a>
        <a href="#review-sources">자료 {queue.sources.length}</a>
        <a href="#review-wikis">위키 {queue.wikis.length}</a>
        <a href="#review-feedback">답변 의견 {queue.feedback.length}</a>
      </nav>
      <section className="panel" id="review-batches">
        <div className="section-heading">
          <h2>변경 묶음 검토</h2>
          <Link href={`${base}/proposals`}>전체 묶음 →</Link>
        </div>
        {queue.batches.map((b) => (
          <Link
            className="review-row"
            key={b.id}
            href={`${base}/proposals/${b.id}`}
          >
            <strong>{b.title}</strong>
            <span>묶음 확인 →</span>
          </Link>
        ))}
        {!queue.batches.length && (
          <p className="empty-copy">대기 중인 변경 묶음이 없습니다.</p>
        )}
      </section>
      <ProcessingRefresh
        active={queue.sources.some((item) =>
          ["queued", "processing"].includes(item.processing),
        )}
      />
      <section className="panel" id="review-sources">
        <div className="section-heading">
          <h2>자료 공개 요청</h2>
          <span>{queue.sources.length}건</span>
        </div>
        {queue.sources.map((item) => (
          <Link
            className="review-row"
            href={`${base}/sources/${item.id}?version=${item.versionId}`}
            key={item.versionId}
          >
            <div>
              <strong>{item.title}</strong>
              <p>
                버전 {item.number} · {processingLabels[item.processing]}
                {item.own ? " · 본인 등록" : ""}
              </p>
            </div>
            <span>원문 확인 →</span>
          </Link>
        ))}
        {!queue.sources.length && (
          <p className="empty-copy">대기 중인 자료가 없습니다.</p>
        )}
      </section>
      <section className="panel" id="review-wikis">
        <div className="section-heading">
          <h2>위키 게시 요청</h2>
          <span>{queue.wikis.length}건</span>
        </div>
        {queue.wikis.map((item) => (
          <Link
            className="review-row"
            href={`${base}/wiki/${item.id}?version=${item.versionId}`}
            key={item.versionId}
          >
            <div>
              <strong>{item.title}</strong>
              <p>
                버전 {item.number}
                {item.own ? " · 본인 작성" : ""}
              </p>
            </div>
            <span>변경안 확인 →</span>
          </Link>
        ))}
        {!queue.wikis.length && (
          <p className="empty-copy">대기 중인 변경안이 없습니다.</p>
        )}
      </section>
      <section className="panel" id="review-feedback">
        <div className="section-heading">
          <h2>답변 의견</h2>
          <span>{queue.feedback.length}건</span>
        </div>
        <p className="field-help">
          직원이 남긴 평가와 의견입니다. 개인 대화 본문은 공개하지 않습니다.
        </p>
        {queue.feedback.map((item) => (
          <div className="decision-row" key={item.id}>
            <strong>
              {item.rating === "helpful" ? "도움이 된 답변" : "수정 확인 요청"}
            </strong>
            <p>{item.note || "추가 의견 없음"}</p>
            <Link
              href={`${base}/reviews/desk?kind=feedback&targetId=${item.id}#review-feedback-${item.id}`}
            >
              처리하기 →
            </Link>
            <small>
              {new Date(item.createdAt).toLocaleDateString("ko-KR", {
                timeZone: "Asia/Seoul",
              })}
            </small>
          </div>
        ))}
        {!queue.feedback.length && (
          <p className="empty-copy">접수된 의견이 없습니다.</p>
        )}
      </section>
    </>
  );
}
