import { headers } from "next/headers";
import { GraphWorkspace } from "@/components/graph-workspace";
import { pageContext } from "@/server/page-access";
import { isWriter } from "@/server/services/content-access";
import { workspaceData } from "@/server/services/workspace";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{
    domainId?: string;
    projectId?: string;
    focusId?: string;
  }>;
}) {
  const { workspaceId: w } = await params,
    query = await searchParams;
  const context = await pageContext(w),
    { domains, projects } = await workspaceData(await headers(), w);
  return (
    <>
      {domains.length ? (
        <GraphWorkspace
          workspaceId={w}
          domains={domains}
          projects={projects}
          canWrite={isWriter(context)}
          initial={query}
        />
      ) : (
        <div className="page-heading">
          <h1>지식 그래프</h1>
          <p>도메인을 먼저 등록해 주세요.</p>
        </div>
      )}
    </>
  );
}
