import "server-only";
import { AccessError, requireWorkspace } from "@/server/access";
import { getPool } from "@/server/db";
import { mayManage } from "./content-access";
import { sourceRecord } from "./sources";
export async function sourceImpact(h: Headers, w: string, id: string) {
  const c = await requireWorkspace(h, w);
  const item = await sourceRecord(c, id);
  if (!mayManage(c, item.createdBy))
    throw new AccessError(403, "자료 작성자 또는 검토 직원 권한이 필요합니다.");
  const affected = `WITH RECURSIVE affected(id) AS (SELECT id FROM source_version WHERE source_id=$2 AND workspace_id=$1 UNION SELECT v.id FROM source_version v CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(v.testimony->'chunkIds','[]'::jsonb)) r(chunk) JOIN source_chunk ch ON ch.id=r.chunk::uuid JOIN affected a ON a.id=ch.version_id WHERE v.workspace_id=$1)`;
  const params = [w, id, c.user.id, c.role === "reviewer"];
  const [wikis, records, batches, chats, versions, reports] = await Promise.all(
    [
      getPool().query(
        `${affected} SELECT DISTINCT p.id,v.id AS version_id,v.title,v.number,v.state, p.published_version_id=v.id AS published FROM wiki_evidence e JOIN source_chunk ch ON ch.id=e.chunk_id JOIN affected a ON a.id=ch.version_id JOIN wiki_version v ON v.id=e.version_id JOIN wiki_page p ON p.id=v.page_id WHERE p.workspace_id=$1 AND ($4::boolean OR v.author_id=$3 OR p.published_version_id=v.id) ORDER BY v.title,v.number LIMIT 100`,
        params,
      ),
      getPool().query(
        `${affected} SELECT s.id,s.title,v.id AS version_id,v.number,v.publication FROM affected a JOIN source_version v ON v.id=a.id JOIN source s ON s.id=v.source_id WHERE s.id<>$2 AND ($4::boolean OR s.created_by=$3 OR s.published_version_id=v.id) ORDER BY s.title,v.number LIMIT 100`,
        params,
      ),
      getPool().query(
        `${affected} SELECT DISTINCT b.id,b.title,b.state FROM change_batch b CROSS JOIN LATERAL jsonb_array_elements(b.items) i CROSS JOIN LATERAL jsonb_array_elements_text(i->'chunkIds') r(chunk) JOIN source_chunk ch ON ch.id=r.chunk::uuid JOIN affected a ON a.id=ch.version_id WHERE b.workspace_id=$1 AND ($4::boolean OR b.author_id=$3) LIMIT 100`,
        params,
      ),
      getPool().query(
        `${affected}, affected_wiki AS (SELECT DISTINCT e.version_id FROM wiki_evidence e JOIN source_chunk ch ON ch.id=e.chunk_id JOIN affected a ON a.id=ch.version_id) SELECT DISTINCT c.id,c.title FROM conversation c JOIN chat_run r ON r.conversation_id=c.id JOIN chat_citation ref ON ref.run_id=r.id WHERE c.workspace_id=$1 AND c.owner_id=$3 AND ((ref.snapshot->>'versionId')::uuid IN (SELECT id FROM affected) OR (ref.snapshot->>'versionId')::uuid IN(SELECT version_id FROM affected_wiki)) LIMIT 100`,
        params.slice(0, 3),
      ),
      getPool().query(
        `SELECT v.id,v.number,v.publication,v.created_at,(SELECT min(created_at) FROM review_decision WHERE source_version_id=v.id AND action='approve') AS published_at,(SELECT max(created_at) FROM review_decision WHERE source_version_id=v.id AND action='withdraw') AS withdrawn_at FROM source_version v WHERE source_id=$1 ORDER BY number DESC`,
        [id],
      ),
      getPool().query(
        `${affected} SELECT DISTINCT r.id,v.id AS version_id,v.title,v.number,v.state FROM rfp_evidence e JOIN source_chunk ch ON ch.id=e.chunk_id JOIN affected a ON a.id=ch.version_id JOIN rfp_version v ON v.id=e.version_id JOIN rfp_report r ON r.id=v.report_id WHERE r.workspace_id=$1 AND ($4::boolean OR r.author_id=$3 OR r.published_version_id=v.id) ORDER BY v.title,v.number LIMIT 100`,
        params,
      ),
    ],
  );
  return {
    source: item,
    wikis: wikis.rows,
    records: records.rows,
    batches: batches.rows,
    chats: chats.rows,
    versions: versions.rows,
    reports: reports.rows,
  };
}
