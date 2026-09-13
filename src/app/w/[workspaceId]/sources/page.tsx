import { FolderOpen, Plus } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { ProcessingRefresh, UploadForm } from "@/components/content-controls";
import { SearchForm, SearchResults } from "@/components/content-view";
import { DomainFilterTabs } from "@/components/domain-filter-tabs";
import { ListPagination } from "@/components/list-pagination";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  processingLabels,
  publicationLabels,
  sourceCategories,
} from "@/lib/content";
import { ingestLabels } from "@/lib/ingest";
import { contentPage, pageContext } from "@/server/page-access";
import { isWriter } from "@/server/services/content-access";
import { searchPage } from "@/server/services/search";
import { listSourcePage } from "@/server/services/sources";
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
export default async function SourcesPage({
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
      listSourcePage(requestHeaders, workspaceId, {
        ...query,
        status: manage ? query.status : undefined,
        mine: manage ? query.mine : undefined,
      }),
    ]),
  );
  const sources = listing.items;
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
          <span className="eyebrow">지식의 출발점</span>
          <h1>자료실</h1>
          <p>원본을 보관하고, 추출한 내용과 공개 범위를 확인합니다.</p>
        </div>
      </div>
      <DomainFilterTabs
        domains={domains}
        base={`/w/${workspaceId}/sources`}
        values={query}
      />
      <div className="list-toolbar" id="register-source">
        <p>
          {results ? "검색 결과" : "등록 자료"}{" "}
          <strong>{resultPage?.total ?? listing.total}</strong>개
        </p>
        {isWriter(context) ? (
          <div className="form-actions">
            <Button variant="outline" asChild>
              <Link href={`/w/${workspaceId}/sources/imports`}>
                파일·폴더 가져오기
              </Link>
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button>
                  <Plus size={17} />새 자료 등록
                </Button>
              </DialogTrigger>
              <DialogContent className="upload-dialog">
                <DialogHeader>
                  <DialogTitle>새 자료 등록</DialogTitle>
                  <DialogDescription>
                    원본 파일과 공개 범위를 지정해 주세요. 처리 후 검토를 거쳐
                    동료에게 공개됩니다.
                  </DialogDescription>
                </DialogHeader>
                <UploadForm
                  workspaceId={workspaceId}
                  domains={domains}
                  projects={projects}
                  initialScope={
                    query.domainId &&
                    domains.some((d) => d.id === query.domainId)
                      ? {
                          domainId: query.domainId,
                          projectId: projects.some(
                            (p) =>
                              p.id === query.projectId &&
                              p.domainId === query.domainId,
                          )
                            ? (query.projectId ?? null)
                            : null,
                        }
                      : undefined
                  }
                />
              </DialogContent>
            </Dialog>
          </div>
        ) : (
          <p className="field-help">
            자료 등록은 작성 권한이 필요합니다.
            {context.isAdmin && (
              <>
                {" "}
                <Link href={`/w/${workspaceId}/admin#members`}>
                  직원 권한 확인 →
                </Link>
              </>
            )}
          </p>
        )}
      </div>
      <SearchForm
        key={JSON.stringify(query)}
        domains={domains}
        projects={projects}
        values={query}
        showKind
        management={isWriter(context) ? "source" : undefined}
      />
      {manage && (
        <p className="search-caption">
          열람 권한이 있는 자료를 제목·상태로 찾습니다. 작성 직원은 본인 자료의
          검토 대기·반려 상태도 확인할 수 있습니다.
        </p>
      )}
      {results ? (
        <>
          <p className="search-caption">
            게시 위키와 공개 원문을 함께 검색합니다. 프로젝트 검색에는 도메인
            공통 자료도 포함합니다.
          </p>
          <SearchResults items={results} />
        </>
      ) : (
        <>
          <ProcessingRefresh
            active={sources.some(
              (item) =>
                (item.version &&
                  ["queued", "processing"].includes(item.version.processing)) ||
                ["waiting", "analysis", "generation"].includes(
                  item.ingestState ?? "",
                ),
            )}
          />
          <div className="content-list">
            {sources.map((item) => (
              <Link
                className="content-list-row"
                key={item.id}
                href={`/w/${workspaceId}/sources/${item.id}`}
              >
                <span className="document-icon">
                  <FolderOpen size={22} />
                </span>
                <div>
                  <div className="row-tags">
                    <span className="small-tag">
                      {
                        sourceCategories[
                          item.category as keyof typeof sourceCategories
                        ]
                      }
                    </span>
                    {item.version && (
                      <>
                        <span
                          className={`state-label ${item.version.publication === "published" ? "state-good" : ""}`}
                        >
                          {publicationLabels[item.version.publication]}
                        </span>
                        <span className="state-label">
                          {processingLabels[item.version.processing]}
                        </span>
                      </>
                    )}
                  </div>
                  <h2>{item.title}</h2>
                  {item.ingestState && (
                    <p className="field-help">
                      {ingestLabels[item.ingestState]}
                      {item.ingestReusedAnalysis ? " · 전체 분석 재사용" : ""}
                    </p>
                  )}
                  <p>
                    {item.version?.filename} · 버전 {item.version?.number}
                  </p>
                </div>
                <span className="row-arrow">→</span>
              </Link>
            ))}
            {!sources.length && (
              <div className="panel empty-copy">
                아직 볼 수 있는 자료가 없습니다. 작성 직원이 등록한 원본을 검토
                직원이 공개하면 이곳에서 확인할 수 있습니다.
              </div>
            )}
          </div>
        </>
      )}
      <ListPagination
        result={resultPage ?? listing}
        base={`/w/${workspaceId}/sources`}
        values={query}
      />
    </>
  );
}
