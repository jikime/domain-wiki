import "server-only";
import { isDeepStrictEqual } from "node:util";
import { sql } from "drizzle-orm";
import type { AnalysisUnit } from "@/lib/document-analysis";
import {
  type GeneratedSections,
  type GenerationAnalysis,
  type GenerationClaim,
  generatedSectionsSchema,
  generationAnalysisSchema,
  type PlannedWikiPage,
  validateGeneratedSections,
  type WikiCandidate,
} from "@/lib/wiki-generation";
import { emptyWikiMetadata, wikiMetadataSchema } from "@/lib/wiki-metadata";
import { AccessError } from "@/server/errors";
import type { QueryDb } from "@/server/services/wiki";
import { hashValue, type Task } from "./task-context";

function chunkSignature(units: AnalysisUnit[], id: string) {
  const parts = units.flatMap((u) =>
    u.parts
      .filter((p) => p.chunkId === id)
      .map((p) => ({
        text: p.text,
        heading: p.headingPath,
        structure: p.structure,
        structureContext: p.structureContext,
        contextBefore: u.contextBefore,
      })),
  );
  return parts.length ? hashValue(parts) : null;
}
export function candidateForModel(candidate: WikiCandidate) {
  const { reusable: _cache, revision, ...publicCandidate } = candidate;
  return {
    ...publicCandidate,
    ...(revision
      ? {
          revision: {
            notice:
              "이 본문에는 개정 전 조건이 남아 있을 수 있습니다. 현재 사실 근거가 아닌 수정 대조 자료입니다. 같은 페이지 주소를 수정하고, 바뀐 조건은 질문에 적으세요.",
            unresolvedEvidence: revision.unresolvedChunkIds.length,
          },
        }
      : {}),
  };
}
export const revisionPlanInstruction =
  "개정 전 대조 자료(revision)는 현재 원문의 사실 근거가 아닙니다. 제공된 모든 개정 전 페이지를 같은 pageId의 update 또는 conflict로 갱신하세요. 새 복제 페이지를 만들거나 이 페이지들을 누락·병합하지 마세요. 바뀌지 않은 본문은 서버가 새 근거에 재연결할 수 있습니다. 기존 직원 문장은 보존하고 바뀐 조건은 검토 질문에 적으세요.";
