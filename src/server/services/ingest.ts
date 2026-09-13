import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { IngestSummary } from "@/lib/ingest";
import { AccessError, requireWorkspace } from "@/server/access";
import { ingestBasis } from "@/server/ai/ingest-context";
import { getDb } from "@/server/db";
import { aiStep, domain, ingestRun, operationsEvent } from "@/server/db/schema";
import {
  lockIngestSource,
  retryIngest,
  startIngest,
  stopIngest,
} from "@/server/jobs/ingest";
import { mayManage, parseId, requireWriter } from "./content-access";
import { latestGenerationGroups } from "./generation-batches";
import { sourceRecord, versionRecord } from "./sources";

export async function createIngest(h: Headers, w: string, input: unknown) {
  const context = await requireWorkspace(h, w);
  requireWriter(context);
  const { sourceId } = z.object({ sourceId: z.uuid() }).strict().parse(input);
  await sourceRecord(context, sourceId);
  const result = await getDb().transaction((db) =>
    startIngest(
      db,
      w,
      sourceId,
      context.user.id,
      "manual",
      context.role === "reviewer",
    ),
  );
  return {
    id: result.run.id,
    state: result.run.state,
    replay: result.replay,
    manageable: mayManage(context, result.run.authorId),
  };
}
export async function listIngest(h: Headers, w: string, input: unknown) {
  const context = await requireWorkspace(h, w);
  requireWriter(context);
  const { sourceId, sourceVersionId } = z
    .object({ sourceId: z.uuid(), sourceVersionId: z.uuid().optional() })
    .parse(input);
  const source = await sourceRecord(context, sourceId);
  const selected = sourceVersionId ?? source.publishedVersionId;
  if (!selected) return { enabled: false, items: [] as IngestSummary[] };
  const version = await versionRecord(context, selected);
  if (version.source.id !== sourceId)
    throw new AccessError(404, "자료 버전을 찾을 수 없습니다.");
  const [settings] = await getDb()
    .select({ enabled: domain.autoIngest })
    .from(domain)
    .where(eq(domain.id, source.domainId));
  const rows = await getDb()
    .select()
    .from(ingestRun)
    .where(
      and(
        eq(ingestRun.workspaceId, w),
        eq(ingestRun.sourceId, sourceId),
        eq(ingestRun.sourceVersionId, selected),
      ),
    )
    .orderBy(desc(ingestRun.createdAt))
    .limit(20);
  const items: IngestSummary[] = [];
  for (const run of rows) {
    const manageable = mayManage(context, run.authorId);
    let current = !["outdated"].includes(run.state);
    if (current)
      try {
        current = (await ingestBasis(getDb(), run)).hash === run.basisHash;
      } catch (error) {
        if (!(error instanceof AccessError)) throw error;
        current = false;
      }
    const steps =
      manageable && current && run.analysisTaskId
        ? await getDb()
            .select({ reused: aiStep.cacheOriginStepId })
            .from(aiStep)
            .where(
              and(
                eq(aiStep.taskId, run.analysisTaskId),
                eq(aiStep.kind, "analyze"),
              ),
            )
        : [];
    const pages =
      manageable && current && run.generationTaskId
        ? await getDb()
            .select({ reused: aiStep.cacheOriginStepId })
            .from(aiStep)
            .where(
              and(
                eq(aiStep.taskId, run.generationTaskId),
                eq(aiStep.kind, "generate-wiki"),
              ),
            )
        : [];
    const groups =
      manageable &&
      current &&
      run.generationTaskId &&
      ["review", "completed"].includes(run.state)
        ? await latestGenerationGroups(getDb(), run.generationTaskId)
        : [];
    items.push({
      id: run.id,
      sourceVersionId: run.sourceVersionId,
      state: current ? run.state : "outdated",
      origin: run.origin,
      errorMessage: manageable ? run.errorMessage : null,
      reusedAnalysis: manageable && run.reusedAnalysis,
      reusedUnits: steps.filter((s) => s.reused).length,
      reusedPages: pages.filter((s) => s.reused).length,
      analysisTaskId: manageable && current ? run.analysisTaskId : null,
      generationTaskId: manageable && current ? run.generationTaskId : null,
      manageable,
      current,
      createdAt: run.createdAt.toISOString(),
      groups: groups.map((g) => ({
        id: g.id,
        ordinal: g.groupOrdinal,
        state: g.state,
      })),
    });
  }
  return { enabled: settings?.enabled ?? false, items };
}
export async function ingestAction(
  h: Headers,
  w: string,
  id: string,
  input: unknown,
) {
  const context = await requireWorkspace(h, w);
  requireWriter(context);
  parseId(id);
  const { action } = z
    .object({ action: z.enum(["cancel", "retry"]) })
    .strict()
    .parse(input);
  return getDb().transaction(async (db) => {
    const [initial] = await db
      .select()
      .from(ingestRun)
      .where(and(eq(ingestRun.workspaceId, w), eq(ingestRun.id, id)));
    if (!initial || !mayManage(context, initial.authorId))
      throw new AccessError(404, "정리 작업을 찾을 수 없습니다.");
    await lockIngestSource(db, w, initial.sourceId);
    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, id))
      .for("update");
    if (action === "retry") {
      await retryIngest(db, run);
      await db.insert(operationsEvent).values({
        workspaceId: w,
        actorId: context.user.id,
        action: "ingest-retry",
        counts: { runs: 1 },
        details: { runId: run.id, previousOrigin: run.origin },
      });
    } else {
      if (!["waiting", "analysis", "generation"].includes(run.state))
        throw new AccessError(409, "진행 중인 정리만 중지할 수 있습니다.");
      await stopIngest(db, run, "canceled", "직원이 자동 정리를 중지했습니다.");
    }
    return { id, action };
  });
}
