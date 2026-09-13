import { headers } from "next/headers";
import Link from "next/link";
import { SearchResults } from "@/components/content-view";
import { contentPage } from "@/server/page-access";
import { projectDiscovery } from "@/server/services/discovery";
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ workspaceId: string; projectId: string }>;
}) {
  const { workspaceId, projectId } = await params;
  const { project, items } = await contentPage(async () =>
    projectDiscovery(await headers(), workspaceId, projectId),
  );
  const base = `/w/${workspaceId}`;
  const query = `domainId=${project.domainId}&projectId=${projectId}`;
  return (
    <>
      <Link className="back-link" href={`${base}/projects`}>
        ← 발주처·프로젝트
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{project.clientName}</span>
          <h1>{project.name}</h1>
          <p>{project.description}</p>
        </div>
      </div>
      <div className="version-links">
        <Link href={`${base}/chat?${query}`}>이 프로젝트에 질문하기</Link>
        <Link href={`${base}/sources?q=&${query}`}>자료 검색</Link>
        <Link href={`${base}/wiki?q=&${query}`}>위키 검색</Link>
        <Link href={`${base}?domain=${project.domainId}`}>
          도메인 입문 안내
        </Link>
      </div>
      <p className="search-caption">
        프로젝트 자료와 도메인 공통 자료 중 공개된 최신 버전을 표시합니다. 최대
        300개이며 더 자세한 조건은 자료 검색에서 찾을 수 있습니다.
      </p>
      <SearchResults items={items} />
    </>
  );
}
