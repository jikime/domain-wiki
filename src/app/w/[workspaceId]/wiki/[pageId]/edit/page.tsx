import { headers } from "next/headers";
import { WikiEditor } from "@/components/wiki-editor";
import { contentPage, pageContext } from "@/server/page-access";
import { requireWriter } from "@/server/services/content-access";
import { wikiDetails } from "@/server/services/wiki";
import { workspaceData } from "@/server/services/workspace";
export default async function EditWikiPage({
  params,
}: {
  params: Promise<{ workspaceId: string; pageId: string }>;
}) {
  const { workspaceId, pageId } = await params;
  const context = await pageContext(workspaceId);
  await contentPage(async () => requireWriter(context));
  const requestHeaders = await headers();
  const [data, { domains, projects }] = await contentPage(() =>
    Promise.all([
      wikiDetails(requestHeaders, workspaceId, pageId),
      workspaceData(requestHeaders, workspaceId),
    ]),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">기존 지식에 변경 제안</span>
          <h1>새 변경안 작성</h1>
          <p>현재 게시본은 유지되고, 저장한 변경안은 별도 검토를 거칩니다.</p>
        </div>
      </div>
      <section className="panel">
        <WikiEditor
          workspaceId={workspaceId}
          domains={domains}
          projects={projects}
          initial={{
            pageId,
            versionId: data.version.id,
            linkDestinations: data.linkDestinations,
            title: data.version.title,
            body: data.version.body,
            metadata: data.version.metadata,
            domainId: data.page.domainId,
            projectId: data.page.projectId,
            parentVersionId: data.page.latestVersionId ?? null,
            basePublishedVersionId: data.page.publishedVersionId,
            evidence: data.evidence
              .filter((item) => item.available)
              .map((item) => ({
                kind: "source",
                id: item.sourceId,
                versionId: item.versionId,
                title: item.sourceTitle,
                excerpt: item.text,
                domainId: data.page.domainId,
                projectId: data.page.projectId,
                href: `/w/${workspaceId}/sources/${item.sourceId}?version=${item.versionId}#chunk-${item.id}`,
                locator: item.locator,
                chunkId: item.id,
              })),
          }}
        />
      </section>
    </>
  );
}
