import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { analysisUnitContent, rebindUnitAnalysis } from "@/lib/analysis-cache";
import {
  ANALYSIS_SPLITTER_VERSION,
  type AnalysisUnit,
} from "@/lib/document-analysis";
import { getDb } from "@/server/db";
import { aiStep } from "@/server/db/schema";
import { hashValue, type taskSource } from "./task-context";
import type { TaskExecution } from "./task-execution";

export function analysisCacheKey(
  run: TaskExecution,
  source: Awaited<ReturnType<typeof taskSource>>,
  unit: AnalysisUnit,
) {
  return hashValue({
    version: "analysis-unit-cache-v1",
    workspaceId: run.task.workspaceId,
    sourceId: source.sourceId,
    title: source.title,
    category: source.category,
    parser: source.parserVersion,
    splitter: ANALYSIS_SPLITTER_VERSION,
    prompt: run.task.promptVersion,
    profile: run.task.profile,
    rules: run.task.rulesHash,
    unit: analysisUnitContent(unit),
  });
}
export async function reuseAnalysisUnit(
  run: TaskExecution,
  ordinal: number,
  unit: AnalysisUnit,
  key: string,
) {
  // An explicit standalone analysis still runs independently. Ingest is the
  // workflow that promises semantic caching, separate from request-ID replay.
  if (!run.task.ingestRunId) return null;
  return getDb().transaction(async (tx) => {
    await run.guard(tx);
    const [step] = await tx
      .select()
      .from(aiStep)
      .where(and(eq(aiStep.taskId, run.task.id), eq(aiStep.ordinal, ordinal)));
    if (!step || step.state === "completed") return null;
    const found =
      await tx.execute(sql`SELECT a.id,a.input,a.result,COALESCE(a.cache_origin_step_id,a.id) AS origin_id
      FROM ai_step a JOIN ai_task t ON t.id=a.task_id
      JOIN source_version v ON v.id=t.source_version_id
      JOIN source_version current_v ON current_v.id=${run.task.sourceVersionId}
      JOIN membership m ON m.workspace_id=t.workspace_id AND m.user_id=t.author_id
      JOIN ai_step root ON root.id=COALESCE(a.cache_origin_step_id,a.id)
      JOIN ai_task rt ON rt.id=root.task_id JOIN source_version rv ON rv.id=rt.source_version_id
      JOIN membership rm ON rm.workspace_id=rt.workspace_id AND rm.user_id=rt.author_id
      WHERE a.cache_key=${key} AND a.state='completed' AND a.kind='analyze'
        AND t.state='completed' AND t.workspace_id=${run.task.workspaceId} AND t.id<>${run.task.id}
        AND v.source_id=current_v.source_id AND v.publication IN ('published','superseded') AND v.processing='completed'
        AND rv.source_id=current_v.source_id AND rv.publication IN ('published','superseded') AND rv.processing='completed'
        AND root.state='completed' AND rt.state='completed'
        AND m.is_active AND (m.is_admin OR m.role IN ('writer','reviewer'))
        AND rm.is_active AND (rm.is_admin OR rm.role IN ('writer','reviewer'))
      ORDER BY a.created_at DESC LIMIT 10 FOR SHARE OF t,v,m,rt,rv,rm`);
    for (const previous of found.rows) {
      let result: ReturnType<typeof rebindUnitAnalysis>;
      try {
        result = rebindUnitAnalysis(
          previous.result,
          (previous.input as { unit: AnalysisUnit }).unit,
          unit,
        );
      } catch {
        continue; // Corrupt/obsolete cache is a miss, never a partially valid hit.
      }
      await tx
        .update(aiStep)
        .set({
          state: "completed",
          result,
          cacheKey: key,
          cacheOriginStepId: String(previous.origin_id),
          errorMessage: null,
        })
        .where(eq(aiStep.id, step.id));
      return result;
    }
    return null;
  });
}
