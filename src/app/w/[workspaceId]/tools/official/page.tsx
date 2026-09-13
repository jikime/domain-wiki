import { headers } from "next/headers";
import Link from "next/link";
import { OfficialCollectForm } from "@/components/official-controls";
import { officialStateLabels } from "@/lib/business";
import { contentPage } from "@/server/page-access";
import { listOfficial, officialSites } from "@/server/services/official";
import { workspaceData } from "@/server/services/workspace";
export default async function OfficialPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const d = await contentPage(async () => {
    const h = await headers();
    const [items, sites, workspace] = await Promise.all([
      listOfficial(h, workspaceId),
      officialSites(h, workspaceId),
      workspaceData(h, workspaceId),
    ]);
    return { items, sites, workspace };
  });
  return (
    <>
      <Link className="back-link" href={`/w/${workspaceId}/tools`}>
        ← 업무 도구
      </Link>
      <div className="page-heading">
        <div>
          <h1>공식 자료 수집</h1>
          <p>원문을 먼저 확보하고, 기관·발행일·시행일·첨부를 대조해 주세요.</p>
        </div>
      </div>
      <section className="panel">
        <h2 className="content-subtitle">자료 후보 등록</h2>
        <OfficialCollectForm
          workspaceId={workspaceId}
          domains={d.workspace.domains}
          projects={d.workspace.projects}
          hasSites={d.sites.some((s) => s.active)}
        />
        <details>
          <summary>현재 허용한 기관·경로</summary>
          {d.sites
            .filter((s) => s.active)
            .map((s) => (
              <p key={s.id} className="break-words">
                {s.name} · {s.origin}
                {s.pathPrefix}
              </p>
            ))}
        </details>
      </section>
      <section className="panel">
        <h2 className="content-subtitle">최근 자료 후보 · 최대 100건</h2>
        {d.items.map(({ candidate: c, publisher, current }) => (
          <Link
            className="review-row"
            key={c.id}
            href={`/w/${workspaceId}/tools/official/${c.id}`}
          >
            <span>
              <strong>{c.title}</strong>
              <small>
                {publisher} · {officialStateLabels[c.state]}
                {c.state === "verified" && !current
                  ? " · 원문 개정·철회 확인 필요"
                  : ""}
              </small>
            </span>
            <span>확인 →</span>
          </Link>
        ))}
        {!d.items.length && (
          <p className="empty-copy">등록한 자료 후보가 없습니다.</p>
        )}
      </section>
    </>
  );
}
