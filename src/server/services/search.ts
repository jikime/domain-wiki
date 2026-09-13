import "server-only";
import { z } from "zod";
import { referenceGraphPages } from "@/lib/knowledge-graph";
import { pageInput, pageResult } from "@/lib/pagination";
import {
  referenceGraphQuota,
  referenceKeywordSql,
} from "@/lib/reference-search";
import { AccessError, requireWorkspace } from "@/server/access";
import { embeddingIdentity, embedTexts, modelStatus } from "@/server/ai/client";
import { knowledgeSql } from "@/server/ai/knowledge-index";
import { getPool } from "@/server/db";
import type { ChatScope, SourceLocator } from "@/server/db/schema";
import { checkScope } from "./content-access";
import { scopedKnowledgeGraph } from "./knowledge-graph";
import { workspaceSearchGroups } from "./search-terms";

export type SearchResult = {
  kind: "source" | "wiki";
  category?: string;
  id: string;
  versionId: string;
  title: string;
  excerpt: string;
  domainId: string;
  projectId: string | null;
  href: string;
  locator?: SourceLocator;
  chunkId?: string;
};
const searchInput = pageInput.extend({
  kind: z.enum(["source", "wiki", "all"]).default("all"),
});
function excerpt(text: string, words: string[]) {
  const matches = words
    .map((word) => text.toLowerCase().indexOf(word.toLowerCase()))
    .filter((i) => i >= 0);
  const start = Math.max(0, (matches.length ? Math.min(...matches) : 0) - 60);
  return `${start ? "…" : ""}${text.slice(start, start + 230)}`;
}
export async function searchContent(
  headers: Headers,
  workspaceId: string,
  input: unknown,
): Promise<SearchResult[]> {
  return (
    await searchPage(headers, workspaceId, {
      ...searchInput.parse(input),
      pageSize: 50,
    })
  ).items;
}
type SearchRow = {
  kind: "source" | "wiki";
  id: string;
  target_id: string;
  version_id: string;
  chunk_id: string | null;
  title: string;
  text: string;
  category: string;
  domain_id: string;
  project_id: string | null;
  locator: SourceLocator;
  position: number;
};
export async function searchPage(
  headers: Headers,
  workspaceId: string,
  input: unknown,
) {
  await requireWorkspace(headers, workspaceId);
  const filter = searchInput.parse(input);
  if (filter.domainId)
    await checkScope(workspaceId, filter.domainId, filter.projectId ?? null);
  else if (filter.projectId)
    throw new AccessError(400, "프로젝트 검색에는 도메인이 필요합니다.");
  const scope: ChatScope = {
    domainId: filter.domainId ?? null,
    projectId: filter.projectId ?? null,
    sourceId: null,
    wikiId: null,
  };
  const groups = await workspaceSearchGroups(
    workspaceId,
    filter.domainId,
    filter.q,
    true,
  );
  let vector: number[] | null = null;
  if (filter.q && modelStatus().embeddingConfigured) {
    try {
      [vector] = await embedTexts([filter.q], undefined, {
        workspaceId,
        purpose: "query",
      });
    } catch {
      /* An unavailable vector service preserves the full keyword search. */
    }
  }
  const params: unknown[] = [
    workspaceId,
    scope.domainId,
    scope.projectId,
    null,
    null,
    JSON.stringify(groups),
    filter.q.toLowerCase(),
    filter.kind,
  ];
  const score = referenceKeywordSql({
    title: "a.title||' '||a.aliases",
    filename: "a.filename",
    content: "a.text",
    groups: "$6",
    phrase: "$7::text",
  });
  let vectorCte =
    "SELECT NULL::uuid AS target_id,0::bigint AS vector_rank WHERE false";
  if (vector) {
    params.push(embeddingIdentity(), vector.length, JSON.stringify(vector));
    vectorCte = `SELECT target_id,row_number() OVER(ORDER BY distance,target_id) AS vector_rank FROM (
      SELECT a.target_id,CASE WHEN vector_dims(e.vector)=$10 THEN e.vector <=> $11::vector ELSE 2 END AS distance
      FROM allowed a JOIN content_embedding e ON e.kind=a.kind AND e.target_id=a.target_id AND e.workspace_id=$1
      WHERE e.model=$9 AND e.dimensions=$10
    ) distances WHERE distance<0.65`;
  }
  const baseCtes = `WITH allowed AS (SELECT * FROM (${knowledgeSql}) a WHERE $8='all' OR kind=$8),
    weighted AS (SELECT a.*,${score} AS keyword_score FROM allowed a),
    lexical AS (SELECT target_id,row_number() OVER(ORDER BY keyword_score DESC,title,target_id) AS keyword_rank FROM weighted WHERE keyword_score>0),
    semantic AS (${vectorCte}),
    matched AS (SELECT w.*,CASE WHEN EXISTS(SELECT 1 FROM semantic) THEN COALESCE(1.0/(60+l.keyword_rank),0)+COALESCE(1.0/(60+s.vector_rank),0) ELSE w.keyword_score END AS score
      FROM weighted w LEFT JOIN lexical l USING(target_id) LEFT JOIN semantic s USING(target_id)
      WHERE $7='' OR l.target_id IS NOT NULL OR s.target_id IS NOT NULL),
    ranked AS (SELECT *,row_number() OVER(ORDER BY score DESC,title,target_id) AS position FROM matched)`;
  const seeds = await getPool().query<{
    items: SearchRow[];
    vector_hits: number;
  }>(
    `${baseCtes}
    SELECT COALESCE((SELECT jsonb_agg(r ORDER BY position) FROM (SELECT * FROM ranked ORDER BY position LIMIT $${params.length + 1}) r),'[]'::jsonb) AS items,
      (SELECT count(*)::int FROM semantic) AS vector_hits`,
    [...params, Math.min(filter.pageSize, 20)],
  );
  let graphIds: string[] = [];
  if (filter.q && filter.kind !== "source" && seeds.rows[0].items.length) {
    try {
      const graph = await scopedKnowledgeGraph(workspaceId, scope);
      const seedIds = [
        ...new Set(
          seeds.rows[0].items.flatMap((r) =>
            r.kind === "wiki"
              ? [r.id]
              : [...(graph.bySource.get(`${r.id}:${r.version_id}`) ?? [])],
          ),
        ),
      ];
      graphIds = referenceGraphPages(
        graph,
        seedIds,
        referenceGraphQuota(filter.pageSize, seeds.rows[0].vector_hits),
      ).map((r) => r.node.versionId);
    } catch {
      /* A graph timeout does not hide the existing ranked results. */
    }
  }
  const graphParam = params.length + 1;
  params.push(graphIds, filter.pageSize, (filter.page - 1) * filter.pageSize);
  // Graph candidates can already exist lower in the lexical list. Remove them
  // from that list before reserving slots, exactly as the original blend does.
  // Remaining rows stay available to pagination instead of truncating at 50.
  const result = await getPool().query<{ items: SearchRow[]; total: number }>(
    `${baseCtes},
    graph_rows AS (SELECT a.*,array_position($${graphParam}::uuid[],a.target_id)::bigint AS graph_rank FROM allowed a WHERE a.kind='wiki' AND a.target_id=ANY($${graphParam}::uuid[])),
    base_rows AS (SELECT r.*,row_number() OVER(ORDER BY position) AS base_rank FROM ranked r WHERE NOT (r.target_id=ANY($${graphParam}::uuid[]))),
    ordered AS (
      SELECT kind,id,target_id,version_id,chunk_id,title,text,category,domain_id,project_id,locator,
        CASE WHEN base_rank <= $${graphParam + 1}-(SELECT count(*) FROM graph_rows) THEN base_rank ELSE base_rank+(SELECT count(*) FROM graph_rows) END AS position FROM base_rows
      UNION ALL
      SELECT kind,id,target_id,version_id,chunk_id,title,text,category,domain_id,project_id,locator,
        LEAST((SELECT count(*) FROM base_rows),$${graphParam + 1}-(SELECT count(*) FROM graph_rows))+graph_rank FROM graph_rows
    ), selected AS (SELECT * FROM ordered ORDER BY position,target_id LIMIT $${graphParam + 1} OFFSET $${graphParam + 2})
    SELECT (SELECT count(*)::int FROM ordered) AS total,COALESCE((SELECT jsonb_agg(s ORDER BY position,target_id) FROM selected s),'[]'::jsonb) AS items`,
    params,
  );
  const summary = result.rows[0];
  const items: SearchResult[] = summary.items.map((row) => ({
    kind: row.kind,
    id: row.id,
    versionId: row.version_id,
    title: row.title,
    domainId: row.domain_id,
    projectId: row.project_id,
    ...(row.kind === "source"
      ? {
          category: row.category,
          locator: row.locator,
          chunkId: row.chunk_id as string,
        }
      : {}),
    excerpt: excerpt(row.text, groups.flat()),
    href: `/w/${workspaceId}/${row.kind === "source" ? "sources" : "wiki"}/${row.id}?version=${row.version_id}${row.chunk_id ? `#chunk-${row.chunk_id}` : ""}`,
  }));
  return pageResult(items, summary.total, {
    page: filter.page,
    pageSize: filter.pageSize,
  });
}
