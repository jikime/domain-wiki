import { headers } from "next/headers";
import Link from "next/link";
import { publicationLabels } from "@/lib/content";
import { contentPage } from "@/server/page-access";
import { sourceImpact } from "@/server/services/source-impact";
export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string; sourceId: string }>;
}) {
  const { workspaceId: w, sourceId } = await params;
  const d = await contentPage(async () =>
    sourceImpact(await headers(), w, sourceId),
  );
  const base = `/w/${w}`;
  return (
    <>
      <Link className="back-link" href={`${base}/sources/${sourceId}`}>
        ← 원본 자료
      </Link>
      <div className="page-heading">
        <div>
          <h1>개정·철회 영향 확인</h1>
          <p>
            {d.source.title}에 연결된 위키·실무 기록·변경안과 내 대화입니다.
          </p>
        </div>
      </div>
      <p className="notice-box">
        새 원본을 공개하거나 현재 원본을 철회하면 구버전에 의존하는 자료가
        검색에서 빠지고 해당 근거를 사용한 답변이 가려집니다. 연결한 실무 기록의
        근거도 함께 확인합니다. 각 목록은 최대 100건이며, 다른 직원의 개인
        대화는 표시하지 않습니다.
      </p>
      {[
        { title: "연결 위키", items: d.wikis, path: "wiki" },
        { title: "연결 RFP 보고서", items: d.reports, path: "tools/rfp" },
        { title: "연결 실무 기록", items: d.records, path: "sources" },
        { title: "검토할 변경 묶음", items: d.batches, path: "proposals" },
        { title: "영향을 받는 내 대화", items: d.chats, path: "chat" },
      ].map((group) => (
        <section className="panel" key={group.path}>
          <h2 className="content-subtitle">
            {group.title} · {group.items.length}건
          </h2>
          {group.items.map((i) => (
            <Link
              className="review-row"
              key={i.version_id ?? i.id}
              href={
                group.path === "chat"
                  ? `${base}/chat?conversation=${i.id}`
                  : `${base}/${group.path}/${i.id}${i.version_id ? `?version=${i.version_id}` : ""}`
              }
            >
              <span>
                {i.title}
                {i.number ? ` · 버전 ${i.number}` : ""}
              </span>
              <span>확인 →</span>
            </Link>
          ))}
          {!group.items.length && (
            <p className="empty-copy">확인할 연결 항목이 없습니다.</p>
          )}
        </section>
      ))}
      <section className="panel">
        <h2 className="content-subtitle">원본 버전과 공개 시점</h2>
        {d.versions.map((v) => (
          <div className="decision-row" key={v.id}>
            <Link href={`${base}/sources/${sourceId}?version=${v.id}`}>
              버전 {v.number}
            </Link>
            <p>
              {
                publicationLabels[
                  v.publication as keyof typeof publicationLabels
                ]
              }{" "}
              · 등록{" "}
              {new Date(v.created_at).toLocaleString("ko-KR", {
                timeZone: "Asia/Seoul",
              })}{" "}
              · 공개{" "}
              {v.published_at
                ? new Date(v.published_at).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })
                : "미공개"}
              {v.withdrawn_at
                ? ` · 철회 ${new Date(v.withdrawn_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`
                : ""}
            </p>
          </div>
        ))}
      </section>
    </>
  );
}
