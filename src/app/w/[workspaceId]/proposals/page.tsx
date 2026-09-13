import { headers } from "next/headers";
import Link from "next/link";
import { batchLabels } from "@/lib/proposals";
import { contentPage } from "@/server/page-access";
import { listBatches } from "@/server/services/proposals";
export default async function ProposalsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const rows = await contentPage(async () =>
    listBatches(await headers(), workspaceId),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">근거를 확인하고 함께 게시하는 변경</span>
          <h1>위키 변경 묶음</h1>
          <p>작성자는 본인의 제안을, 검토자는 팀의 변경 묶음을 확인합니다.</p>
        </div>
        <Link className="action-link" href={`/w/${workspaceId}/proposals/new`}>
          변경 묶음 작성
        </Link>
      </div>
      <section className="panel">
        {rows.map((r) => (
          <Link
            key={r.id}
            className="review-row"
            href={`/w/${workspaceId}/proposals/${r.id}`}
          >
            <div>
              <strong>{r.title}</strong>
              <p>
                {batchLabels[r.state]} ·{" "}
                {r.origin === "source"
                  ? "원문 AI 제안"
                  : r.origin === "answer"
                    ? "직원이 선택한 답변"
                    : "직접 작성"}
              </p>
            </div>
            <span>내용 확인 →</span>
          </Link>
        ))}
        {!rows.length && (
          <p className="empty-copy">
            저장한 변경 묶음이 없습니다. 자료에서 AI 초안을 만들거나 직접 작성해
            보세요.
          </p>
        )}
      </section>
    </>
  );
}
