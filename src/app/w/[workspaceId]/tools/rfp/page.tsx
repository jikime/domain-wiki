import { headers } from "next/headers";
import Link from "next/link";
import { rfpStateLabels } from "@/lib/business";
import { pageContext } from "@/server/page-access";
import { isWriter } from "@/server/services/content-access";
import { listRfp } from "@/server/services/rfp";
export default async function RfpPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const c = await pageContext(workspaceId);
  const items = await listRfp(await headers(), workspaceId);
  const base = `/w/${workspaceId}/tools`;
  return (
    <>
      <Link className="back-link" href={base}>
        ← 업무 도구
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">요구 · 근거 · 확인 질문</span>
          <h1>RFP 분석 보고서</h1>
          <p>요청 문서의 의미와 적용할 기준을 함께 검토합니다.</p>
        </div>
        {isWriter(c) && (
          <Link className="action-link" href={`${base}/rfp/new`}>
            새 분석 작성 →
          </Link>
        )}
      </div>
      <section className="panel">
        {items.map(({ report: r, version: v, evidenceValid }) => (
          <Link className="review-row" key={r.id} href={`${base}/rfp/${r.id}`}>
            <span>
              <strong>{v.title}</strong>
              <small>
                {rfpStateLabels[v.state]} · 버전 {v.number}
                {!evidenceValid ? " · 근거 개정·철회 확인 필요" : ""}
              </small>
            </span>
            <span>열기 →</span>
          </Link>
        ))}
        {!items.length && (
          <p className="empty-copy">
            확인할 보고서가 없습니다. 작성 직원의 초안은 검토 후 공유됩니다.
          </p>
        )}
      </section>
    </>
  );
}
