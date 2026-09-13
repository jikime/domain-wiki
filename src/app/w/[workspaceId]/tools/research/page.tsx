import { headers } from "next/headers";
import Link from "next/link";
import { z } from "zod";
import { ResearchWorkspace } from "@/components/research-workspace";
import { researchOriginInput } from "@/lib/research";
import { getPool } from "@/server/db";
import { contentPage, pageContext } from "@/server/page-access";
import { researchContext } from "@/server/research/context";
import {
  requireReviewer,
  requireWriter,
} from "@/server/services/content-access";
import { researchOverview } from "@/server/services/research";
import { workspaceData } from "@/server/services/workspace";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{
    domainId?: string;
    projectId?: string;
    topic?: string;
    description?: string;
    gapType?: string;
    pageIds?: string;
    reviewId?: string;
    id?: string;
  }>;
}) {
  const { workspaceId: w } = await params,
    query = await searchParams,
    h = await headers();
  const context = await pageContext(w);
  const data = await contentPage(async () => {
    requireWriter(context);
    const workspace = await workspaceData(h, w);
    const domainId = query.domainId ?? workspace.domains[0]?.id;
    if (!domainId) return { ...workspace, overview: null };
    const overview = await researchOverview(h, w, {
      domainId,
      projectId: query.projectId ?? null,
    });
    return { ...workspace, overview };
  });
  const initial = await contentPage(async () => {
    const origin = researchOriginInput.parse({
      kind: query.reviewId
        ? "review"
        : query.pageIds || query.gapType
          ? "graph"
          : "manual",
      reviewId: query.reviewId,
      pageIds: query.pageIds?.split(",").filter(Boolean) ?? [],
      description: query.description ?? "",
      gapType: query.gapType ?? "suggestion",
    });
    let topic = z
      .string()
      .max(150)
      .parse(query.topic ?? "");
    if (origin.kind === "review" && data.overview) {
      requireReviewer(context);
      const basis = await researchContext(getPool(), w, {
        ...data.overview.scope,
        origin,
      });
      topic = basis.gap.title.slice(0, 150);
      origin.description = basis.gap.description.slice(0, 4000);
      origin.gapType = basis.gap.type;
    }
    return { topic, origin, id: query.id && z.uuid().parse(query.id) };
  });
  return (
    <>
      <Link className="back-link" href={`/w/${w}/tools`}>
        ← 업무 도구
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">출처를 모아 지식으로</span>
          <h1>심층 조사</h1>
          <p>
            주제와 검색어를 보완하고, 수집한 출처를 인용하는 위키 초안을
            만듭니다.
          </p>
        </div>
      </div>
      {data.overview ? (
        <ResearchWorkspace
          key={`${data.overview.scope.domainId}:${data.overview.scope.projectId}:${initial.id ?? ""}:${initial.origin.reviewId ?? ""}:${initial.topic}`}
          workspaceId={w}
          domains={data.domains}
          projects={data.projects}
          data={data.overview}
          initial={initial}
        />
      ) : (
        <p className="empty-copy">조사할 도메인을 먼저 등록해 주세요.</p>
      )}
    </>
  );
}
