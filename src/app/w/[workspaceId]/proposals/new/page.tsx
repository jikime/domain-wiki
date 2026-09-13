import { headers } from "next/headers";
import Link from "next/link";
import { ProposalEditor } from "@/components/proposal-editor";
import { contentPage, pageContext } from "@/server/page-access";
import { requireWriter } from "@/server/services/content-access";
import { workspaceData } from "@/server/services/workspace";
export default async function NewProposal({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await contentPage(async () => requireWriter(await pageContext(workspaceId)));
  const workspace = await workspaceData(await headers(), workspaceId);
  return (
    <>
      <Link className="back-link" href={`/w/${workspaceId}/proposals`}>
        ← 변경 묶음
      </Link>
      <div className="page-heading">
        <div>
          <h1>위키 변경 묶음 작성</h1>
          <p>여러 위키의 새 작성·수정·병합을 하나의 검토 요청으로 남깁니다.</p>
        </div>
      </div>
      <ProposalEditor
        workspaceId={workspaceId}
        domains={workspace.domains}
        projects={workspace.projects}
      />
    </>
  );
}
