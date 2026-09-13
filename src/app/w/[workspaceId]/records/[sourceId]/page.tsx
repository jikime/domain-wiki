import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordEditor } from "@/components/record-editor";
import { contentPage } from "@/server/page-access";
import { sourceDetails } from "@/server/services/sources";
import { workspaceData } from "@/server/services/workspace";
export default async function EditRecord({
  params,
}: {
  params: Promise<{ workspaceId: string; sourceId: string }>;
}) {
  const { workspaceId, sourceId } = await params;
  const requestHeaders = await headers();
  const data = await contentPage(() =>
    sourceDetails(requestHeaders, workspaceId, sourceId),
  );
  if (!data.canManage || !data.version?.testimony) notFound();
  const workspace = await workspaceData(requestHeaders, workspaceId);
  return (
    <>
      <Link
        className="back-link"
        href={`/w/${workspaceId}/sources/${sourceId}`}
      >
        ← 기록으로 돌아가기
      </Link>
      <div className="page-heading">
        <div>
          <h1>실무 기록 개정</h1>
          <p>이전 버전은 그대로 보관하고 새 버전을 검토 요청합니다.</p>
        </div>
      </div>
      <section className="panel">
        <RecordEditor
          workspaceId={workspaceId}
          domains={workspace.domains}
          projects={workspace.projects}
          initial={{
            sourceId,
            versionId: data.version.id,
            title: data.source.title,
            domainId: data.source.domainId,
            projectId: data.source.projectId,
            testimony: data.version.testimony,
          }}
        />
      </section>
    </>
  );
}
