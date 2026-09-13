import "server-only";
import { reciprocalRanks } from "@/lib/chat";
import { referenceGraphPages, relatedGraphPages } from "@/lib/knowledge-graph";
import {
  referenceGraphQuota,
  referenceKeywordSql,
} from "@/lib/reference-search";
import { wikiContextLinkRanges } from "@/lib/wiki-links";
import { AccessError, requireWorkspace } from "@/server/access";
import { embeddingIdentity, embedTexts, modelStatus } from "@/server/ai/client";
import { knowledgeSql } from "@/server/ai/knowledge-index";
import { getPool } from "@/server/db";
import type { ChatScope, CitationSnapshot } from "@/server/db/schema";
import { validateChatWeb } from "./chat-web";
import { checkScope } from "./content-access";
import { scopedKnowledgeGraph } from "./knowledge-graph";
import { workspaceSearchGroups } from "./search-terms";
import { publishedWikiReferences } from "./wiki-references";

const scopeParams = (w: string, s: ChatScope) => [
  w,
  s.domainId,
  s.projectId,
  s.sourceId,
  s.wikiId,
];
export async function validateChatScope(w: string, s: ChatScope) {
  validateChatWeb(w, s);
  if (s.projectId && !s.domainId)
    throw new AccessError(400, "프로젝트를 선택하려면 도메인이 필요합니다.");
  if (s.sourceId && s.wikiId)
    throw new AccessError(400, "특정 자료와 위키 중 하나를 선택하세요.");
  if (s.domainId) await checkScope(w, s.domainId, s.projectId);
  if (s.sourceId || s.wikiId) {
    const r = await getPool().query(
      `WITH allowed AS (${knowledgeSql}) SELECT 1 FROM allowed WHERE kind=$6 AND id=$7 LIMIT 1`,
      [
        ...scopeParams(w, s),
        s.sourceId ? "source" : "wiki",
        s.sourceId ?? s.wikiId,
      ],
    );
    if (!r.rowCount)
      throw new AccessError(404, "질문할 공개 자료를 찾을 수 없습니다.");
  }
}
export async function chatScopeDocument(w: string, s: ChatScope) {
  if (!s.sourceId && !s.wikiId) return null;
  const result = await getPool().query<{ title: string }>(
    `WITH allowed AS (${knowledgeSql}) SELECT title FROM allowed WHERE kind=$6 AND id=$7 LIMIT 1`,
    [
      ...scopeParams(w, s),
      s.sourceId ? "source" : "wiki",
      s.sourceId ?? s.wikiId,
    ],
  );
  const document = result.rows[0];
  return document
    ? {
        title: document.title,
        href: `/w/${w}/${s.sourceId ? "sources" : "wiki"}/${s.sourceId ?? s.wikiId}`,
      }
    : null;
}
export async function hasChatKnowledge(w: string, s: ChatScope) {
  const result = await getPool().query(
    `WITH allowed AS (${knowledgeSql}) SELECT 1 FROM allowed WHERE ($6::boolean=false OR kind='source') LIMIT 1`,
    [...scopeParams(w, s), !!s.sourceOnly],
  );
  return !!result.rowCount;
}
export async function citationsAvailable(
  w: string,
  s: ChatScope,
  refs: CitationSnapshot[],
) {
  if (!refs.length) return true;
  if (s.sourceOnly && refs.some((r) => r.kind !== "source" || r.graph))
    return false;
  const dependencies = refs.flatMap((r) => [
    {
      kind: r.kind,
      targetId: r.chunkId ?? r.versionId,
      versionId: r.versionId,
    },
    ...(r.graph?.pages ?? []).map((p) => ({
      kind: "wiki",
      targetId: p.versionId,
      versionId: p.versionId,
    })),
    ...(r.linkedPages ?? []).map((p) => ({
      kind: "wiki",
      targetId: p.versionId,
      versionId: p.versionId,
    })),
    ...(r.graph?.sources ?? []).map((p) => ({
      kind: "source",
      targetId: p.chunkId,
      versionId: p.versionId,
    })),
  ]);
  const result = await getPool().query(
    `WITH allowed AS (${knowledgeSql}) SELECT kind,target_id,version_id FROM allowed WHERE kind||':'||target_id::text=ANY($6::text[])`,
    [...scopeParams(w, s), dependencies.map((r) => `${r.kind}:${r.targetId}`)],
  );
  const ids = new Set(
    result.rows.map((r) => `${r.kind}:${r.target_id}:${r.version_id}`),
  );
  return dependencies.every((r) =>
    ids.has(`${r.kind}:${r.targetId}:${r.versionId}`),
  );
}
export async function retrieveKnowledge(
  headers: Headers,
  w: string,
  s: ChatScope,
  query: string,
  signal?: AbortSignal,
  options: { kind?: "source" | "wiki"; graph?: boolean; limit?: number } = {},
) {
  await requireWorkspace(headers, w);
  return retrieveAuthorizedKnowledge(w, s, query, signal, options);
}
// Callers without an HTTP session must validate their workspace author first.
export async function retrieveAuthorizedKnowledge(
  w: string,
  s: ChatScope,
  query: string,
  signal?: AbortSignal,
  options: { kind?: "source" | "wiki"; graph?: boolean; limit?: number } = {},
) {
  await validateChatScope(w, s);
  const params = scopeParams(w, s);
  const allowedSql =
    s.sourceOnly || options.kind === "source"
      ? `SELECT * FROM (${knowledgeSql}) scoped WHERE kind='source'`
      : options.kind === "wiki"
        ? `SELECT * FROM (${knowledgeSql}) scoped WHERE kind='wiki'`
        : knowledgeSql;
  const groups = await workspaceSearchGroups(w, s.domainId, query, true);
  const scoreSql = referenceKeywordSql({
    title: "title||' '||aliases",
    filename: "filename",
    content: "text",
    groups: "$6",
    phrase: "$8::text",
  });
  const keyword = await getPool().query(
    `WITH allowed AS (${allowedSql}), ranked AS (SELECT *, ${scoreSql} AS score FROM allowed) SELECT * FROM ranked WHERE score>0 OR $7::boolean ORDER BY score DESC,title,target_id LIMIT 50`,
    [
      ...params,
      JSON.stringify(groups),
      !!(s.sourceId || s.wikiId) || groups.length === 0,
      query.trim().toLowerCase(),
    ],
  );
  let mode = "keyword";
  let notice = modelStatus().embeddingConfigured
    ? ""
    : "임베딩 모델이 없어 키워드 검색을 사용했습니다.";
  let vectorRows: typeof keyword.rows = [];
  if (modelStatus().embeddingConfigured) {
    try {
      const [vector] = await embedTexts([query.slice(0, 4000)], signal, {
        workspaceId: w,
        purpose: "query",
      });
      const indexed = await getPool().query(
        `WITH allowed AS (${allowedSql}) SELECT a.* FROM allowed a JOIN content_embedding e ON e.kind=a.kind AND e.target_id=a.target_id AND e.workspace_id=$1 WHERE e.model=$6 AND e.dimensions=$7 AND CASE WHEN vector_dims(e.vector)=$7 THEN e.vector <=> $8::vector ELSE 2 END < 0.65 ORDER BY CASE WHEN vector_dims(e.vector)=$7 THEN e.vector <=> $8::vector ELSE 2 END LIMIT 40`,
        [...params, embeddingIdentity(), vector.length, JSON.stringify(vector)],
      );
      vectorRows = indexed.rows;
      mode = vectorRows.length ? "hybrid" : "keyword";
      const coverage = await getPool().query(
        `WITH allowed AS (${allowedSql}) SELECT count(*)::int AS total,count(e.target_id)::int AS indexed FROM allowed a LEFT JOIN content_embedding e ON e.kind=a.kind AND e.target_id=a.target_id AND e.workspace_id=$1 AND e.model=$6 AND e.dimensions=$7`,
        [...params, embeddingIdentity(), vector.length],
      );
      notice =
        coverage.rows[0].indexed < coverage.rows[0].total
          ? "일부 자료의 의미 검색 색인이 아직 없어 키워드 검색을 함께 사용했습니다."
          : "";
    } catch (error) {
      if (signal?.aborted) throw error;
      notice = "의미 검색에 연결하지 못해 키워드 검색으로 답변합니다.";
    }
  }
  const key = (r: (typeof keyword.rows)[number]) => `${r.kind}:${r.target_id}`;
  const byId = new Map(
    [...keyword.rows, ...vectorRows].map((r) => [key(r), r]),
  );
  const ranked = reciprocalRanks([
    keyword.rows.map(key),
    vectorRows.map(key),
  ]).slice(0, options.limit ?? 8);
  const refs: CitationSnapshot[] = ranked.map((id, index) => {
    const r = byId.get(id);
    return {
      key: `E${index + 1}`,
      kind: r.kind,
      id: r.id,
      versionId: r.version_id,
      ...(r.chunk_id ? { chunkId: r.chunk_id } : {}),
      title: r.title,
      text: r.text,
      category: r.category,
      domainId: r.domain_id,
      ...(r.locator ? { locator: r.locator } : {}),
      href: `/w/${w}/${r.kind === "source" ? "sources" : "wiki"}/${r.id}?version=${r.version_id}${r.chunk_id ? `#chunk-${r.chunk_id}` : ""}`,
    };
  });
  if (
    !s.sourceOnly &&
    options.graph !== false &&
    options.kind !== "source" &&
    refs.length
  ) {
    const baseCount = refs.length;
    try {
      const graph = await scopedKnowledgeGraph(w, s);
      const seeds = [
        ...new Set(
          refs.flatMap((r) =>
            r.kind === "wiki"
              ? [r.id]
              : [...(graph.bySource.get(`${r.id}:${r.versionId}`) ?? [])],
          ),
        ),
      ];
      const limit = options.limit ?? 8;
      const quota = referenceGraphQuota(limit, vectorRows.length);
      const relations =
        options.graph === true
          ? relatedGraphPages(graph, seeds, quota)
          : referenceGraphPages(graph, seeds, quota);
      const graphRefs: CitationSnapshot[] = [];
      for (const { node, proof } of relations) {
        if (refs.some((ref) => ref.kind === "wiki" && ref.id === node.id))
          continue;
        graphRefs.push({
          key: "",
          kind: "wiki",
          id: node.id,
          versionId: node.versionId,
          title: node.title,
          text: node.body,
          category: "wiki",
          domainId: node.domainId,
          graph: proof,
          href: `/w/${w}/wiki/${node.id}?version=${node.versionId}`,
        });
      }
      if (graphRefs.length) {
        refs.splice(Math.max(1, limit - graphRefs.length));
        refs.push(...graphRefs);
        refs.forEach((ref, index) => {
          ref.key = `E${index + 1}`;
        });
      }
      if (refs.some((r) => r.graph)) mode += "+graph";
    } catch (error) {
      if (signal?.aborted) throw error;
      refs.splice(baseCount);
      notice = [
        notice,
        "관계 검색을 완료하지 못해 기본 검색 근거를 사용했습니다.",
      ]
        .filter(Boolean)
        .join(" ");
    }
  }
  await sanitizeKnowledgeLinks(w, s, refs);
  return { refs, mode, notice };
}

