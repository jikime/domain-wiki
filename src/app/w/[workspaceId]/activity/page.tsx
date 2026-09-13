import { headers } from "next/headers";
import Link from "next/link";
import { ActivityReadButton } from "@/components/activity-controls";
import { ListPagination } from "@/components/list-pagination";
import { contentPage } from "@/server/page-access";
import { myActivity } from "@/server/services/activity";

const labels: Record<string, string> = {
  approve: "승인",
  reject: "반려",
  withdraw: "철회",
  triage: "확인 시작",
  resolve: "처리 완료",
  reopen: "다시 접수",
  pending: "공개 검토 대기",
  draft: "작성 초안",
  submitted: "검토 대기",
  rejected: "수정 필요",
};
const kinds: Record<string, string> = {
  source: "자료",
  wiki: "위키",
  batch: "변경 묶음",
  rfp: "RFP",
  issue: "자료 신고",
  feedback: "답변 의견",
};
export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ page?: string; unread?: string }>;
}) {
  const { workspaceId: w } = await params,
    query = await searchParams;
  const d = await contentPage(async () =>
    myActivity(await headers(), w, query),
  );
  const base = `/w/${w}`,
    unreadKeys = d.notifications.items
      .filter((n) => n.unread)
      .map((n) => n.key);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">내가 남긴 기록의 다음 단계</span>
          <h1>내 활동</h1>
          <p>
            작성한 자료의 검토 결과와 내 신고·답변 의견의 처리 상태를
            확인합니다.
          </p>
        </div>
      </div>
      <nav className="activity-shortcuts" aria-label="내 활동 바로가기">
        <Link href={`${base}/issues`}>내 신고·답변 의견 →</Link>
        <Link href={`${base}/projects`}>프로젝트 살펴보기 →</Link>
        <Link href={`${base}/account`}>계정·비밀번호 →</Link>
        {d.reviews.pending > 0 && (
          <Link href={`${base}/reviews`}>
            검토 대기 {d.reviews.pending}건 →
          </Link>
        )}
        {d.reviews.assigned > 0 && (
          <Link href={`${base}/reviews/desk?filter=mine`}>
            내 담당 {d.reviews.assigned}건 →
          </Link>
        )}
      </nav>
      <section className="panel" aria-labelledby="activity-results">
        <div className="section-heading">
          <h2 id="activity-results" className="content-subtitle">
            처리 결과 <span className="state-label">미확인 {d.unread}건</span>
          </h2>
          <ActivityReadButton workspaceId={w} keys={unreadKeys} all />
        </div>
        <nav className="segmented-tabs" aria-label="처리 결과 확인 범위">
          <Link
            href={`${base}/activity`}
            aria-current={query.unread !== "true" ? "page" : undefined}
          >
            전체 결과
          </Link>
          <Link
            href={`${base}/activity?unread=true`}
            aria-current={query.unread === "true" ? "page" : undefined}
          >
            미확인 결과
          </Link>
        </nav>
        {d.notifications.items.map((n) => (
          <article
            className="decision-row activity-result"
            key={n.key}
            data-unread={n.unread}
          >
            <div className="section-heading">
              <span className="small-tag">
                {kinds[n.kind]} · {labels[n.action] ?? n.action}
              </span>
              {n.unread && <span className="state-label">새 처리 결과</span>}
            </div>
            <h3>
              <Link href={n.href}>{n.title} →</Link>
            </h3>
            {n.note && <p className="whitespace-pre-wrap">{n.note}</p>}
            <small>
              {n.created_at.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
            </small>
            {n.unread && <ActivityReadButton workspaceId={w} keys={[n.key]} />}
          </article>
        ))}
        {!d.notifications.items.length && (
          <p className="empty-copy">
            {query.unread === "true"
              ? "확인하지 않은 처리 결과가 없습니다."
              : "아직 동료의 검토·처리 결과가 없습니다."}
          </p>
        )}
        <ListPagination
          base={`${base}/activity`}
          result={d.notifications}
          values={query}
        />
      </section>
      {d.canWrite && (
        <section className="panel">
          <div className="section-heading">
            <h2 className="content-subtitle">내 작성·검토 대기</h2>
            <span className="field-help">최근 20건</span>
          </div>
          <nav className="activity-shortcuts" aria-label="내 작성 목록">
            <Link href={`${base}/sources?mode=manage&mine=true`}>
              내 자료 전체 →
            </Link>
            <Link href={`${base}/wiki?mode=manage&mine=true`}>
              내 위키 전체 →
            </Link>
            <Link href={`${base}/proposals`}>변경 묶음 →</Link>
            <Link href={`${base}/tools/rfp`}>RFP 보고서 →</Link>
          </nav>
          {d.drafts.map((item) => (
            <Link
              className="review-row"
              href={item.href}
              key={`${item.kind}:${item.target_id}`}
            >
              <div>
                <span className="small-tag">
                  {kinds[item.kind]} · {labels[item.state] ?? item.state}
                </span>
                <h3>{item.title}</h3>
              </div>
              <span>이어서 확인 →</span>
            </Link>
          ))}
          {!d.drafts.length && (
            <p className="empty-copy">
              작성 중이거나 검토를 기다리는 자료가 없습니다.
            </p>
          )}
        </section>
      )}
    </>
  );
}
