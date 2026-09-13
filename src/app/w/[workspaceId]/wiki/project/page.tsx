import { headers } from "next/headers";
import Link from "next/link";
import { DomainFilterTabs } from "@/components/domain-filter-tabs";
import { Markdown } from "@/components/markdown";
import { ProjectArchiveControls } from "@/components/project-archive-controls";
import { contentPage, pageContext } from "@/server/page-access";
import { isWriter } from "@/server/services/content-access";
import { projectCatalog } from "@/server/services/project-catalog";
import { workspaceData } from "@/server/services/workspace";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ domainId?: string; document?: string }>;
}) {
  const { workspaceId } = await params,
    query = await searchParams;
  const context = await pageContext(workspaceId),
    h = await headers();
  const { domains } = await contentPage(() => workspaceData(h, workspaceId));
  const domainId = query.domainId || domains[0]?.id;
  const catalog = domainId
    ? await contentPage(() => projectCatalog(h, workspaceId, domainId))
    : null;
  const document = ["index", "overview", "log"].includes(query.document || "")
    ? (query.document as "index" | "overview" | "log")
    : "index";
  const labels = { index: "목차", overview: "개요", log: "최근 기록" };
  return (
    <>
      <Link className="back-link" href={`/w/${workspaceId}/wiki`}>
        ← 위키
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">프로젝트 파일과 기록</span>
          <h1>프로젝트 문서</h1>
          <p>
            도메인의 목차·개요·기록을 확인하고, 원본 프로젝트 ZIP을
            주고받습니다.
          </p>
        </div>
      </div>
      <DomainFilterTabs
        domains={domains}
        base={`/w/${workspaceId}/wiki/project`}
        values={{ domainId }}
      />
      {catalog && (
        <section className="panel form-stack">
          <div className="list-toolbar">
            <h2>
              {catalog.domain.name} · {labels[document]}
            </h2>
            <p>
              게시 위키 {catalog.count}개 · 공개 원문 {catalog.sourceCount}개
            </p>
          </div>
          <nav
            className="archive-document-tabs"
            aria-label="프로젝트 문서 종류"
          >
            {Object.entries(labels).map(([key, label]) => (
              <Link
                key={key}
                aria-current={document === key ? "page" : undefined}
                href={`/w/${workspaceId}/wiki/project?domainId=${domainId}&document=${key}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <p className="muted">
            목차와 기록은 현재 열람 가능한 게시본으로 갱신합니다. 개요는 도메인
            설정에서 직접 작성합니다.
          </p>
          {document === "overview" &&
          !catalog.domain.overviewMarkdown.trim() ? (
            <p className="empty-copy">아직 작성한 프로젝트 개요가 없습니다.</p>
          ) : (
            <Markdown linkDestinations={catalog.destinations}>
              {catalog[document]}
            </Markdown>
          )}
        </section>
      )}
      <ProjectArchiveControls
        workspaceId={workspaceId}
        domains={domains}
        initialDomainId={domainId}
        canWrite={isWriter(context)}
        isAdmin={context.isAdmin}
      />
    </>
  );
}
