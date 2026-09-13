import { headers } from "next/headers";
import Link from "next/link";
import { ListPagination } from "@/components/list-pagination";
import { RecordEditor } from "@/components/record-editor";
import { processingLabels, publicationLabels } from "@/lib/content";
import { contentPage, pageContext } from "@/server/page-access";
import { isWriter } from "@/server/services/content-access";
import { listSourcePage } from "@/server/services/sources";
import { workspaceData } from "@/server/services/workspace";
export default async function RecordsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const context = await pageContext(workspaceId);
  const requestHeaders = await headers();
  const [workspace, listing] = await contentPage(() =>
    Promise.all([
      workspaceData(requestHeaders, workspaceId),
      listSourcePage(requestHeaders, workspaceId, {
        ...query,
        category: "testimony",
      }),
    ]),
  );
  const records = listing.items;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">문서 밖의 경험도 팀의 지식으로</span>
          <h1>실무 기록</h1>
          <p>상황·판단 이유·결과를 기록하고 동료의 검토를 거쳐 공유합니다.</p>
        </div>
        {isWriter(context) && (
          <Link className="action-link" href="#new-record">
            + 실무 기록 작성
          </Link>
        )}
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>팀의 경험</h2>
          <span>전체 {listing.total}개</span>
        </div>
        {isWriter(context) && (
          <Link className="back-link" href={`/w/${workspaceId}/proposals`}>
            위키 변경 묶음 →
          </Link>
        )}
        {records.map((r) => (
          <Link
            className="review-row"
            key={r.id}
            href={`/w/${workspaceId}/sources/${r.id}`}
          >
            <div>
              <strong>{r.title}</strong>
              <p>
                작성자 진술 ·{" "}
                {r.version
                  ? publicationLabels[r.version.publication]
                  : "버전 없음"}
                {r.version
                  ? ` · ${processingLabels[r.version.processing]}`
                  : ""}
              </p>
            </div>
            <span>기록 읽기 →</span>
          </Link>
        ))}
        {!records.length && (
          <p className="empty-copy">
            아직 공개된 실무 기록이 없습니다. 작성 직원은 아래에서 경험을 남길
            수 있습니다.
          </p>
        )}
        <ListPagination
          result={listing}
          base={`/w/${workspaceId}/records`}
          values={query}
        />
      </section>
      {isWriter(context) && (
        <section className="panel">
          <h2 className="content-subtitle" id="new-record">
            새 실무 기록
          </h2>
          <RecordEditor
            workspaceId={workspaceId}
            domains={workspace.domains}
            projects={workspace.projects}
          />
        </section>
      )}
    </>
  );
}
