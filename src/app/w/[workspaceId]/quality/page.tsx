import { headers } from "next/headers";
import Link from "next/link";
import { z } from "zod";
import { QualityWorkspace } from "@/components/quality-workspace";
import { getPool } from "@/server/db";
import { contentPage, pageContext } from "@/server/page-access";
import { requireReviewer } from "@/server/services/content-access";
import { qualityOverview } from "@/server/services/quality";
import { workspaceData } from "@/server/services/workspace";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{
    domainId?: string;
    projectId?: string;
    findingId?: string;
  }>;
}) {
  const { workspaceId: w } = await params;
  const q = await searchParams;
  const c = await pageContext(w);
  await contentPage(async () => requireReviewer(c));
  const h = await headers();
  const { domains, projects } = await workspaceData(h, w);
  let domainId = q.domainId ?? domains[0]?.id;
  let projectId = q.projectId ?? null;
  if (q.findingId && z.uuid().safeParse(q.findingId).success) {
    const found = await getPool().query<{
      domain_id: string;
      project_id: string | null;
    }>(
      "SELECT domain_id,project_id FROM quality_finding WHERE workspace_id=$1 AND id=$2",
      [w, q.findingId],
    );
    if (found.rows[0]) {
      domainId = found.rows[0].domain_id;
      projectId = found.rows[0].project_id;
    }
  }
  const data = domainId
    ? await contentPage(() => qualityOverview(h, w, { domainId, projectId }))
    : null;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">근거와 연결을 함께 확인해요</span>
          <h1>위키 품질 점검</h1>
          <p>
            문제 후보를 원문과 대조하고 수정 변경안을 검토한 뒤 다시 점검합니다.
          </p>
        </div>
      </div>
      <nav className="segmented-tabs" aria-label="검토 업무">
        <Link href={`/w/${w}/reviews`}>공개·게시 검토</Link>
        <Link href={`/w/${w}/reviews/desk`}>담당·오류 처리</Link>
        <Link href={`/w/${w}/quality`} aria-current="page">
          품질 점검
        </Link>
      </nav>
      {data ? (
        <QualityWorkspace
          key={`${domainId}:${projectId}`}
          workspaceId={w}
          domains={domains}
          projects={projects}
          data={data}
        />
      ) : (
        <p className="empty-copy">도메인을 먼저 등록해 주세요.</p>
      )}
    </>
  );
}
