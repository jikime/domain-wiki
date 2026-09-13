import { headers } from "next/headers";
import Link from "next/link";
import { SourceImportWorkspace } from "@/components/source-import-workspace";
import { contentPage, pageContext } from "@/server/page-access";
import { requireWriter } from "@/server/services/content-access";
import { workspaceData } from "@/server/services/workspace";
export default async function SourceImportsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const context = await pageContext(workspaceId);
  await contentPage(async () => requireWriter(context));
  const data = await workspaceData(await headers(), workspaceId);
  return (
    <>
      <div className="page-heading">
        <div>
          <Link href={`/w/${workspaceId}/sources`}>자료실로 돌아가기</Link>
          <h1>파일·폴더 가져오기</h1>
          <p>
            여러 파일의 경로를 보존하고, 바뀐 자료를 같은 기록에서 이어서
            가져옵니다.
          </p>
        </div>
      </div>
      <SourceImportWorkspace
        workspaceId={workspaceId}
        domains={data.domains}
        projects={data.projects}
      />
    </>
  );
}
