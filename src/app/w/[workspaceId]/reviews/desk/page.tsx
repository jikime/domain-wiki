import { headers } from "next/headers";
import Link from "next/link";
import { ReviewDeskControls } from "@/components/operations-controls";
import { contentPage } from "@/server/page-access";
import { reviewDesk } from "@/server/services/review-desk";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ kind?: string; targetId?: string; filter?: string }>;
}) {
  const { workspaceId: w } = await params;
  const query = await searchParams;
  const d = await contentPage(async () =>
    reviewDesk(await headers(), w, query),
  );
  return (
    <>
      <Link className="back-link" href={`/w/${w}/reviews`}>
        ← 검토함
      </Link>
      <div className="page-heading">
        <div>
          <h1>담당 검토·오류 처리</h1>
          <p>
            오래 기다린 요청부터 확인합니다. 신고 이유와 답변 의견은 검토
            직원에게 공유되며 개인 대화는 표시하지 않습니다.
          </p>
        </div>
      </div>
      <nav className="segmented-tabs" aria-label="검토 업무">
        <Link href={`/w/${w}/quality`}>품질 점검</Link>
        <Link href={`/w/${w}/reviews`}>공개·게시 검토</Link>
        <Link href={`/w/${w}/reviews/desk`} aria-current="page">
          담당·오류 처리
        </Link>
      </nav>
      <ReviewDeskControls
        key={`${query.kind ?? ""}:${query.targetId ?? ""}:${query.filter ?? ""}`}
        workspaceId={w}
        targets={d.targets}
        reviewers={d.reviewers}
        me={d.me}
        wikis={d.wikis}
        focused={!!query.targetId}
        initialFilter={query.filter ?? "all"}
      />
      <section className="panel">
        <h2 className="content-subtitle">최근 담당·처리 이력</h2>
        {d.events.map((e) => (
          <div className="decision-row" key={e.id}>
            <strong>
              {(
                {
                  assign: "담당 지정",
                  triage: "확인 시작",
                  resolve: "처리 완료",
                  reopen: "다시 접수",
                  defer: "사유를 남기고 보류",
                  detected: "새 점검 후보",
                  recurred: "문제 재발",
                  rechecked: "개정 후 재확인",
                  "not-reproduced": "이번 AI 점검에서 미발견",
                  "auto-resolved": "재점검으로 해결 확인",
                  policy: "점검 설정 변경",
                } as Record<string, string>
              )[e.action] ?? e.action}
            </strong>
            <p className="whitespace-pre-wrap">{e.note}</p>
            <small>
              {new Date(e.createdAt).toLocaleString("ko-KR", {
                timeZone: "Asia/Seoul",
              })}
            </small>
          </div>
        ))}
      </section>
    </>
  );
}
