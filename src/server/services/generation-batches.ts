import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { wikiLinksFromMarkdown } from "@/lib/wiki-links";
import { emptyWikiMetadata, wikiMetadataSchema } from "@/lib/wiki-metadata";
import {
  type GenerationKnowledge,
  verifyGenerationKnowledge,
} from "@/server/ai/generation-knowledge";
import {
  generationAnalysis,
  taskSource,
  verifyIngestTask,
} from "@/server/ai/task-context";
import {
  aiStep,
  aiTask,
  changeBatch,
  type ProposalItem,
} from "@/server/db/schema";
import { AccessError } from "@/server/errors";
import type { QueryDb } from "./wiki";

export type ChangeBatch = typeof changeBatch.$inferSelect;
export const latestBatchCondition =
  "(change_batch.task_id IS NULL OR (NOT EXISTS(SELECT 1 FROM change_batch newer WHERE newer.task_id=change_batch.task_id AND newer.group_ordinal=change_batch.group_ordinal AND newer.group_revision>change_batch.group_revision) AND NOT EXISTS(SELECT 1 FROM ai_task t JOIN ingest_run r ON r.id=t.ingest_run_id WHERE t.id=change_batch.task_id AND r.state='outdated')))";
export const latestBatchSql = sql.raw(latestBatchCondition);
export async function latestGenerationGroups(db: QueryDb, taskId: string) {
  const rows = await db
    .select()
    .from(changeBatch)
    .where(eq(changeBatch.taskId, taskId))
    .orderBy(changeBatch.groupOrdinal, desc(changeBatch.groupRevision));
  const groups = new Map<number, ChangeBatch>();
  for (const row of rows)
    if (row.groupOrdinal !== null && !groups.has(row.groupOrdinal))
      groups.set(row.groupOrdinal, row);
  return [...groups.values()];
}
export async function lockGenerationTask(
  db: QueryDb,
  workspaceId: string,
  taskId: string,
) {
  const [task] = await db
    .select()
    .from(aiTask)
    .where(and(eq(aiTask.id, taskId), eq(aiTask.workspaceId, workspaceId)))
    .for("update");
  if (!task || task.kind !== "wiki-generation" || task.state !== "completed")
    throw new AccessError(
      409,
      "전체 위키 생성이 완료된 작업의 묶음만 검토할 수 있습니다. 작업 상태를 먼저 확인해 주세요.",
    );
  // Acquire every compared/linked wiki page in one stable order before source
  // locks or target updates. Concurrent manual batches use the same page order.
  const [prepared] = await db
    .select({ result: aiStep.result })
    .from(aiStep)
    .where(
      and(eq(aiStep.taskId, task.id), eq(aiStep.kind, "generation-prepare")),
    );
  const knowledge = prepared?.result?.knowledge as
    | GenerationKnowledge
    | undefined;
  const groups = await latestGenerationGroups(db, task.id);
  const pageIds = [
    ...new Set([
      ...(knowledge?.candidates.map((c) => c.pageId) ?? []),
      ...groups.flatMap((g) =>
        g.items.flatMap((i) => [
          ...(i.pageId ? [i.pageId] : []),
          ...i.mergedPages.map((p) => p.pageId),
          ...(i.metadata?.links.map((l) => l.pageId) ?? []),
        ]),
      ),
    ]),
  ].sort();
  if (pageIds.length)
    await db.execute(
      sql`SELECT id FROM wiki_page WHERE workspace_id=${workspaceId} AND id=ANY(${sql.param(pageIds)}::uuid[]) ORDER BY id FOR UPDATE`,
    );
  const current = await taskSource(db, task, true);
  if (current.rulesHash !== task.rulesHash)
    throw new AccessError(
      409,
      "도메인 기준이 바뀌었습니다. 현재 기준의 분석과 생성으로 검토 묶음을 다시 준비해 주세요.",
    );
  await checkGenerationContext(db, task, true);
  return task;
}
export async function checkGenerationContext(
  db: QueryDb,
  task: typeof aiTask.$inferSelect,
  lock = false,
) {
  await verifyIngestTask(db, task);
  await taskSource(db, task, lock);
  await generationAnalysis(db, task, lock);
  const [prepared] = await db
    .select({ result: aiStep.result })
    .from(aiStep)
    .where(
      and(eq(aiStep.taskId, task.id), eq(aiStep.kind, "generation-prepare")),
    );
  const knowledge = prepared?.result?.knowledge as
    | GenerationKnowledge
    | undefined;
  const groups = await latestGenerationGroups(db, task.id);
  const revisionEvidence = [
    ...new Set(groups.flatMap((g) => g.items.flatMap((i) => i.chunkIds))),
  ];
  if (revisionEvidence.length) {
    const rows = await db.execute(
      sql`SELECT c.id FROM source_chunk c JOIN source_version v ON v.id=c.version_id JOIN source s ON s.id=v.source_id WHERE c.id=ANY(${sql.param(revisionEvidence)}::uuid[]) AND s.workspace_id=${task.workspaceId} AND s.domain_id=${task.domainId} AND (s.project_id IS NOT DISTINCT FROM ${task.projectId}::uuid OR s.project_id IS NULL) AND source_is_current(v.id) ORDER BY s.id,c.id ${lock ? sql`FOR SHARE OF s,v` : sql``}`,
    );
    if (rows.rows.length !== revisionEvidence.length)
      throw new AccessError(
        409,
        "수정한 검토 묶음의 원문 근거가 개정·철회되었습니다. 현재 근거로 다시 준비해 주세요.",
      );
  }
  if (knowledge)
    await verifyGenerationKnowledge(
      db,
      task,
      knowledge,
      lock,
      task.state === "completed",
    );
}
export function generationGroupSummary(groups: ChangeBatch[]) {
  return groups.map((g) => ({
    id: g.id,
    ordinal: g.groupOrdinal,
    revision: g.groupRevision,
    state: g.state,
    dependencies: g.dependencies,
    pages: g.items.map((i) => ({
      id: i.plannedPageId ?? i.pageId,
      title: i.title,
      type: i.metadata?.type,
    })),
    results: g.results,
  }));
}
export function hasGeneratedFields(items: ProposalItem[]) {
  return items.some(
    (i) =>
      i.plannedPageId !== undefined ||
      i.metadata !== undefined ||
      i.claimIds !== undefined ||
      i.questions !== undefined ||
      i.requiresResolution !== undefined,
  );
}
export function assertLatestGroup(batch: ChangeBatch, groups: ChangeBatch[]) {
  if (
    groups.find((g) => g.groupOrdinal === batch.groupOrdinal)?.id !== batch.id
  )
    throw new AccessError(
      409,
      "새로 수정한 검토 묶음이 있습니다. 최신 묶음에서 계속해 주세요.",
    );
}
export function revisionItems(
  previous: ChangeBatch,
  items: ProposalItem[],
  groups: ChangeBatch[],
) {
  if (items.length !== previous.items.length)
    throw new AccessError(
      409,
      "연결된 위키의 식별자를 유지해야 하므로 이 묶음의 페이지를 추가·삭제할 수 없습니다.",
    );
  const ids = items.map((i) => i.plannedPageId);
  if (new Set(ids).size !== items.length)
    throw new AccessError(400, "페이지 식별자가 중복되었습니다.");
  const otherTargets = new Set(
    groups
      .filter((g) => g.groupOrdinal !== previous.groupOrdinal)
      .flatMap((g) =>
        g.items.flatMap((i) => [
          ...(i.pageId ? [i.pageId] : []),
          ...i.mergedPages.map((m) => m.pageId),
          ...(i.plannedPageId ? [i.plannedPageId] : []),
        ]),
      ),
  );
  return items.map((item) => {
    const original = previous.items.find(
      (i) => i.plannedPageId === item.plannedPageId,
    );
    if (!original || original.pageId !== item.pageId)
      throw new AccessError(
        409,
        "자동 계획의 페이지 식별자와 대상은 유지해 주세요. 새 대상이 필요하면 새 생성 작업을 시작하세요.",
      );
    if (item.mergedPages.some((m) => otherTargets.has(m.pageId)))
      throw new AccessError(
        409,
        "다른 검토 묶음의 대상 위키를 병합할 수 없습니다.",
      );
    if (original.requiresResolution && item.requiresResolution === undefined)
      throw new AccessError(400, "모순·적용 조건의 확인 여부를 명시해 주세요.");
    const metadata = item.metadata ?? original.metadata ?? emptyWikiMetadata;
    const reasons = new Map(metadata.links.map((l) => [l.pageId, l.reason]));
    const links = wikiLinksFromMarkdown(item.body, previous.workspaceId)
      .filter((id) => id !== item.plannedPageId)
      .map((pageId) => ({
        pageId,
        reason: reasons.get(pageId) ?? "본문에서 연결한 위키",
      }));
    return {
      ...item,
      plannedPageId: original.plannedPageId,
      claimIds: original.claimIds,
      questions: item.questions ?? original.questions,
      metadata: wikiMetadataSchema.parse({ ...metadata, links }),
      requiresResolution:
        item.kind === "conflict" || item.requiresResolution === true,
    };
  });
}
export function groupDependencies(
  ordinal: number,
  items: ProposalItem[],
  groups: ChangeBatch[],
) {
  const byPage = new Map(
    groups.flatMap((g) =>
      g.items.flatMap((i) =>
        i.plannedPageId && g.groupOrdinal !== null
          ? [[i.plannedPageId, g.groupOrdinal] as const]
          : [],
      ),
    ),
  );
  const dependencies = [
    ...new Set(
      items.flatMap((i) =>
        (i.metadata?.links ?? []).flatMap((l) => {
          const group = byPage.get(l.pageId);
          return group !== undefined && group !== ordinal ? [group] : [];
        }),
      ),
    ),
  ].sort((a, b) => a - b);
  const edges = new Map(
    groups.flatMap((g) =>
      g.groupOrdinal === null
        ? []
        : [
            [
              g.groupOrdinal,
              g.groupOrdinal === ordinal ? dependencies : g.dependencies,
            ] as const,
          ],
    ),
  );
  const active = new Set<number>(),
    done = new Set<number>();
  const visit = (node: number) => {
    if (active.has(node))
      throw new AccessError(
        409,
        "검토 묶음 사이에 순환 참조가 생깁니다. 서로 기다리지 않도록 위키 링크의 방향을 조정해 주세요.",
      );
    if (done.has(node)) return;
    active.add(node);
    for (const next of edges.get(node) ?? []) visit(next);
    active.delete(node);
    done.add(node);
  };
  for (const node of edges.keys()) visit(node);
  return dependencies;
}
export async function checkGeneratedLinks(
  db: QueryDb,
  batch: Pick<
    ChangeBatch,
    | "workspaceId"
    | "domainId"
    | "projectId"
    | "groupOrdinal"
    | "items"
    | "dependencies"
  >,
  groups: ChangeBatch[],
  approve = false,
) {
  if (approve)
    for (const ordinal of batch.dependencies) {
      if (groups.find((g) => g.groupOrdinal === ordinal)?.state !== "approved")
        throw new AccessError(
          409,
          `먼저 ${ordinal}번 묶음을 승인해 주세요. 아직 공개되지 않은 위키를 참조하고 있습니다.`,
        );
    }
  const local = new Set(
    batch.items.flatMap((i) => (i.plannedPageId ? [i.plannedPageId] : [])),
  );
  const planned = new Set(
    groups.flatMap((g) =>
      g.items.flatMap((i) => (i.plannedPageId ? [i.plannedPageId] : [])),
    ),
  );
  const links = [
    ...new Set(
      batch.items.flatMap((i) => i.metadata?.links.map((l) => l.pageId) ?? []),
    ),
  ]
    .filter((id) => !local.has(id) && !(planned.has(id) && !approve))
    .sort();
  const merged = new Set(
    groups.flatMap((g) =>
      (g.groupOrdinal === batch.groupOrdinal ? batch.items : g.items).flatMap(
        (i) => i.mergedPages.map((p) => p.pageId),
      ),
    ),
  );
  if (links.some((id) => merged.has(id)))
    throw new AccessError(
      409,
      "병합으로 게시가 철회될 위키를 참조하고 있습니다. 남는 위키의 주소로 링크를 수정해 주세요.",
    );
  if (!links.length) return;
  const rows =
    await db.execute(sql`SELECT p.id FROM wiki_page p JOIN wiki_version v ON v.id=p.published_version_id
    WHERE p.id=ANY(${sql.param(links)}::uuid[]) AND p.workspace_id=${batch.workspaceId} AND p.domain_id=${batch.domainId}
    AND (p.project_id IS NOT DISTINCT FROM ${batch.projectId}::uuid OR p.project_id IS NULL) AND v.state='approved'
    AND EXISTS(SELECT 1 FROM wiki_evidence e WHERE e.version_id=v.id)
    AND NOT EXISTS(SELECT 1 FROM wiki_evidence e JOIN source_chunk c ON c.id=e.chunk_id WHERE e.version_id=v.id AND NOT source_is_current(c.version_id))
    ORDER BY p.id FOR SHARE OF p,v`);
  if (rows.rows.length !== links.length)
    throw new AccessError(
      409,
      "연결한 위키가 현재 공개되지 않았거나 다른 범위입니다. 근거와 링크를 다시 확인해 주세요.",
    );
}