export async function sanitizeKnowledgeLinks(
  w: string,
  s: ChatScope,
  refs: CitationSnapshot[],
) {
  const params = scopeParams(w, s);
  const referenceIndex = refs.some(
    (r) => r.kind === "wiki" && r.text.includes("[["),
  )
    ? await publishedWikiReferences(w, s)
    : undefined;
  const linksByRef = refs
    .filter((r) => r.kind === "wiki")
    .map((ref) => ({
      ref,
      links: wikiContextLinkRanges(ref.text, w, referenceIndex),
    }));
  const linkIds = [
    ...new Set(
      linksByRef.flatMap(({ links }) => links.flatMap((l) => l.pageId ?? [])),
    ),
  ];
  const allowedLinks = linkIds.length
    ? await getPool().query<{ id: string; version_id: string }>(
        `WITH allowed AS (${knowledgeSql}) SELECT id,version_id FROM allowed WHERE kind='wiki' AND id=ANY($6::uuid[])`,
        [...params, linkIds],
      )
    : { rows: [] };
  const allowedById = new Map(
    allowedLinks.rows.map((r) => [r.id, r.version_id]),
  );
  for (const { ref, links } of linksByRef) {
    ref.linkedPages = [
      ...new Set(
        links.flatMap((l) =>
          l.pageId && allowedById.has(l.pageId) ? [l.pageId] : [],
        ),
      ),
    ].map((id) => ({ id, versionId: allowedById.get(id) as string }));
    for (const link of links
      .filter((l) => !l.pageId || !allowedById.has(l.pageId))
      .sort((a, b) => b.start - a.start)) {
      ref.text = `${ref.text.slice(0, link.start)}[질문 범위 밖 연결 생략]${ref.text.slice(link.end)}`;
      ref.omittedLinks = true;
    }
  }
}

