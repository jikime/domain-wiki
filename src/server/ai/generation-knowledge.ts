import "server-only";
import { sql } from "drizzle-orm";
import { retrievalTokens } from "@/lib/chat";
import {
  assertGenerationBudget,
  type GenerationAnalysis,
  type GenerationEvidence,
  generationMessages,
  type WikiCandidate,
  wikiPlanPrompt,
} from "@/lib/wiki-generation";
import { emptyWikiMetadata, wikiMetadataSchema } from "@/lib/wiki-metadata";
import { AccessError } from "@/server/errors";
import type { QueryDb } from "@/server/services/wiki";
import {
  candidateForModel,
  loadRevisionCandidates,
  verifyRevisionEvidence,
} from "./generation-revisions";
import type { Task, taskSource } from "./task-context";

export type GenerationKnowledge = {
  candidates: WikiCandidate[];
  relatedSources: GenerationEvidence[];
  sourceEvidence: GenerationEvidence[];
  excluded: {
    kind: "wiki" | "source";
    id: string;
    title: string;
    reason: string;
  }[];
  candidateLimit: number;
};
export function planPayload(
  source: Awaited<ReturnType<typeof taskSource>>,
  analysis: GenerationAnalysis,
  knowledge: GenerationKnowledge,
  projectId: string | null,
) {
  return {
    sourceTitle: source.title,
    sourceId: source.sourceId,
    category: source.category,
    projectId,
    domain: source.rules,
    analysis,
    existingWikis: knowledge.candidates.map(candidateForModel),
    relatedSources: knowledge.relatedSources,
    excludedCandidates: knowledge.excluded,
  };
}
export async function loadGenerationKnowledge(
  db: QueryDb,
  task: Task,
  source: Awaited<ReturnType<typeof taskSource>>,
  analysis: GenerationAnalysis,
): Promise<GenerationKnowledge> {
  if (!task.profile)
    throw new AccessError(409, "지식 생성 모델 설정이 필요합니다.");
  const knowledge: GenerationKnowledge = {
    candidates: [],
    relatedSources: [],
    sourceEvidence: [],
    excluded: [],
    candidateLimit: task.ingestRunId ? 40 : 20,
  };
  const ids = [
    ...new Set(
      analysis.claims.flatMap((c) => c.evidence.map((e) => e.chunkId)),
    ),
  ];
  if (!ids.length)
    throw new AccessError(
      409,
      "위키로 정리할 원문 사실이 없습니다. 분석 결과의 제외 사유를 확인해 주세요.",
    );
  const current =
    await db.execute(sql`SELECT c.id,s.id AS source_id,v.id AS version_id,s.title,c.text,c.locator
    FROM source_chunk c JOIN source_version v ON v.id=c.version_id JOIN source s ON s.id=v.source_id
    WHERE c.workspace_id=${task.workspaceId} AND c.version_id=${task.sourceVersionId} AND c.id=ANY(${sql.param(ids)}::uuid[]) ORDER BY c.ordinal`);
  knowledge.sourceEvidence = current.rows.map((e) => ({
    id: String(e.id),
    sourceId: String(e.source_id),
    versionId: String(e.version_id),
    title: String(e.title),
    text: String(e.text),
    locator: e.locator as Record<string, unknown>,
  }));
  if (
    knowledge.sourceEvidence.length !== ids.length ||
    analysis.claims.some((c) =>
      c.evidence.some(
        (e) =>
          !knowledge.sourceEvidence
            .find((s) => s.id === e.chunkId)
            ?.text.includes(e.quote),
      ),
    )
  )
    throw new AccessError(
      409,
      "완료 분석의 원문 ID 또는 인용을 현재 문서에서 확인하지 못했습니다.",
    );
  assertGenerationBudget(
    generationMessages(
      wikiPlanPrompt,
      planPayload(source, analysis, knowledge, task.projectId),
    ),
    task.profile.contextChars,
  );
  const tokens = [
    ...new Set([
      ...analysis.claims
        .flatMap((c) => [c.subject, c.predicate])
        .filter((t) => t.length > 1),
      ...retrievalTokens(
        `${source.title} ${analysis.summaries.map((s) => s.text).join(" ")}`,
      ),
    ]),
  ].slice(0, 100);
  const rows = await db.execute(sql`WITH ranked AS (
    SELECT p.id AS page_id,p.project_id,p.published_version_id,p.latest_version_id,v.title,v.body,v.metadata,
      ARRAY(SELECT e.chunk_id FROM wiki_evidence e WHERE e.version_id=v.id ORDER BY e.chunk_id) AS chunk_ids,
      ARRAY(SELECT DISTINCT sv.source_id FROM wiki_evidence e JOIN source_chunk sc ON sc.id=e.chunk_id JOIN source_version sv ON sv.id=sc.version_id WHERE e.version_id=v.id) AS source_ids,
      (SELECT count(*) FROM unnest(${sql.param(tokens)}::text[]) token WHERE strpos(lower(v.title||' '||v.body||' '||COALESCE(v.metadata->'aliases','[]'::jsonb)::text),lower(token))>0)
      + CASE WHEN EXISTS(SELECT 1 FROM wiki_evidence e JOIN source_chunk c ON c.id=e.chunk_id WHERE e.version_id=v.id AND c.version_id=${task.sourceVersionId}) THEN 100 ELSE 0 END AS score
    FROM wiki_page p JOIN wiki_version v ON v.id=p.published_version_id AND v.workspace_id=p.workspace_id
    WHERE p.workspace_id=${task.workspaceId} AND p.domain_id=${task.domainId}
      AND (p.project_id IS NOT DISTINCT FROM ${task.projectId}::uuid OR p.project_id IS NULL)
      AND v.state='approved' AND EXISTS(SELECT 1 FROM wiki_evidence e WHERE e.version_id=v.id)
      AND NOT EXISTS(SELECT 1 FROM wiki_evidence e JOIN source_chunk c ON c.id=e.chunk_id JOIN source_version sv ON sv.id=c.version_id JOIN source s ON s.id=sv.source_id WHERE e.version_id=v.id AND
        (s.workspace_id<>p.workspace_id OR s.domain_id<>p.domain_id OR (s.project_id IS NOT NULL AND s.project_id IS DISTINCT FROM ${task.projectId}::uuid) OR NOT source_is_current(sv.id))))
    SELECT * FROM ranked WHERE score>0 ORDER BY score DESC,title,page_id LIMIT 21`);
  const candidates: WikiCandidate[] = rows.rows.map((r) => ({
    pageId: String(r.page_id),
    projectId: r.project_id ? String(r.project_id) : null,
    publishedVersionId: String(r.published_version_id),
    latestVersionId: String(r.latest_version_id),
    title: String(r.title),
    body: String(r.body),
    chunkIds: r.chunk_ids as string[],
    sourceIds: r.source_ids as string[],
    metadata: wikiMetadataSchema.parse(r.metadata ?? emptyWikiMetadata),
    score: Number(r.score),
  }));
  const revisions = await loadRevisionCandidates(db, task, source.sourceId);
  for (const candidate of [
    ...revisions,
    ...candidates.filter((c) => !revisions.some((r) => r.pageId === c.pageId)),
  ]) {
    let reason = "";
    if (knowledge.candidates.length >= knowledge.candidateLimit)
      reason = "관련 위키 후보 조회 상한을 넘었습니다.";
    else {
      try {
        assertGenerationBudget(
          generationMessages(
            wikiPlanPrompt,
            planPayload(
              source,
              analysis,
              {
                ...knowledge,
                candidates: [...knowledge.candidates, candidate],
              },
              task.projectId,
            ),
          ),
          task.profile.contextChars,
        );
      } catch {
        reason =
          "전체 위키 본문을 입력 예산에 담을 수 없어 비교에서 제외했습니다.";
      }
    }
    if (reason && candidate.revision)
      throw new AccessError(
        413,
        "개정 대상 위키 본문을 모두 비교할 입력 공간이 부족합니다. 생성 입력 상한을 늘려 주세요. 기존 위키를 누락하거나 새 페이지로 대체하지 않았습니다.",
      );
    if (reason)
      knowledge.excluded.push({
        kind: "wiki",
        id: candidate.pageId,
        title: candidate.title,
        reason,
      });
    else knowledge.candidates.push(candidate);
  }
  const related = await db.execute(sql`WITH ranked AS (
    SELECT c.id,s.id AS source_id,v.id AS version_id,s.title,c.text,c.locator,
      (SELECT count(*) FROM unnest(${sql.param(tokens)}::text[]) token WHERE strpos(lower(s.title||' '||c.text),lower(token))>0) AS score
    FROM source_chunk c JOIN source_version v ON v.id=c.version_id JOIN source s ON s.id=v.source_id
    WHERE s.workspace_id=${task.workspaceId} AND s.domain_id=${task.domainId}
      AND (s.project_id IS NOT DISTINCT FROM ${task.projectId}::uuid OR s.project_id IS NULL)
      AND s.id<>${source.sourceId} AND source_is_current(v.id))
    SELECT * FROM ranked WHERE score>0 ORDER BY score DESC,title,id LIMIT 10`);
  for (const row of related.rows) {
    const entry = {
      id: String(row.id),
      sourceId: String(row.source_id),
      versionId: String(row.version_id),
      title: String(row.title),
      text: String(row.text),
      locator: row.locator as Record<string, unknown>,
    };
    try {
      assertGenerationBudget(
        generationMessages(
          wikiPlanPrompt,
          planPayload(
            source,
            analysis,
            {
              ...knowledge,
              relatedSources: [...knowledge.relatedSources, entry],
            },
            task.projectId,
          ),
        ),
        task.profile.contextChars,
      );
      knowledge.relatedSources.push(entry);
    } catch {
      knowledge.excluded.push({
        kind: "source",
        id: entry.id,
        title: entry.title,
        reason:
          "원문 문단 전체를 입력 예산에 담을 수 없어 비교에서 제외했습니다.",
      });
    }
  }
  assertGenerationBudget(
    generationMessages(
      wikiPlanPrompt,
      planPayload(source, analysis, knowledge, task.projectId),
    ),
    task.profile.contextChars,
  );
  return knowledge;
}
export async function verifyGenerationKnowledge(
  db: QueryDb,
  task: Task,
  knowledge: GenerationKnowledge,
  lock = false,
  display = false,
) {
  const chunkIds = [
    ...new Set([
      ...knowledge.sourceEvidence.map((e) => e.id),
      ...knowledge.relatedSources.map((e) => e.id),
      ...knowledge.candidates.flatMap((c) => c.chunkIds),
    ]),
  ];
  if (chunkIds.length) {
    const rows =
      await db.execute(sql`SELECT c.id FROM source_chunk c JOIN source_version v ON v.id=c.version_id JOIN source s ON s.id=v.source_id
      WHERE c.id=ANY(${sql.param(chunkIds)}::uuid[]) AND s.workspace_id=${task.workspaceId} AND s.domain_id=${task.domainId}
      AND (s.project_id IS NOT DISTINCT FROM ${task.projectId}::uuid OR s.project_id IS NULL) AND source_is_current(v.id)
      ORDER BY s.id,c.id ${lock ? sql`FOR SHARE OF s,v` : sql``}`);
    if (rows.rows.length !== chunkIds.length)
      throw new AccessError(
        409,
        "대조에 사용한 공개 원문이 개정·철회되었습니다. 현재 자료로 다시 생성해 주세요.",
      );
  }
  for (const candidate of knowledge.candidates) {
    await verifyRevisionEvidence(db, task, candidate, lock);
    const rows =
      await db.execute(sql`SELECT p.id FROM wiki_page p JOIN wiki_version v ON v.id=COALESCE(p.published_version_id,p.latest_version_id)
      WHERE p.id=${candidate.pageId} AND p.workspace_id=${task.workspaceId} AND p.domain_id=${task.domainId}
      AND (p.project_id IS NOT DISTINCT FROM ${task.projectId}::uuid OR p.project_id IS NULL) AND ((v.state='approved' AND ((p.published_version_id=${candidate.publishedVersionId} AND ${display ? sql`true` : sql`p.latest_version_id=${candidate.latestVersionId}`})
        OR (${display} AND EXISTS(SELECT 1 FROM change_batch b CROSS JOIN LATERAL jsonb_array_elements(b.results) r WHERE b.task_id=${task.id} AND b.state='approved' AND r->>'pageId'=p.id::text AND r->>'versionId'=v.id::text)))) OR (${display} AND p.published_version_id IS NULL AND p.latest_version_id=${candidate.latestVersionId} AND EXISTS(SELECT 1 FROM change_batch b CROSS JOIN LATERAL jsonb_array_elements(b.items) i CROSS JOIN LATERAL jsonb_array_elements(i->'mergedPages') m WHERE b.task_id=${task.id} AND b.state='approved' AND m->>'pageId'=p.id::text AND m->>'publishedVersionId'=${candidate.publishedVersionId})))
      ${lock ? sql`FOR SHARE OF p,v` : sql``}`);
    if (!rows.rows.length)
      throw new AccessError(
        409,
        "대조한 기존 위키가 변경되었습니다. 최신 지식으로 새 생성 작업을 시작해 주세요.",
      );
  }
}