export async function loadRevisionCandidates(
  db: QueryDb,
  task: Task,
  sourceId: string,
): Promise<WikiCandidate[]> {
  if (!task.ingestRunId) return [];
  const prepared = await db.execute(
    sql`SELECT a.result FROM ai_step a WHERE a.task_id=${task.analysisTaskId} AND a.kind='prepare'`,
  );
  const currentUnits =
    (prepared.rows[0]?.result as { units?: AnalysisUnit[] } | undefined)
      ?.units ?? [];
  const currentChunks = await db.execute(
    sql`SELECT id,text FROM source_chunk WHERE workspace_id=${task.workspaceId} AND version_id=${task.sourceVersionId} ORDER BY ordinal`,
  );
  const rows =
    await db.execute(sql`SELECT p.id AS page_id,p.project_id,p.published_version_id,p.latest_version_id,v.title,v.body,v.metadata,
      (p.created_by=${task.authorId} OR m.is_admin OR m.role='reviewer') AS can_manage,
      ARRAY(SELECT e.chunk_id FROM wiki_evidence e WHERE e.version_id=v.id ORDER BY e.chunk_id) AS chunk_ids
    FROM wiki_page p JOIN wiki_version v ON v.id=p.published_version_id
    JOIN membership m ON m.workspace_id=p.workspace_id AND m.user_id=${task.authorId}
    WHERE p.workspace_id=${task.workspaceId} AND p.domain_id=${task.domainId} AND p.project_id IS NOT DISTINCT FROM ${task.projectId}::uuid AND v.state='approved'
      AND EXISTS(SELECT 1 FROM wiki_evidence e JOIN source_chunk c ON c.id=e.chunk_id JOIN source_version sv ON sv.id=c.version_id WHERE e.version_id=v.id AND sv.source_id=${sourceId})
    ORDER BY p.id`);
  const candidates: WikiCandidate[] = [];
  for (const row of rows.rows) {
    const ids = row.chunk_ids as string[];
    const evidence =
      await db.execute(sql`SELECT c.id,c.text,c.version_id,v.source_id,v.publication,v.processing,source_is_current(v.id) AS current,
      s.workspace_id,s.domain_id,s.project_id FROM source_chunk c JOIN source_version v ON v.id=c.version_id JOIN source s ON s.id=v.source_id WHERE c.id=ANY(${sql.param(ids)}::uuid[]) ORDER BY c.id`);
    if (
      evidence.rows.length !== ids.length ||
      evidence.rows.some(
        (e) =>
          e.workspace_id !== task.workspaceId ||
          e.domain_id !== task.domainId ||
          (e.project_id !== null && e.project_id !== task.projectId),
      )
    )
      throw new AccessError(
        409,
        "연결된 기존 위키의 근거 범위를 확인해야 합니다. 검토 직원이 기존 자료를 정리한 뒤 다시 실행해 주세요.",
      );
    const prior = evidence.rows.filter((e) => !e.current);
    if (
      prior.some(
        (e) =>
          e.source_id !== sourceId ||
          e.publication !== "superseded" ||
          e.processing !== "completed",
      )
    )
      throw new AccessError(
        409,
        "연결된 위키에 철회되었거나 별도 개정된 원문이 있습니다. 기존 위키의 근거를 먼저 검토해 주세요.",
      );
    if (prior.length && !row.can_manage)
      throw new AccessError(
        409,
        "개정 전 위키를 확인할 작성자 또는 검토 직원의 정리가 필요합니다.",
      );
    if (row.latest_version_id !== row.published_version_id)
      throw new AccessError(
        409,
        "이 자료와 연결된 위키에 아직 검토하지 않은 수정본이 있습니다. 먼저 해당 수정본을 처리한 뒤 정리해 주세요.",
      );
    const history =
      await db.execute(sql`SELECT t.id AS task_id,t.analysis_task_id,i.item,a.id AS step_id,COALESCE(a.cache_origin_step_id,a.id) AS root_step_id,a.result AS sections,parent.result AS analysis,prep.result AS prepared
      FROM change_batch b JOIN ai_task t ON t.id=b.task_id
      JOIN ai_task parent ON parent.id=t.analysis_task_id JOIN source_version sv ON sv.id=t.source_version_id
      JOIN membership m ON m.workspace_id=t.workspace_id AND m.user_id=t.author_id
      JOIN change_batch original ON original.task_id=b.task_id AND original.group_ordinal=b.group_ordinal AND original.group_revision=1
      CROSS JOIN LATERAL jsonb_array_elements(original.items) i(item)
      JOIN ai_step a ON a.task_id=t.id AND a.kind='generate-wiki' AND a.input->'page'->>'plannedPageId'=${String(row.page_id)}
      JOIN ai_step prep ON prep.task_id=parent.id AND prep.kind='prepare'
      JOIN membership pm ON pm.workspace_id=parent.workspace_id AND pm.user_id=parent.author_id
      JOIN ai_step root ON root.id=COALESCE(a.cache_origin_step_id,a.id) JOIN ai_task rt ON rt.id=root.task_id
      JOIN source_version rv ON rv.id=rt.source_version_id JOIN membership rm ON rm.workspace_id=rt.workspace_id AND rm.user_id=rt.author_id
      JOIN ai_task rp ON rp.id=rt.analysis_task_id JOIN membership rpm ON rpm.workspace_id=rp.workspace_id AND rpm.user_id=rp.author_id
      WHERE b.workspace_id=${task.workspaceId} AND b.state='approved' AND t.state='completed' AND parent.state='completed'
        AND t.rules_hash=${task.rulesHash} AND t.profile=${sql.param(task.profile)}::jsonb AND t.prompt_version=${task.promptVersion}
        AND sv.source_id=${sourceId} AND sv.publication IN ('published','superseded')
        AND m.is_active AND (m.is_admin OR m.role IN ('writer','reviewer'))
        AND a.state='completed' AND root.state='completed' AND rt.state='completed' AND rp.state='completed'
        AND rt.workspace_id=${task.workspaceId} AND rv.source_id=${sourceId} AND rv.publication IN ('published','superseded')
        AND pm.is_active AND (pm.is_admin OR pm.role IN ('writer','reviewer'))
        AND rm.is_active AND (rm.is_admin OR rm.role IN ('writer','reviewer'))
        AND rpm.is_active AND (rpm.is_admin OR rpm.role IN ('writer','reviewer'))
        AND (i.item->>'plannedPageId'=${String(row.page_id)} OR i.item->>'pageId'=${String(row.page_id)})
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.results) r WHERE r->>'pageId'=${String(row.page_id)})
      ORDER BY b.created_at DESC LIMIT 1`);
    const previous = history.rows[0];
    const previousUnits =
      (previous?.prepared as { units?: AnalysisUnit[] } | undefined)?.units ??
      [];
    const mappings: { previousId: string; currentId: string }[] = [];
    for (const old of prior) {
      const signature = chunkSignature(previousUnits, String(old.id));
      const match = signature
        ? currentChunks.rows.find(
            (c) =>
              c.text === old.text &&
              chunkSignature(currentUnits, String(c.id)) === signature,
          )
        : undefined;
      if (match)
        mappings.push({
          previousId: String(old.id),
          currentId: String(match.id),
        });
    }
    const candidate: WikiCandidate = {
      pageId: String(row.page_id),
      projectId: row.project_id ? String(row.project_id) : null,
      publishedVersionId: String(row.published_version_id),
      latestVersionId: String(row.latest_version_id),
      title: String(row.title),
      body: String(row.body),
      metadata: wikiMetadataSchema.parse(row.metadata ?? emptyWikiMetadata),
      chunkIds: [
        ...new Set([
          ...evidence.rows.filter((e) => e.current).map((e) => String(e.id)),
          ...mappings.map((m) => m.currentId),
        ]),
      ],
      score: 1000,
      sourceIds: [...new Set(evidence.rows.map((e) => String(e.source_id)))],
      ...(prior.length
        ? {
            revision: {
              sourceId,
              previousChunkIds: prior.map((e) => String(e.id)),
              mappings,
              unresolvedChunkIds: prior
                .filter((e) => !mappings.some((m) => m.previousId === e.id))
                .map((e) => String(e.id)),
            },
          }
        : {}),
    };
    if (previous) {
      const analysis = generationAnalysisSchema.safeParse(previous.analysis);
      const sections = generatedSectionsSchema.safeParse(previous.sections);
      const item = previous.item as { body?: string; claimIds?: string[] };
      if (
        analysis.success &&
        sections.success &&
        item.body &&
        item.claimIds?.length
      )
        candidate.reusable = {
          taskId: String(previous.task_id),
          stepId: String(previous.step_id),
          rootStepId: String(previous.root_step_id),
          body: item.body,
          claims: analysis.data.claims.filter((c) =>
            item.claimIds?.includes(c.id),
          ),
          sections: sections.data,
        };
    }
    candidates.push(candidate);
  }
  return candidates;
}
function claimSignature(claim: GenerationClaim) {
  const { id: _id, unitId: _unit, evidence, ...content } = claim;
  return hashValue({
    ...content,
    evidence: evidence.map((e) => e.quote).sort(),
  });
}
export function reusablePageSections(
  candidate: WikiCandidate | undefined,
  page: PlannedWikiPage,
  analysis: GenerationAnalysis,
  destinationIds: string[],
): { stepId: string; result: GeneratedSections } | null {
  const cache = candidate?.reusable;
  if (
    !candidate ||
    !cache ||
    page.kind !== "update" ||
    candidate.body !== cache.body ||
    candidate.revision?.unresolvedChunkIds.length
  )
    return null;
  if (
    !isDeepStrictEqual(
      [...new Set(destinationIds)].sort(),
      candidate.metadata.links.map((l) => l.pageId).sort(),
    )
  )
    return null;
  const selected = analysis.claims.filter((c) => page.claimIds.includes(c.id));
  const previous = cache.claims;
  if (selected.length !== previous.length) return null;
  const remaining = [...selected];
  const mapping = new Map<string, string>();
  for (const old of previous) {
    const index = remaining.findIndex(
      (c) => claimSignature(c) === claimSignature(old),
    );
    if (index < 0) return null;
    mapping.set(old.id, remaining.splice(index, 1)[0].id);
  }
  const result = {
    ...cache.sections,
    sections: cache.sections.sections.map((s) => ({
      ...s,
      claimIds: s.claimIds.map(
        (id) => mapping.get(id) ?? "invalid-cache-claim",
      ),
    })),
  };
  try {
    return {
      stepId: cache.rootStepId,
      result: validateGeneratedSections(result, page, analysis.claims),
    };
  } catch {
    return null;
  }
}
export async function verifyRevisionEvidence(
  db: QueryDb,
  task: Task,
  candidate: WikiCandidate,
  lock: boolean,
) {
  if (candidate.reusable) {
    const cache = candidate.reusable;
    const rows =
      await db.execute(sql`SELECT a.id FROM ai_step a JOIN ai_task t ON t.id=a.task_id
      JOIN source_version v ON v.id=t.source_version_id JOIN membership m ON m.workspace_id=t.workspace_id AND m.user_id=t.author_id
      JOIN ai_task parent ON parent.id=t.analysis_task_id JOIN membership pm ON pm.workspace_id=parent.workspace_id AND pm.user_id=parent.author_id
      JOIN ai_step root ON root.id=COALESCE(a.cache_origin_step_id,a.id) JOIN ai_task rt ON rt.id=root.task_id
      JOIN source_version rv ON rv.id=rt.source_version_id JOIN membership rm ON rm.workspace_id=rt.workspace_id AND rm.user_id=rt.author_id
      JOIN ai_task rp ON rp.id=rt.analysis_task_id JOIN membership rpm ON rpm.workspace_id=rp.workspace_id AND rpm.user_id=rp.author_id
      JOIN source_version current_v ON current_v.id=${task.sourceVersionId}
      WHERE a.id=${cache.stepId} AND t.id=${cache.taskId} AND root.id=${cache.rootStepId}
        AND a.state='completed' AND t.state='completed' AND root.state='completed' AND rt.state='completed'
        AND t.workspace_id=${task.workspaceId} AND rt.workspace_id=${task.workspaceId}
        AND v.source_id=current_v.source_id AND rv.source_id=current_v.source_id
        AND v.publication IN ('published','superseded') AND rv.publication IN ('published','superseded')
        AND m.is_active AND (m.is_admin OR m.role IN ('writer','reviewer'))
        AND pm.is_active AND (pm.is_admin OR pm.role IN ('writer','reviewer'))
        AND rm.is_active AND (rm.is_admin OR rm.role IN ('writer','reviewer'))
        AND rpm.is_active AND (rpm.is_admin OR rpm.role IN ('writer','reviewer'))
        ${lock ? sql`FOR SHARE OF t,v,m,parent,pm,rt,rv,rm,rp,rpm` : sql``}`);
    if (!rows.rows.length)
      throw new AccessError(
        409,
        "이전 생성 결과의 작성 권한 또는 원문이 변경되어 본문을 재사용할 수 없습니다.",
      );
  }
  const revision = candidate.revision;
  if (!revision) return;
  const rows =
    await db.execute(sql`SELECT c.id,c.text FROM source_chunk c JOIN source_version v ON v.id=c.version_id JOIN source s ON s.id=v.source_id
    WHERE c.id=ANY(${sql.param(revision.previousChunkIds)}::uuid[]) AND s.id=${revision.sourceId}
      AND s.workspace_id=${task.workspaceId} AND s.domain_id=${task.domainId} AND s.project_id IS NOT DISTINCT FROM ${task.projectId}::uuid
      AND s.published_version_id=${task.sourceVersionId} AND v.publication='superseded' AND v.processing='completed'
    ORDER BY s.id,c.id ${lock ? sql`FOR SHARE OF s,v` : sql``}`);
  if (rows.rows.length !== revision.previousChunkIds.length)
    throw new AccessError(
      409,
      "개정 전 대조 원문이 철회·삭제되어 이전 본문을 재사용할 수 없습니다.",
    );
  if (revision.mappings.length) {
    const current = await db.execute(
      sql`SELECT id,text FROM source_chunk WHERE version_id=${task.sourceVersionId} AND id=ANY(${sql.param(revision.mappings.map((m) => m.currentId))}::uuid[])`,
    );
    if (
      revision.mappings.some(
        (m) =>
          rows.rows.find((r) => r.id === m.previousId)?.text !==
          current.rows.find((r) => r.id === m.currentId)?.text,
      )
    )
      throw new AccessError(
        409,
        "개정 원문의 문단 재연결을 확인하지 못했습니다.",
      );
  }
}
