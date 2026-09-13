import { headers } from "next/headers";
import Link from "next/link";
import { RfpEditor } from "@/components/rfp-editor";
import { AccessError } from "@/server/access";
import { modelStatus } from "@/server/ai/client";
import { contentPage } from "@/server/page-access";
import { rfpContext, rfpDetails } from "@/server/services/rfp";
export default async function RfpEdit({
  params,
}: {
  params: Promise<{ workspaceId: string; reportId: string }>;
}) {
  const { workspaceId, reportId } = await params;
  const d = await contentPage(async () => {
    const h = await headers();
    const report = await rfpDetails(h, workspaceId, reportId);
    if (!report.canManage)
      throw new AccessError(403, "수정 권한이 필요합니다.");
    return {
      report,
      context: await rfpContext(h, workspaceId, report.report.sourceId),
    };
  });
  return (
    <>
      <Link
        className="back-link"
        href={`/w/${workspaceId}/tools/rfp/${reportId}`}
      >
        ← 보고서
      </Link>
      <div className="page-heading">
        <div>
          <h1>RFP 분석 수정</h1>
          <p>기존 버전을 보관하고 새로운 초안으로 저장합니다.</p>
        </div>
      </div>
      <RfpEditor
        key={d.report.version.id}
        workspaceId={workspaceId}
        context={d.context}
        initial={d.report}
        modelConfigured={modelStatus().chatConfigured}
      />
    </>
  );
}
