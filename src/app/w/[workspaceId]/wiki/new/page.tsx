import { headers } from "next/headers";
import { WikiEditor } from "@/components/wiki-editor";
import { contentPage, pageContext } from "@/server/page-access";
import { requireWriter } from "@/server/services/content-access";
import { workspaceData } from "@/server/services/workspace";
export default async function NewWikiPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const context = await pageContext(workspaceId);
  await contentPage(async () => requireWriter(context));
  const { domains, projects } = await workspaceData(
    await headers(),
    workspaceId,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">업무 지식의 첫 초안</span>
          <h1>위키 작성</h1>
          <p>
            확인한 내용과 적용 범위를 적고, 공개 원문의 근거를 연결해 주세요.
          </p>
        </div>
      </div>
      <section className="panel">
        <WikiEditor
          workspaceId={workspaceId}
          domains={domains}
          projects={projects}
        />
      </section>
    </>
  );
}
