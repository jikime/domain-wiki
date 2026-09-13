import "server-only";
import { isDeepStrictEqual } from "node:util";
import { sql } from "drizzle-orm";
import { ANALYSIS_SPLITTER_VERSION } from "@/lib/document-analysis";
import type { IngestKnowledgeStamp, ingestRun } from "@/server/db/schema";
import { AccessError } from "@/server/errors";
import type { QueryDb } from "@/server/services/wiki";
import {
  hashValue,
  knowledgeSnapshot,
  taskPromptVersion,
  taskSource,
} from "./task-context";

export type IngestRun = typeof ingestRun.$inferSelect;
export async function ingestBasis(
  db: QueryDb,
  fields: Parameters<typeof taskSource>[1],
) {
  // This creates/inspects a durable request, not an AI result. Workers fence
  // source/config changes when they commit. Avoid source->task lock inversion
  // with wiki approval, which acquires its task and page before source locks.
  const source = await taskSource(db, fields);
  const profile = knowledgeSnapshot();
  return {
    source,
    profile,
    hash: hashValue({
      sourceVersionId: fields.sourceVersionId,
      title: source.title,
      category: source.category,
      content: source.sourceHash,
      parser: source.parserVersion,
      rules: source.rulesHash,
      profile,
      analysis: taskPromptVersion("analysis"),
      splitter: ANALYSIS_SPLITTER_VERSION,
      generation: taskPromptVersion("wiki-generation"),
    }),
  };
}
export async function ingestKnowledgeStamp(
  db: QueryDb,
  scope: Pick<IngestRun, "workspaceId" | "domainId" | "projectId" | "sourceId">,
): Promise<IngestKnowledgeStamp> {
  const wikis =
    await db.execute(sql`SELECT p.id,p.published_version_id,p.latest_version_id FROM wiki_page p
    WHERE p.workspace_id=${scope.workspaceId} AND p.domain_id=${scope.domainId}
      AND (p.project_id IS NOT DISTINCT FROM ${scope.projectId}::uuid OR p.project_id IS NULL)
      AND p.published_version_id IS NOT NULL ORDER BY p.id LIMIT 1001`);
  const sources =
    await db.execute(sql`SELECT s.id,s.published_version_id FROM source s
    WHERE s.workspace_id=${scope.workspaceId} AND s.domain_id=${scope.domainId}
      AND (s.project_id IS NOT DISTINCT FROM ${scope.projectId}::uuid OR s.project_id IS NULL)
      AND s.id<>${scope.sourceId} AND source_is_current(s.published_version_id) ORDER BY s.id LIMIT 1001`);
  if (wikis.rows.length > 1000 || sources.rows.length > 1000)
    throw new AccessError(
      413,
      "자동 정리의 비교 범위가 1,000개를 넘었습니다. 도메인·프로젝트 범위를 나누어 주세요.",
    );
  return {
    wikis: wikis.rows.map((r) => ({
      id: String(r.id),
      publishedVersionId: r.published_version_id
        ? String(r.published_version_id)
        : null,
      latestVersionId: r.latest_version_id ? String(r.latest_version_id) : null,
    })),
    sources: sources.rows.map((r) => ({
      id: String(r.id),
      versionId: String(r.published_version_id),
    })),
  };
}
export async function sameIngestKnowledge(
  db: QueryDb,
  run: IngestRun,
  current: IngestKnowledgeStamp,
) {
  if (!isDeepStrictEqual(run.knowledgeStamp.sources, current.sources))
    return false;
  const own = run.generationTaskId
    ? await db.execute(sql`SELECT r->>'pageId' AS page_id,r->>'versionId' AS version_id
    FROM change_batch b CROSS JOIN LATERAL jsonb_array_elements(b.results) r
    WHERE b.task_id=${run.generationTaskId} AND b.state='approved'`)
    : { rows: [] };
  const ignored = new Set(
    own.rows
      .filter((r) =>
        current.wikis.some(
          (p) =>
            p.id === r.page_id &&
            p.publishedVersionId === r.version_id &&
            p.latestVersionId === r.version_id,
        ),
      )
      .map((r) => String(r.page_id)),
  );
  if (run.generationTaskId) {
    const merged =
      await db.execute(sql`SELECT m->>'pageId' AS page_id FROM change_batch b
      CROSS JOIN LATERAL jsonb_array_elements(b.items) i CROSS JOIN LATERAL jsonb_array_elements(i->'mergedPages') m
      WHERE b.task_id=${run.generationTaskId} AND b.state='approved'`);
    for (const r of merged.rows)
      if (!current.wikis.some((p) => p.id === r.page_id))
        ignored.add(String(r.page_id));
  }
  return isDeepStrictEqual(
    run.knowledgeStamp.wikis.filter((p) => !ignored.has(p.id)),
    current.wikis.filter((p) => !ignored.has(p.id)),
  );
}
