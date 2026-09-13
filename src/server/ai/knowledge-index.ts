import "server-only";
import { getPool } from "@/server/db";
import { embeddingIdentity, embedTexts, modelStatus } from "./client";
export const knowledgeSql = `
SELECT 'source' AS kind,c.id AS target_id,s.id,v.id AS version_id,c.id AS chunk_id,s.title,c.text,s.category,c.locator,s.domain_id,s.project_id,c.ordinal,''::text AS aliases,v.filename
FROM source_chunk c JOIN source_version v ON v.id=c.version_id JOIN source s ON s.id=v.source_id
WHERE s.workspace_id=$1 AND s.published_version_id=v.id AND v.publication='published' AND v.processing='completed' AND source_is_current(v.id)
AND ($2::uuid IS NULL OR s.domain_id=$2) AND ($3::uuid IS NULL OR s.project_id=$3 OR s.project_id IS NULL)
AND ($4::uuid IS NULL OR s.id=$4)
AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM wiki_evidence e JOIN wiki_page p ON p.published_version_id=e.version_id JOIN wiki_version w ON w.id=e.version_id WHERE p.id=$5 AND w.state='approved' AND e.chunk_id=c.id AND NOT EXISTS(SELECT 1 FROM wiki_evidence ve JOIN source_chunk vc ON vc.id=ve.chunk_id JOIN source_version vv ON vv.id=vc.version_id JOIN source vs ON vs.id=vv.source_id WHERE ve.version_id=w.id AND (vs.published_version_id IS DISTINCT FROM vv.id OR vv.publication<>'published' OR vv.processing<>'completed' OR NOT source_is_current(vv.id)))))
UNION ALL
SELECT 'wiki',v.id,p.id,v.id,NULL,v.title,v.body,'wiki',NULL::jsonb,p.domain_id,p.project_id,0,COALESCE(v.metadata->'aliases','[]'::jsonb)::text,COALESCE(NULLIF(regexp_replace(v.metadata->>'path','^.*/',''),''),v.title||'.md')
FROM wiki_version v JOIN wiki_page p ON p.id=v.page_id
WHERE p.workspace_id=$1 AND p.published_version_id=v.id AND v.state='approved'
AND ($2::uuid IS NULL OR p.domain_id=$2) AND ($3::uuid IS NULL OR p.project_id=$3 OR p.project_id IS NULL)
AND ($5::uuid IS NULL OR p.id=$5)
AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM wiki_evidence e JOIN source_chunk c ON c.id=e.chunk_id JOIN source_version s ON s.id=c.version_id WHERE e.version_id=v.id AND s.source_id=$4))
AND NOT EXISTS(SELECT 1 FROM wiki_evidence e JOIN source_chunk c ON c.id=e.chunk_id JOIN source_version s ON s.id=c.version_id JOIN source o ON o.id=s.source_id WHERE e.version_id=v.id AND (o.published_version_id IS DISTINCT FROM s.id OR s.publication<>'published' OR s.processing<>'completed' OR NOT source_is_current(s.id)))`;
// Worker sweep indexes immutable published content. Reads always rejoin current publication state.
export async function indexPublishedContent() {
  await getPool().query(`DELETE FROM content_embedding e WHERE
    (e.kind='source' AND NOT EXISTS(SELECT 1 FROM source_chunk c WHERE c.id=e.target_id AND source_is_current(c.version_id))) OR
    (e.kind='wiki' AND NOT EXISTS(SELECT 1 FROM wiki_version v JOIN wiki_page p ON p.published_version_id=v.id WHERE v.id=e.target_id AND v.state='approved' AND NOT EXISTS(SELECT 1 FROM wiki_evidence x JOIN source_chunk c ON c.id=x.chunk_id WHERE x.version_id=v.id AND NOT source_is_current(c.version_id))))`);
  if (!modelStatus().embeddingConfigured) return;
  const model = embeddingIdentity();
  const spaces = await getPool().query(
    "SELECT id FROM workspace ORDER BY created_at",
  );
  for (const space of spaces.rows) {
    const params = [space.id, null, null, null, null];
    const missing = await getPool().query(
      `WITH allowed AS (${knowledgeSql}) SELECT a.* FROM allowed a LEFT JOIN content_embedding e ON e.kind=a.kind AND e.target_id=a.target_id AND e.model=$6 WHERE e.target_id IS NULL ORDER BY a.target_id LIMIT 16`,
      [...params, model],
    );
    if (!missing.rowCount) continue;
    const vectors = await embedTexts(
      missing.rows.map((r) => `${r.title}\n${r.text}`),
      undefined,
      { workspaceId: space.id, purpose: "index" },
    );
    for (const [i, row] of missing.rows.entries())
      await getPool().query(
        "INSERT INTO content_embedding(workspace_id,kind,target_id,model,dimensions,vector) VALUES($1,$2,$3,$4,$5,$6::vector) ON CONFLICT(kind,target_id,model) DO NOTHING",
        [
          space.id,
          row.kind,
          row.target_id,
          model,
          vectors[i].length,
          JSON.stringify(vectors[i]),
        ],
      );
  }
}
