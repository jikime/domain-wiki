import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AccessError, requireWorkspace } from "@/server/access";
import {
  generationAnalysis,
  hashValue,
  knowledgeSnapshot,
  taskPromptVersion,
  taskSource,
  verifyIngestTask,
  verifyPreparedSource,
  verifyTask,
} from "@/server/ai/task-context";
import { getDb } from "@/server/db";
import {
  aiStep,
  aiTask,
  generation,
  source,
  sourceVersion,
} from "@/server/db/schema";
import { AI_QUEUE, getBoss } from "@/server/jobs/queue";
import { parseId, requireWriter } from "./content-access";
import {
  checkGenerationContext,
  generationGroupSummary,
  latestGenerationGroups,
} from "./generation-batches";

const inputSchema = z
  .object({
    requestId: z.uuid(),
    sourceId: z.uuid(),
    kind: z.enum(["summary", "analysis", "wiki-generation"]).default("summary"),
    analysisTaskId: z.uuid().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if ((data.kind === "wiki-generation") !== !!data.analysisTaskId)
      ctx.addIssue({
        code: "custom",
        message: "위키 생성은 완료된 전체 분석을 선택해 주세요.",
      });
  });
export async function createAiTask(h: Headers, w: string, input: unknown) {
  const context = await requireWorkspace(h, w);
  requireWriter(context);
  const data = inputSchema.parse(input);
  const inputHash = hashValue(data);
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${w}:${context.user.id}:${data.requestId}`}, 9))`,
    );
    const [existing] = await tx
      .select()
      .from(aiTask)
      .where(
        and(
          eq(aiTask.workspaceId, w),
          eq(aiTask.authorId, context.user.id),
          eq(aiTask.requestId, data.requestId),
        ),
      );
    if (existing) {
      if (existing.inputHash !== inputHash)
        throw new AccessError(
          409,
          "같은 요청 번호에 다른 내용을 사용할 수 없습니다.",
        );
      return { id: existing.id, state: existing.state, replay: true };
    }
    const [item] = await tx
      .select()
      .from(source)
      .where(and(eq(source.id, data.sourceId), eq(source.workspaceId, w)));
    if (!item) throw new AccessError(404, "자료를 찾을 수 없습니다.");
    if (!item.publishedVersionId)
      throw new AccessError(409, "현재 공개 승인을 받은 원문이 필요합니다.");
    const fields = {
      workspaceId: w,
      authorId: context.user.id,
      sourceVersionId: item.publishedVersionId,
      domainId: item.domainId,
      projectId: item.projectId,
    };
    const current = await taskSource(tx, fields, true);
    const profile = knowledgeSnapshot();
    if (data.kind === "wiki-generation") {
      const [analysis] = await tx
        .select({ id: aiTask.id })
        .from(aiTask)
        .where(
          and(
            eq(aiTask.id, data.analysisTaskId ?? ""),
            eq(aiTask.workspaceId, w),
            context.role === "reviewer"
              ? undefined
              : eq(aiTask.authorId, context.user.id),
          ),
        );
      if (!analysis)
        throw new AccessError(404, "전체 분석을 찾을 수 없습니다.");
      await generationAnalysis(tx, {
        ...fields,
        analysisTaskId: analysis.id,
        rulesHash: current.rulesHash,
        profile,
      });
    }
    const [task] = await tx
      .insert(aiTask)
      .values({
        ...fields,
        kind: data.kind,
        analysisTaskId: data.analysisTaskId ?? null,
        requestId: data.requestId,
        inputHash,
        rulesHash: current.rulesHash,
        promptVersion: taskPromptVersion(data.kind),
        profile,
        state: "waiting",
        errorMessage: profile ? "작업자 배정 대기" : "지식 생성 모델 설정 대기",
      })
      .returning();
    // DB row is the durable outbox. Reconciliation also dispatches rows left by a web/queue outage.
    return { id: task.id, state: task.state, replay: false };
  });
}
export async function aiTaskDetails(h: Headers, w: string, id: string) {
  const context = await requireWorkspace(h, w);
  requireWriter(context);
  parseId(id);
  const [task] = await getDb()
    .select()
    .from(aiTask)
    .where(
      and(
        eq(aiTask.id, id),
        eq(aiTask.workspaceId, w),
        context.role === "reviewer"
          ? undefined
          : eq(aiTask.authorId, context.user.id),
      ),
    );
  if (!task) throw new AccessError(404, "AI 작업을 찾을 수 없습니다.");
  const [version] = await getDb()
    .select({ sourceId: sourceVersion.sourceId })
    .from(sourceVersion)
    .where(eq(sourceVersion.id, task.sourceVersionId));
  let current = true,
    unavailableReason = "";
  try {
    await verifyIngestTask(getDb(), task);
    await verifyPreparedSource(getDb(), task, await taskSource(getDb(), task));
    if (task.kind === "wiki-generation")
      await checkGenerationContext(getDb(), task);
  } catch (error) {
    if (!(error instanceof AccessError)) throw error;
    current = false;
    unavailableReason = error.message;
  }
  const steps = await getDb()
    .select()
    .from(aiStep)
    .where(eq(aiStep.taskId, id))
    .orderBy(aiStep.ordinal);
  const usage = await getDb()
    .select({
      inputTokens: generation.inputTokens,
      outputTokens: generation.outputTokens,
      state: generation.state,
      model: generation.model,
    })
    .from(generation)
    .where(eq(generation.taskId, id));
  return {
    id: task.id,
    sourceId: version.sourceId,
    sourceVersionId: task.sourceVersionId,
    kind: task.kind,
    analysisTaskId: task.analysisTaskId,
    ingestRunId: task.ingestRunId,
    groups:
      current && task.kind === "wiki-generation"
        ? generationGroupSummary(await latestGenerationGroups(getDb(), task.id))
        : [],
    unavailableReason,
    state: task.state,
    model: task.profile?.model ?? null,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    heartbeatAt: task.heartbeatAt,
    recoveries: task.recoveries,
    current,
    result: current ? task.result : null,
    steps: steps.map((s) => ({
      id: s.id,
      ordinal: s.ordinal,
      kind: s.kind,
      state: s.state,
      attempts: s.attempts,
      reused: !!s.cacheOriginStepId,
      errorMessage: s.errorMessage,
      input: current ? s.input : null,
      result: current ? s.result : null,
    })),
    usage,
  };
}
export async function listAiTasks(h: Headers, w: string, query: unknown) {
  const context = await requireWorkspace(h, w);
  requireWriter(context);
  const data = z.object({ sourceVersionId: z.uuid() }).parse(query);
  return getDb()
    .select({
      id: aiTask.id,
      state: aiTask.state,
      kind: aiTask.kind,
      createdAt: aiTask.createdAt,
    })
    .from(aiTask)
    .where(
      and(
        eq(aiTask.workspaceId, w),
        eq(aiTask.sourceVersionId, data.sourceVersionId),
        context.role === "reviewer"
          ? undefined
          : eq(aiTask.authorId, context.user.id),
      ),
    )
    .orderBy(desc(aiTask.createdAt))
    .limit(30);
}
export async function aiTaskAction(
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
  const outcome = await getDb().transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(aiTask)
      .where(
        and(
          eq(aiTask.id, id),
          eq(aiTask.workspaceId, w),
          context.role === "reviewer"
            ? undefined
            : eq(aiTask.authorId, context.user.id),
        ),
      )
      .for("update");
    if (!task) throw new AccessError(404, "AI 작업을 찾을 수 없습니다.");
    if (action === "cancel") {
      if (!["waiting", "queued", "running"].includes(task.state))
        throw new AccessError(409, "진행 중인 작업만 취소할 수 있습니다.");
      await tx
        .update(aiTask)
        .set({
          state: "canceled",
          leaseToken: null,
          activeJobId: null,
          errorMessage: "직원이 작업을 취소했습니다.",
        })
        .where(eq(aiTask.id, id));
      await tx
        .update(aiStep)
        .set({ state: "pending", errorMessage: "작업 취소" })
        .where(and(eq(aiStep.taskId, id), eq(aiStep.state, "running")));
      await tx
        .update(generation)
        .set({ state: "failed", errorMessage: "작업 취소" })
        .where(and(eq(generation.taskId, id), eq(generation.state, "running")));
    } else {
      if (task.ingestRunId)
        throw new AccessError(
          409,
          "연결된 분석·생성을 함께 재개하도록 자료 상세의 자동 정리에서 재시도해 주세요.",
        );
      if (!["failed", "canceled"].includes(task.state))
        throw new AccessError(
          409,
          "실패하거나 취소한 작업만 재시도할 수 있습니다.",
        );
      await verifyTask(tx, task, true);
      await tx
        .update(aiTask)
        .set({
          state: "waiting",
          leaseToken: null,
          activeJobId: null,
          errorMessage: "재시도 배정 대기",
          recoveries: 0,
        })
        .where(eq(aiTask.id, id));
      await tx
        .update(aiStep)
        .set({ state: "pending", errorMessage: null })
        .where(and(eq(aiStep.taskId, id), sql`${aiStep.state}<>'completed'`));
    }
    return {
      jobId: task.activeJobId,
      state: action === "cancel" ? "canceled" : "waiting",
    };
  });
  if (outcome.jobId) {
    try {
      await (await getBoss()).cancel(AI_QUEUE, outcome.jobId);
    } catch {
      /* Fencing + heartbeat still prevent canceled workers from committing. */
    }
  }
  return { id, state: outcome.state };
}
