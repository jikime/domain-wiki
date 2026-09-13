import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { retrievalTokens } from "@/lib/chat";
import { guideInput } from "@/lib/discovery";
import { relatedGraphPages } from "@/lib/knowledge-graph";
import { AccessError, requireWorkspace } from "@/server/access";
import { knowledgeSql } from "@/server/ai/knowledge-index";
import { getDb, getPool } from "@/server/db";
import { domain, project, wikiPage, wikiVersion } from "@/server/db/schema";
import { parseId, validEvidenceSql } from "./content-access";
import { scopedKnowledgeGraph } from "./knowledge-graph";
import type { SearchResult } from "./search";
import { wikiDetails } from "./wiki";

async function publishedWiki(w: string, d: string, ids?: string[]) {
  if (ids && !ids.length) return [];
  return getDb()
    .select({
      id: wikiPage.id,
      title: wikiVersion.title,
      projectId: wikiPage.projectId,
    })
    .from(wikiPage)
    .innerJoin(wikiVersion, eq(wikiVersion.id, wikiPage.publishedVersionId))
    .where(
      and(
        eq(wikiPage.workspaceId, w),
        eq(wikiPage.domainId, d),
        eq(wikiVersion.state, "approved"),
        validEvidenceSql(wikiVersion.id),
        ids ? inArray(wikiPage.id, ids) : undefined,
      ),
    )
    .orderBy(wikiVersion.title)
    .limit(300);
}
export async function domainDiscovery(h: Headers, w: string, id: string) {
  await requireWorkspace(h, w);
  const [item] = await getDb()
    .select()
    .from(domain)
    .where(and(eq(domain.id, parseId(id)), eq(domain.workspaceId, w)));
  if (!item) throw new AccessError(404, "도메인을 찾을 수 없습니다.");
  const ids = [
    ...new Set([
      ...item.guide.readingIds,
      ...item.guide.steps.flatMap((s) => (s.wikiId ? [s.wikiId] : [])),
    ]),
  ];
  const available = await publishedWiki(w, id, ids);
  const byId = new Map(available.map((p) => [p.id, p]));
  return {
    steps: item.guide.steps.map((s) => ({
      title: s.title,
      description: s.description,
      wiki: s.wikiId ? (byId.get(s.wikiId) ?? null) : null,
    })),
    reading: item.guide.readingIds.flatMap((id) =>
      byId.get(id) ? [byId.get(id)].filter((p) => p !== undefined) : [],
    ),
  };
}
export async function guideOptions(h: Headers, w: string, id: string) {
  await requireWorkspace(h, w, true);
  return publishedWiki(w, parseId(id));
}
export async function saveGuide(
  h: Headers,
  w: string,
  id: string,
  input: unknown,
) {
  await requireWorkspace(h, w, true);
  parseId(id);
  const guide = guideInput.parse(input);
  const ids = [
    ...new Set([
      ...guide.readingIds,
      ...guide.steps.flatMap((s) => (s.wikiId ? [s.wikiId] : [])),
    ]),
  ];
  const available = await publishedWiki(w, id, ids);
  if (available.length !== ids.length)
    throw new AccessError(
      409,
      "같은 도메인의 현재 게시 위키만 입문 자료에 연결할 수 있습니다.",
    );
  const [item] = await getDb()
    .update(domain)
    .set({ guide, updatedAt: new Date() })
    .where(and(eq(domain.id, id), eq(domain.workspaceId, w)))
    .returning({ id: domain.id });
  if (!item) throw new AccessError(404, "도메인을 찾을 수 없습니다.");
  return item;
}
async function catalog(
  w: string,
  d: string,
  p: string | null,
): Promise<SearchResult[]> {
  const r = await getPool().query(
    `WITH allowed AS (${knowledgeSql}) SELECT DISTINCT ON (kind,id) * FROM allowed ORDER BY kind,id,ordinal,target_id LIMIT 300`,
    [w, d, p, null, null],
  );
  return r.rows.map((r) => ({
    kind: r.kind,
    category: r.category,
    id: r.id,
    versionId: r.version_id,
    title: r.title,
    excerpt: r.text.slice(0, 230),
    domainId: r.domain_id,
    projectId: r.project_id,
    href: `/w/${w}/${r.kind === "wiki" ? "wiki" : "sources"}/${r.id}?version=${r.version_id}${r.chunk_id ? `#chunk-${r.chunk_id}` : ""}`,
    ...(r.locator ? { locator: r.locator, chunkId: r.chunk_id } : {}),
  }));
}
export async function projectDiscovery(h: Headers, w: string, id: string) {
  await requireWorkspace(h, w);
  const [item] = await getDb()
    .select()
    .from(project)
    .where(and(eq(project.id, parseId(id)), eq(project.workspaceId, w)));
  if (!item) throw new AccessError(404, "프로젝트를 찾을 수 없습니다.");
  return { project: item, items: await catalog(w, item.domainId, id) };
}
export async function wikiRelations(h: Headers, w: string, id: string) {
  const selected = await wikiDetails(h, w, id);
  const current = selected.page.publishedVersionId
    ? await wikiDetails(h, w, id, selected.page.publishedVersionId)
    : selected;
  // This view describes the published version only. Draft/restricted pages are never candidates.
  if (
    !current.evidenceValid ||
    current.version.id !== current.page.publishedVersionId
  )
    return { suggestions: [], questions: [] };
  const tokens = retrievalTokens(current.version.title);
  const evidenceIds = new Set(current.evidence.map((e) => e.sourceId));
  const candidates = (
    await catalog(w, current.page.domainId, current.page.projectId)
  ).filter(
    (c) =>
      !(c.kind === "wiki" && c.id === id) &&
      !(c.kind === "source" && evidenceIds.has(c.id)),
  );
  const scored = candidates
    .map((item) => ({
      item,
      score: tokens.reduce(
        (s, t) =>
          s + Number(`${item.title} ${item.excerpt}`.toLowerCase().includes(t)),
        0,
      ),
    }))
    .filter((r) => r.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title),
    );
  let related: SearchResult[] = [];
  try {
    const graph = await scopedKnowledgeGraph(w, {
      domainId: current.page.domainId,
      projectId: current.page.projectId,
      sourceId: null,
      wikiId: null,
    });
    related = relatedGraphPages(graph, [id], 6).map(({ node }) => ({
      kind: "wiki",
      category: "wiki",
      id: node.id,
      versionId: node.versionId,
      title: node.title,
      excerpt: node.body.slice(0, 230),
      domainId: node.domainId,
      projectId: node.projectId,
      href: `/w/${w}/wiki/${node.id}?version=${node.versionId}`,
    }));
  } catch {
    // The same current-publication catalog remains available if the bounded graph is unavailable.
  }
  return {
    suggestions: [
      ...related,
      ...scored
        .map((r) => r.item)
        .filter(
          (item) =>
            !related.some((r) => r.kind === item.kind && r.id === item.id),
        ),
    ].slice(0, 6),
    questions: [
      "이 내용은 어떤 사업·조건에 적용되나요?",
      "예외 조건이나 최신 개정 사항이 있나요?",
      "연결한 원문과 우리 프로젝트의 조건이 같나요?",
    ],
  };
}