export async function readAgentDocument(
  headers: Headers,
  w: string,
  scope: ChatScope,
  kind: "source" | "wiki",
  id: string,
  offset = 0,
  limit = 6,
) {
  await requireWorkspace(headers, w);
  await validateChatScope(w, scope);
  if (scope.sourceOnly && kind !== "source")
    throw new AccessError(403, "원문만 읽을 수 있습니다.");
  const result = await getPool().query(
    `WITH allowed AS (${knowledgeSql}) SELECT *,count(*) OVER() AS total FROM allowed WHERE kind=$6 AND id=$7::uuid ORDER BY ordinal,target_id OFFSET $8 LIMIT $9`,
    [...scopeParams(w, scope), kind, id, offset, limit],
  );
  const refs: CitationSnapshot[] = result.rows.map((r, i) => ({
    key: `E${i + 1}`,
    kind: r.kind,
    id: r.id,
    versionId: r.version_id,
    ...(r.chunk_id ? { chunkId: r.chunk_id } : {}),
    title: r.title,
    text: r.text,
    category: r.category,
    domainId: r.domain_id,
    ...(r.locator ? { locator: r.locator } : {}),
    href: `/w/${w}/${kind === "source" ? "sources" : "wiki"}/${id}?version=${r.version_id}${r.chunk_id ? `#chunk-${r.chunk_id}` : ""}`,
  }));
  await sanitizeKnowledgeLinks(w, scope, refs);
  return {
    refs,
    nextOffset:
      result.rows[0] && Number(result.rows[0].total) > offset + refs.length
        ? offset + refs.length
        : null,
  };
}
