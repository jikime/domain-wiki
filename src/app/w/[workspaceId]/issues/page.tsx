import { headers } from "next/headers";
import Link from "next/link";
import { contentPage } from "@/server/page-access";
import { myIssues } from "@/server/services/review-desk";
export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId: w } = await params;
  const d = await contentPage(async () => myIssues(await headers(), w));
  const labels: Record<string, string> = {
    open: "접수",
    triaged: "확인 중",
    resolved: "처리 완료",
  };
  return (
    <>
      <Link className="back-link" href={`/w/${w}/activity`}>
        ← 내 활동
      </Link>
      <div className="page-heading">
        <div>
          <h1>내 신고와 답변 의견</h1>
          <p>내가 남긴 의견과 검토 직원의 처리 결과를 확인합니다.</p>
        </div>
      </div>
      {d.issues.map((i) => (
        <section className="panel" key={i.id} id={`issue-${i.id}`}>
          <h2 className="content-subtitle">{i.title}</h2>
          <span className="state-label">{labels[i.state]}</span>
          <p className="whitespace-pre-wrap">{i.note}</p>
          {i.resolution && (
            <p className="notice-box whitespace-pre-wrap">{i.resolution}</p>
          )}
          {i.fixedWikiId && (
            <Link href={`/w/${w}/wiki/${i.fixedWikiId}`}>
              수정 게시 위키 확인 →
            </Link>
          )}
          {d.events
            .filter((e) => e.target_id === i.id)
            .map((e, n) => (
              <p className="decision-row" key={`${e.created_at}:${n}`}>
                {new Date(e.created_at).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })}{" "}
                · {e.note}
              </p>
            ))}
        </section>
      ))}
      <section className="panel" id="answer-feedback">
        <h2 className="content-subtitle">답변 의견</h2>
        {d.feedback.map((f) => (
          <div className="decision-row" key={f.id} id={`feedback-${f.id}`}>
            <strong>
              {f.rating === "helpful" ? "도움이 된 답변" : "수정 확인 요청"} ·{" "}
              {labels[f.state]}
            </strong>
            <p>{f.note || "추가 의견 없음"}</p>
            <Link
              href={`/w/${w}/chat?conversation=${f.conversation_id}#run-${f.run_id}`}
            >
              의견을 남긴 원래 답변 →
            </Link>
            {d.events
              .filter((e) => e.target_id === f.id)
              .map((e, n) => (
                <p key={`${e.created_at}:${n}`}>{e.note}</p>
              ))}
          </div>
        ))}
        {!d.feedback.length && (
          <p className="empty-copy">등록한 답변 의견이 없습니다.</p>
        )}
      </section>
      {!d.issues.length && (
        <p className="empty-copy">등록한 자료 오류 신고가 없습니다.</p>
      )}
    </>
  );
}
