import { headers } from "next/headers";
import Link from "next/link";
import {
  OfficialSiteForm,
  OfficialSiteSwitch,
} from "@/components/official-controls";
import { pageContext } from "@/server/page-access";
import { officialSites } from "@/server/services/official";
export default async function SitesPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await pageContext(workspaceId, true);
  const sites = await officialSites(await headers(), workspaceId);
  return (
    <>
      <Link className="back-link" href={`/w/${workspaceId}/admin`}>
        ← 관리
      </Link>
      <div className="page-heading">
        <div>
          <h1>수집 허용 사이트</h1>
          <p>기관의 공식 주소와 수집 범위를 확인해 등록하세요.</p>
        </div>
      </div>
      <section className="panel">
        <h2 className="content-subtitle">기관·경로 등록</h2>
        <OfficialSiteForm workspaceId={workspaceId} />
      </section>
      <section className="panel">
        <h2 className="content-subtitle">등록한 범위 · {sites.length}개</h2>
        {sites.map((s) => (
          <div className="decision-row" key={s.id}>
            <strong>{s.name}</strong>
            <p className="break-words">
              {s.origin}
              {s.pathPrefix} · {s.active ? "수집 허용" : "중지"}
            </p>
            <OfficialSiteSwitch
              workspaceId={workspaceId}
              id={s.id}
              active={s.active}
            />
          </div>
        ))}
        {!sites.length && (
          <p className="empty-copy">등록한 사이트가 없습니다.</p>
        )}
      </section>
    </>
  );
}
