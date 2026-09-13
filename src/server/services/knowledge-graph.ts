import "server-only";
import { createHash } from "node:crypto";
import {
  buildKnowledgeGraph,
  GRAPH_SETTINGS,
  type GraphPage,
  type KnowledgeGraph,
} from "@/lib/knowledge-graph";
import { knowledgeSql } from "@/server/ai/knowledge-index";
import { getPool } from "@/server/db";
import type { ChatScope } from "@/server/db/schema";

// Scope and the current publication set are read on EVERY request, including a cache hit.
// No TTL may keep a withdrawn bridge, source, or renamed page in the graph.
const cache = new Map<string, KnowledgeGraph>();
export async function scopedKnowledgeGraph(w: string, s: ChatScope) {
  const client = await getPool().connect();
  let pages: GraphPage[];
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '2000ms'");
    const result = await client.query<GraphPage>(
      `WITH allowed AS (${knowledgeSql}), pages AS (
        SELECT a.id,a.version_id AS "versionId",a.domain_id AS "domainId",a.project_id AS "projectId",a.title,a.text AS body,v.metadata
        FROM allowed a JOIN wiki_version v ON v.id=a.version_id WHERE a.kind='wiki' ORDER BY a.id LIMIT $6
      ) SELECT p.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'versionId',a.version_id,'chunkId',a.chunk_id) ORDER BY a.chunk_id)
        FROM wiki_evidence e JOIN allowed a ON a.kind='source' AND a.chunk_id=e.chunk_id WHERE e.version_id=p."versionId"),'[]'::jsonb) AS sources FROM pages p ORDER BY p.id`,
      [
        w,
        s.domainId,
        s.projectId,
        s.sourceId,
        s.wikiId,
        GRAPH_SETTINGS.maxNodes + 1,
      ],
    );
    pages = result.rows;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        w,
        s.domainId,
        s.projectId,
        s.sourceId,
        s.wikiId,
        GRAPH_SETTINGS,
        pages,
      ]),
    )
    .digest("hex");
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const graph = buildKnowledgeGraph(w, pages);
  cache.set(key, graph);
  while (cache.size > 8) cache.delete(cache.keys().next().value as string);
  return graph;
}
