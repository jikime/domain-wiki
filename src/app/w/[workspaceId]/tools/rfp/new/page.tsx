import { headers } from "next/headers";
import Link from "next/link";
import { RfpEditor, RfpSourceChooser } from "@/components/rfp-editor";
import { modelStatus } from "@/server/ai/client";
import { contentPage, pageContext } from "@/server/page-access";
import { requireWriter } from "@/server/services/content-access";
import { rfpContext } from "@/server/services/rfp";
import { listSources } from "@/server/services/sources";
export default async function RfpNew({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ sourceId?: string }>;
}) {
  const { workspaceId } = await params;
  const { sourceId } = await searchParams;
  const d = await contentPage(async () => {
    requireWriter(await pageContext(workspaceId));
    const h = await headers();
    const items = (await listSources(h, workspaceId)).filter(
      (s) => s.publishedVersionId && s.category !== "testimony",
    );
    const context = sourceId
      ? await rfpContext(h, workspaceId, sourceId)
      : null;
    return { items, context };
  });
  return (
    <>
      <Link className="back-link" href={`/w/${workspaceId}/tools/rfp`}>
        ← RFP 보고서
      </Link>
      <div className="page-heading">
        <div>
          <h1>RFP 분석 작성</h1>
          <p>
            원문 구절과 근거를 연결하고, 적용 여부를 확인할 질문을 남겨 주세요.
          </p>
        </div>
      </div>
      <section className="panel">
        <RfpSourceChooser
          workspaceId={workspaceId}
          sourceId={sourceId}
          items={d.items}
        />
      </section>
      {d.context && (
        <RfpEditor
          key={sourceId}
          workspaceId={workspaceId}
          context={d.context}
          modelConfigured={modelStatus().chatConfigured}
        />
      )}
    </>
  );
}
