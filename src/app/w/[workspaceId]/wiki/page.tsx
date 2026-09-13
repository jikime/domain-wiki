import { BookOpen } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { SearchForm, SearchResults } from "@/components/content-view";
import { DomainFilterTabs } from "@/components/domain-filter-tabs";
import { ListPagination } from "@/components/list-pagination";
import { wikiLabels } from "@/lib/content";
import { contentPage, pageContext } from "@/server/page-access";
import { isWriter } from "@/server/services/content-access";
import { searchPage } from "@/server/services/search";
import { listWikiPage } from "@/server/services/wiki";
import { workspaceData } from "@/server/services/workspace";

type Query = {
  q?: string;
  domainId?: string;
  projectId?: string;
  kind?: string;
  page?: string;
  mode?: string;
  status?: string;
  mine?: string;
};
export default async function WikiListPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Query>;
}) {
  const { workspaceId } = await params;
  const context = await pageContext(workspaceId);
  const query = await searchParams;
  const manage = query.mode === "manage" && isWriter(context);
  const requestHeaders = await headers();
  const [{ domains, projects }, listing] = await contentPage(() =>
    Promise.all([
      workspaceData(requestHeaders, workspaceId),
      listWikiPage(requestHeaders, workspaceId, {
        ...query,
        status: manage ? query.status : undefined,
        mine: manage ? query.mine : undefined,
      }),
    ]),
  );
  const pages = listing.items;
  const resultPage =
    !manage && query.q !== undefined
      ? await contentPage(() =>
          searchPage(requestHeaders, workspaceId, {
            q: query.q,
            page: query.page,
            domainId: query.domainId || undefined,
            projectId: query.projectId || undefined,
            kind: query.kind ?? "all",
          }),
        )
      : undefined;
  const results = resultPage?.items;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">함께 검토한 업무 지식</span>
          <h1>위키</h1>
          <p>업무 개념과 절차를 원문 근거와 함께 정리합니다.</p>
        </div>
      </div>
      <DomainFilterTabs
        domains={domains}
        base={`/w/${workspaceId}/wiki`}
        values={query}
      />
      <Link
        className="back-link"
        href={`/w/${workspaceId}/wiki/project${query.domainId ? `?domainId=${query.domainId}` : ""}`}
      >
        프로젝트 목차·개요·기록 / ZIP 가져오기·내보내기 →
      </Link>
      <div className="list-toolbar">
        <p>
          {results ? "검색 결과" : "열람 가능한 위키"}{" "}
          <strong>{resultPage?.total ?? listing.total}</strong>개
        </p>
        {isWriter(context) && (
          <Link className="action-link" href={`/w/${workspaceId}/wiki/new`}>
            + 위키 작성
          </Link>
        )}
      </div>
      {isWriter(context) && (
        <Link className="back-link" href={`/w/${workspaceId}/proposals`}>
          여러 위키의 변경 묶음 확인 →
        </Link>
      )}
      <SearchForm
        key={JSON.stringify(query)}
        domains={domains}
        projects={projects}
        values={query}
        showKind
        management={isWriter(context) ? "wiki" : undefined}
      />
      {manage && (
        <p className="search-caption">
          열람 권한이 있는 위키의 대표 버전을 제목·본문·상태로 찾습니다. 본인
          초안·검토 대기·반려 문서도 확인할 수 있습니다.
        </p>
      )}
      {results ? (
        <>
          <p className="search-caption">
            게시 위키와 공개 원문을 함께 검색합니다.
          </p>
          <SearchResults items={results} />
        </>
      ) : (
        <div className="content-list">
          {pages.map((item) => (
            <Link
              className="content-list-row"
              href={`/w/${workspaceId}/wiki/${item.pageId}?version=${item.version.id}`}
              key={item.pageId}
            >
              <span className="document-icon">
                <BookOpen size={23} />
              </span>
              <div>
                <div className="row-tags">
                  <span className="state-label">
                    {wikiLabels[item.version.state]}
                  </span>
                  {!item.evidenceValid && (
                    <span className="state-label state-warning">
                      근거 재확인 필요
                    </span>
                  )}
                </div>
                <h2>{item.version.title}</h2>
                <p>
                  버전 {item.version.number} · {item.version.body.slice(0, 100)}
                </p>
              </div>
              <span className="row-arrow">→</span>
            </Link>
          ))}
          {!pages.length && (
            <div className="panel empty-copy">
              아직 볼 수 있는 위키가 없습니다. 작성한 초안을 검토 직원이
              승인하면 동료에게 게시됩니다.
            </div>
          )}
        </div>
      )}
      <ListPagination
        result={resultPage ?? listing}
        base={`/w/${workspaceId}/wiki`}
        values={query}
      />
    </>
  );
}
