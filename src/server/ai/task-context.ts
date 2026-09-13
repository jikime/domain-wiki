import "server-only";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { ANALYSIS_PROMPT_VERSION } from "@/lib/document-analysis";
import { domainKnowledgeRules, type PurposeGuide } from "@/lib/domain-purpose";
import {
  generationAnalysisSchema,
  WIKI_GENERATION_PROMPT_VERSION,
} from "@/lib/wiki-generation";
import { modelProfile } from "@/server/ai/client";
import { aiStep, aiTask } from "@/server/db/schema";
import { AccessError } from "@/server/errors";
import type { QueryDb } from "@/server/services/wiki";
import {
  type GenerationKnowledge,
  verifyGenerationKnowledge,
} from "./generation-knowledge";
export type Task = typeof aiTask.$inferSelect;
export const SUMMARY_PROMPT_VERSION = "document-summary-v1";
export function taskPromptVersion(kind: string) {
  if (kind === "summary") return SUMMARY_PROMPT_VERSION;
  if (kind === "analysis") return ANALYSIS_PROMPT_VERSION;
  if (kind === "wiki-generation") return WIKI_GENERATION_PROMPT_VERSION;
  throw new AccessError(409, "지원하지 않는 AI 작업 종류입니다.");
}
export function hashValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function knowledgeSnapshot() {
  const p = modelProfile("knowledge");
  return p.configured && p.model
    ? { model: p.model, identity: p.identity, contextChars: p.contextChars }
    : null;
}
export async function taskSource(
  tx: QueryDb,
  task: Pick<
    Task,
    "workspaceId" | "authorId" | "sourceVersionId" | "domainId" | "projectId"
  >,
  lock = false,
) {
  const result =
    await tx.execute(sql`SELECT s.id AS source_id,s.title,s.category,d.name,d.purpose,d.purpose_guide,d.purpose_markdown,d.schema_markdown,d.terms,d.record_template,v.parser_version,v.sha256,v.warnings
    FROM source_version v JOIN source s ON s.id=v.source_id AND s.workspace_id=v.workspace_id
    JOIN domain d ON d.id=s.domain_id AND d.workspace_id=s.workspace_id
    JOIN membership m ON m.workspace_id=s.workspace_id AND m.user_id=${task.authorId}
    WHERE v.id=${task.sourceVersionId} AND v.workspace_id=${task.workspaceId}
      AND s.domain_id=${task.domainId} AND s.project_id IS NOT DISTINCT FROM ${task.projectId}::uuid
      AND m.is_active AND (m.is_admin OR m.role IN ('writer','reviewer'))
      AND s.published_version_id=v.id AND v.publication='published' AND v.processing='completed' AND source_is_current(v.id)
    ${lock ? sql`FOR SHARE OF m,s,v,d` : sql``}`);
  const row = result.rows[0];
  if (!row)
    throw new AccessError(
      409,
      "작성 권한 또는 현재 공개 원문이 변경되어 작업을 계속할 수 없습니다.",
    );
  const rules = domainKnowledgeRules({
    name: String(row.name),
    purpose: String(row.purpose),
    purposeGuide: row.purpose_guide as PurposeGuide,
    purposeMarkdown: String(row.purpose_markdown ?? ""),
    schemaMarkdown: String(row.schema_markdown ?? ""),
    terms: row.terms,
    recordTemplate: String(row.record_template),
  });
  return {
    sourceId: String(row.source_id),
    title: String(row.title),
    category: String(row.category),
    parserVersion: row.parser_version ? String(row.parser_version) : null,
    sourceHash: String(row.sha256),
    warnings: row.warnings as string[],
    rules,
    rulesHash: hashValue(rules),
  };
}
export async function verifyTask(tx: QueryDb, task: Task, lock = false) {
  await verifyIngestTask(tx, task, true);
  if (task.promptVersion !== taskPromptVersion(task.kind))
    throw new AccessError(
      409,
      "분석 프롬프트 기준이 바뀌었습니다. 새 작업을 시작하세요.",
    );
  const source = await taskSource(tx, task, lock);
  await verifyPreparedSource(tx, task, source, lock);
  if (source.rulesHash !== task.rulesHash)
    throw new AccessError(
      409,
      "도메인 기준이 바뀌었습니다. 현재 기준으로 새 작업을 시작하세요.",
    );
  const profile = knowledgeSnapshot();
  if (task.profile && profile?.identity !== task.profile.identity)
    throw new AccessError(
      409,
      "지식 생성 모델 설정이 바뀌었습니다. 현재 설정으로 새 작업을 시작하세요.",
    );
  if (task.kind === "wiki-generation") {
    await generationAnalysis(tx, task, lock);
    const [prepared] = await tx
      .select({ result: aiStep.result })
      .from(aiStep)
      .where(
        and(eq(aiStep.taskId, task.id), eq(aiStep.kind, "generation-prepare")),
      );
    const knowledge = prepared?.result?.knowledge as
      | GenerationKnowledge
      | undefined;
    if (knowledge) await verifyGenerationKnowledge(tx, task, knowledge, lock);
  }
  return source;
}
export async function verifyPreparedSource(
  tx: QueryDb,
  task: Task,
  source: Awaited<ReturnType<typeof taskSource>>,
  lock = false,
) {
  if (task.kind === "wiki-generation") return;
  const [prepared] = await tx
    .select({ result: aiStep.result })
    .from(aiStep)
    .where(and(eq(aiStep.taskId, task.id), eq(aiStep.kind, "prepare")));
  const pinned = prepared?.result;
  // Older saved tasks did not persist this metadata. Newly prepared work pins
  // both values, including an explicitly null parser version.
  if (
    pinned &&
    (Object.hasOwn(pinned, "sourceHash") ||
      Object.hasOwn(pinned, "parserVersion")) &&
    (pinned.sourceHash !== source.sourceHash ||
      pinned.parserVersion !== source.parserVersion)
  )
    throw new AccessError(
      409,
      "원문 파일 또는 추출 정보가 바뀌었습니다. 현재 원문으로 새 분석을 시작하세요.",
    );
  const origins = await tx
    .select({ id: aiStep.cacheOriginStepId })
    .from(aiStep)
    .where(
      and(
        eq(aiStep.taskId, task.id),
        sql`${aiStep.cacheOriginStepId} IS NOT NULL`,
      ),
    );
  const ids = [
    ...new Set(origins.map((r) => r.id).filter((id): id is string => !!id)),
  ];
  if (!ids.length) return;
  const valid =
    await tx.execute(sql`SELECT a.id FROM ai_step a JOIN ai_task t ON t.id=a.task_id
    JOIN source_version v ON v.id=t.source_version_id
    JOIN membership m ON m.workspace_id=t.workspace_id AND m.user_id=t.author_id
    WHERE a.id=ANY(${sql.param(ids)}::uuid[]) AND a.kind='analyze' AND a.state='completed' AND t.state='completed'
      AND t.workspace_id=${task.workspaceId} AND v.source_id=${source.sourceId}
      AND v.publication IN ('published','superseded') AND v.processing='completed'
      AND m.is_active AND (m.is_admin OR m.role IN ('writer','reviewer'))
    ORDER BY a.id ${lock ? sql`FOR SHARE OF v,m` : sql``}`);
  if (valid.rows.length !== ids.length)
    throw new AccessError(
      409,
      "재사용한 분석의 최초 원문 또는 작성 권한이 변경되었습니다. 현재 기준으로 새 분석을 시작하세요.",
    );
}
export async function verifyIngestTask(
  tx: QueryDb,
  task: Task,
  executing = false,
) {
  if (!task.ingestRunId) return;
  if (task.kind === "analysis" && task.state === "completed") return;
  const rows =
    await tx.execute(sql`SELECT r.id FROM ingest_run r JOIN domain d ON d.id=r.domain_id
    WHERE r.id=${task.ingestRunId} AND r.workspace_id=${task.workspaceId}
      AND r.author_id=${task.authorId} AND r.source_version_id=${task.sourceVersionId}
      AND r.state<>'outdated' AND (r.state NOT IN ('failed','canceled') OR (${!executing} AND ${task.state}<>'completed'))
      AND (${!executing} OR r.origin='manual' OR d.auto_ingest OR r.state IN ('review','completed'))`);
  if (!rows.rows.length)
    throw new AccessError(
      409,
      "자동 정리가 중지되었거나 이전 기준의 작업입니다. 자료 상세에서 정리 상태를 확인해 주세요.",
    );
}
export async function generationAnalysis(
  tx: QueryDb,
  task: Pick<
    Task,
    | "workspaceId"
    | "sourceVersionId"
    | "domainId"
    | "projectId"
    | "analysisTaskId"
    | "rulesHash"
    | "profile"
  >,
  lock = false,
) {
  if (!task.analysisTaskId)
    throw new AccessError(409, "완료된 전체 분석이 필요합니다.");
  const [parent] = await tx
    .select()
    .from(aiTask)
    .where(
      and(
        eq(aiTask.id, task.analysisTaskId),
        eq(aiTask.workspaceId, task.workspaceId),
      ),
    );
  if (
    !parent ||
    parent.kind !== "analysis" ||
    parent.state !== "completed" ||
    parent.sourceVersionId !== task.sourceVersionId ||
    parent.domainId !== task.domainId ||
    parent.projectId !== task.projectId ||
    parent.rulesHash !== task.rulesHash ||
    parent.promptVersion !== ANALYSIS_PROMPT_VERSION ||
    (task.profile && parent.profile?.identity !== task.profile.identity)
  )
    throw new AccessError(
      409,
      "현재 원문·도메인 기준·모델 설정으로 완료한 전체 분석이 필요합니다.",
    );
  await verifyPreparedSource(
    tx,
    parent,
    await taskSource(tx, parent, lock),
    lock,
  );
  const parsed = generationAnalysisSchema.safeParse(parent.result);
  if (
    !parsed.success ||
    parsed.data.coverage.processedUnits !== parsed.data.coverage.totalUnits ||
    parsed.data.coverage.processedParts !== parsed.data.coverage.totalParts ||
    parsed.data.coverage.processedChars !== parsed.data.coverage.totalChars
  )
    throw new AccessError(409, "전체 구간을 완료한 분석 결과가 필요합니다.");
  return parsed.data;
}
