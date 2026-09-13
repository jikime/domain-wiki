import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  type IngestRun,
  ingestBasis,
  ingestKnowledgeStamp,
  sameIngestKnowledge,
} from "@/server/ai/ingest-context";
import {
  generationAnalysis,
  hashValue,
  taskPromptVersion,
  verifyTask,
} from "@/server/ai/task-context";
import { getDb } from "@/server/db";
import {
  aiStep,
  aiTask,
  domain,
  generation,
  ingestRun,
  source,
} from "@/server/db/schema";
import { AccessError } from "@/server/errors";
import {
  checkGenerationContext,
  latestGenerationGroups,
} from "@/server/services/generation-batches";
import type { QueryDb } from "@/server/services/wiki";

type WriteDb = QueryDb & Pick<ReturnType<typeof getDb>, "insert" | "update">;

export async function lockIngestSource(
  db: QueryDb,
  workspaceId: string,
  sourceId: string,
) {
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${sourceId}`},12))`,
  );
}
export async function stopIngest(
  db: WriteDb,
  run: IngestRun,
  state: "failed" | "canceled" | "outdated",
  message: string,
) {
  // Completed generation tasks also coordinate with review approval. Taking
  // every owned task first makes invalidating a run atomic with that approval.
  await db
    .select({ id: aiTask.id })
    .from(aiTask)
    .where(eq(aiTask.ingestRunId, run.id))
    .orderBy(aiTask.id)
    .for("update");
  await db
    .update(ingestRun)
    .set({ state, errorMessage: message })
    .where(eq(ingestRun.id, run.id));
  const tasks = await db
    .update(aiTask)
    .set({
      state: "canceled",
      leaseToken: null,
      activeJobId: null,
      errorMessage: message,
    })
    .where(
      and(
        eq(aiTask.ingestRunId, run.id),
        sql`${aiTask.state} IN ('waiting','queued','running')`,
      ),
    )
    .returning({ id: aiTask.id });
  for (const task of tasks) {
    await db
      .update(aiStep)
      .set({ state: "pending", errorMessage: message })
      .where(and(eq(aiStep.taskId, task.id), eq(aiStep.state, "running")));
    await db
      .update(generation)
      .set({ state: "failed", errorMessage: message })
      .where(
        and(eq(generation.taskId, task.id), eq(generation.state, "running")),
      );
  }
}
export async function startIngest(
  db: WriteDb,
  workspaceId: string,
  sourceId: string,
  authorId: string,
  origin: "manual" | "automatic",
  manageOthers = false,
) {
  await lockIngestSource(db, workspaceId, sourceId);
  const [item] = await db
    .select()
    .from(source)
    .where(and(eq(source.id, sourceId), eq(source.workspaceId, workspaceId)));
  if (!item) throw new AccessError(404, "자료를 찾을 수 없습니다.");
  if (!item.publishedVersionId)
    throw new AccessError(
      409,
      "추출을 완료하고 공개 승인한 원문이 필요합니다.",
    );
  const fields = {
    workspaceId,
    authorId,
    sourceVersionId: item.publishedVersionId,
    domainId: item.domainId,
    projectId: item.projectId,
  };
  const basis = await ingestBasis(db, fields);
  const previous = await db
    .select()
    .from(ingestRun)
    .where(
      and(
        eq(ingestRun.workspaceId, workspaceId),
        eq(ingestRun.sourceId, sourceId),
      ),
    )
    .orderBy(desc(ingestRun.createdAt))
    .limit(50)
    .for("update");
  const active = await db
    .select()
    .from(ingestRun)
    .where(
      and(
        eq(ingestRun.workspaceId, workspaceId),
        eq(ingestRun.sourceId, sourceId),
        sql`${ingestRun.state} IN ('waiting','analysis','generation','review')`,
      ),
    )
    .for("update");
  for (const run of active)
    if (!previous.some((r) => r.id === run.id)) previous.push(run);
  // An automatic receipt remains after failure/cancel, so reconciliation cannot
  // create an endless retry loop. A changed source/configuration gets a new run.
  const [receipt] = await db
    .select()
    .from(ingestRun)
    .where(
      and(
        eq(ingestRun.workspaceId, workspaceId),
        eq(ingestRun.sourceId, sourceId),
        eq(ingestRun.basisHash, basis.hash),
      ),
    )
    .orderBy(desc(ingestRun.createdAt))
    .limit(1);
  if (origin === "automatic" && receipt) return { run: receipt, replay: true };
  const stamp = await ingestKnowledgeStamp(db, { ...fields, sourceId });
  for (const run of previous) {
    if (run.basisHash !== basis.hash) {
      if (["waiting", "analysis", "generation", "review"].includes(run.state))
        await stopIngest(
          db,
          run,
          "outdated",
          "원문 또는 정리 기준이 바뀌어 이전 작업을 종료했습니다.",
        );
      continue;
    }
    const same = await sameIngestKnowledge(db, run, stamp);
    if (same && run.state !== "outdated") {
      let valid = true;
      if (run.generationTaskId && ["review", "completed"].includes(run.state)) {
        const [task] = await db
          .select()
          .from(aiTask)
          .where(eq(aiTask.id, run.generationTaskId));
        try {
          if (!task) throw new AccessError(409, "생성 결과 없음");
          await checkGenerationContext(db, task);
        } catch (error) {
          if (!(error instanceof AccessError)) throw error;
          valid = false;
        }
      }
      if (valid) return { run, replay: true };
    }
    if (
      origin === "manual" &&
      !manageOthers &&
      run.authorId !== authorId &&
      ["waiting", "analysis", "generation", "review"].includes(run.state)
    )
      throw new AccessError(
        409,
        "다른 직원의 정리가 진행 중이거나 검토를 기다리고 있습니다. 해당 작성자 또는 검토 직원이 먼저 처리해 주세요.",
      );
    if (run.state !== "outdated")
      await stopIngest(
        db,
        run,
        "outdated",
        "관련 위키·근거가 바뀌어 최신 지식과 다시 비교합니다.",
      );
  }
  const [run] = await db
    .insert(ingestRun)
    .values({
      ...fields,
      sourceId,
      origin,
      basisHash: basis.hash,
      rulesHash: basis.source.rulesHash,
      profile: basis.profile,
      knowledgeStamp: stamp,
      errorMessage: basis.profile
        ? "정리 작업 배정 대기"
        : "지식 생성 모델 설정 대기",
    })
    .returning();
  return { run, replay: false };
}
async function createIngestTask(
  db: WriteDb,
  run: IngestRun,
  kind: "analysis" | "wiki-generation",
) {
  const id = randomUUID();
  const [task] = await db
    .insert(aiTask)
    .values({
      id,
      workspaceId: run.workspaceId,
      authorId: run.authorId,
      sourceVersionId: run.sourceVersionId,
      domainId: run.domainId,
      projectId: run.projectId,
      ingestRunId: run.id,
      kind,
      requestId: randomUUID(),
      analysisTaskId: kind === "wiki-generation" ? run.analysisTaskId : null,
      inputHash: hashValue({ run: run.id, kind }),
      rulesHash: run.rulesHash,
      promptVersion: taskPromptVersion(kind),
      profile: run.profile,
      state: "waiting",
      errorMessage: "정리 작업 배정 대기",
    })
    .returning();
  return task;
}
export async function advanceIngest(id: string) {
  return getDb().transaction(async (db) => {
    const [initial] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, id));
    if (!initial) return;
    await lockIngestSource(db, initial.workspaceId, initial.sourceId);
    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, id))
      .for("update");
    if (
      !run ||
      !["waiting", "analysis", "generation", "review"].includes(run.state)
    )
      return;
    try {
      const basis = await ingestBasis(db, run);
      if (run.origin === "automatic") {
        const [settings] = await db
          .select({ enabled: domain.autoIngest })
          .from(domain)
          .where(eq(domain.id, run.domainId));
        if (!settings?.enabled && run.state !== "review") {
          await stopIngest(
            db,
            run,
            "canceled",
            "도메인의 자동 정리가 꺼져 작업을 중지했습니다.",
          );
          return;
        }
      }
      if (!run.profile && basis.profile && !run.analysisTaskId) {
        await db
          .update(ingestRun)
          .set({
            profile: basis.profile,
            basisHash: basis.hash,
            rulesHash: basis.source.rulesHash,
          })
          .where(eq(ingestRun.id, id));
        run.profile = basis.profile;
        run.basisHash = basis.hash;
        run.rulesHash = basis.source.rulesHash;
      }
      if (basis.hash !== run.basisHash) {
        await stopIngest(
          db,
          run,
          "outdated",
          "원문·모델·도메인 기준이 바뀌었습니다. 현재 기준으로 다시 정리해 주세요.",
        );
        return;
      }
      if (!run.profile) return;
      if (!run.analysisTaskId) {
        const choices = await db
          .select()
          .from(aiTask)
          .where(
            and(
              eq(aiTask.workspaceId, run.workspaceId),
              eq(aiTask.sourceVersionId, run.sourceVersionId),
              eq(aiTask.kind, "analysis"),
              eq(aiTask.authorId, run.authorId),
              eq(aiTask.state, "completed"),
            ),
          )
          .orderBy(desc(aiTask.createdAt))
          .limit(20);
        let reused: (typeof choices)[number] | undefined;
        for (const candidate of choices) {
          try {
            const [prepared] = await db
              .select({ result: aiStep.result })
              .from(aiStep)
              .where(
                and(
                  eq(aiStep.taskId, candidate.id),
                  eq(aiStep.kind, "prepare"),
                ),
              );
            if (
              prepared?.result?.sourceHash !== basis.source.sourceHash ||
              prepared?.result?.parserVersion !== basis.source.parserVersion
            )
              continue;
            await generationAnalysis(db, {
              ...run,
              analysisTaskId: candidate.id,
            });
            reused = candidate;
            break;
          } catch (error) {
            if (!(error instanceof AccessError)) throw error;
          }
        }
        const task = reused ?? (await createIngestTask(db, run, "analysis"));
        await db
          .update(ingestRun)
          .set({
            analysisTaskId: task.id,
            reusedAnalysis: !!reused,
            state: "analysis",
            errorMessage: null,
          })
          .where(eq(ingestRun.id, id));
        return;
      }
      const taskId = run.generationTaskId ?? run.analysisTaskId;
      const [task] = await db
        .select()
        .from(aiTask)
        .where(eq(aiTask.id, taskId));
      if (!task)
        throw new AccessError(409, "연결된 정리 작업을 찾을 수 없습니다.");
      if (["failed", "canceled"].includes(task.state)) {
        await stopIngest(
          db,
          run,
          task.state === "canceled" ? "canceled" : "failed",
          task.errorMessage ?? "정리 작업이 중단되었습니다.",
        );
        return;
      }
      if (task.state !== "completed") return;
      if (!run.generationTaskId) {
        await generationAnalysis(db, run);
        const next = await createIngestTask(db, run, "wiki-generation");
        await db
          .update(ingestRun)
          .set({
            generationTaskId: next.id,
            state: "generation",
            errorMessage: null,
          })
          .where(eq(ingestRun.id, id));
        return;
      }
      await checkGenerationContext(db, task);
      const [prepared] = await db
        .select({ result: aiStep.result })
        .from(aiStep)
        .where(
          and(
            eq(aiStep.taskId, task.id),
            eq(aiStep.kind, "generation-prepare"),
          ),
        );
      if (run.state === "generation" && prepared?.result?.knowledgeStamp)
        await db
          .update(ingestRun)
          .set({
            knowledgeStamp: prepared.result
              .knowledgeStamp as IngestRun["knowledgeStamp"],
          })
          .where(eq(ingestRun.id, id));
      const groups = await latestGenerationGroups(db, task.id);
      if (!groups.length)
        throw new AccessError(409, "생성된 검토 묶음이 없습니다.");
      const state = groups.every((g) => g.state === "approved")
        ? "completed"
        : "review";
      if (run.state !== state)
        await db
          .update(ingestRun)
          .set({ state, errorMessage: null })
          .where(eq(ingestRun.id, id));
    } catch (error) {
      if (!(error instanceof AccessError)) throw error;
      await stopIngest(db, run, "outdated", error.message);
    }
  });
}
let discoveryCursor: string | null = null;
let pendingCursor: string | null = null;
export async function reconcileIngest() {
  // This cursor only spreads scanning cost; all outcomes and retry receipts are
  // durable DB rows. Multiple/restarted workers use the same source lock.
  const eligible =
    await getDb().execute(sql`SELECT s.id,s.workspace_id,v.uploaded_by FROM source s
    JOIN source_version v ON v.id=s.published_version_id JOIN domain d ON d.id=s.domain_id
    JOIN membership m ON m.workspace_id=s.workspace_id AND m.user_id=v.uploaded_by
    WHERE d.auto_ingest AND source_is_current(v.id) AND m.is_active AND (m.is_admin OR m.role IN ('writer','reviewer'))
      ${discoveryCursor ? sql`AND s.id>${discoveryCursor}::uuid` : sql``} ORDER BY s.id LIMIT 50`);
  for (const row of eligible.rows) {
    try {
      await getDb().transaction((db) =>
        startIngest(
          db,
          String(row.workspace_id),
          String(row.id),
          String(row.uploaded_by),
          "automatic",
        ),
      );
    } catch (error) {
      if (!(error instanceof AccessError)) throw error;
    }
  }
  discoveryCursor =
    eligible.rows.length === 50 ? String(eligible.rows.at(-1)?.id) : null;
  const pending = await getDb()
    .select({ id: ingestRun.id })
    .from(ingestRun)
    .where(
      and(
        sql`${ingestRun.state} IN ('waiting','analysis','generation','review')`,
        pendingCursor ? sql`${ingestRun.id}>${pendingCursor}::uuid` : undefined,
      ),
    )
    .orderBy(ingestRun.id)
    .limit(100);
  for (const run of pending) await advanceIngest(run.id);
  pendingCursor = pending.length === 100 ? (pending.at(-1)?.id ?? null) : null;
}
export async function retryIngest(db: WriteDb, run: IngestRun) {
  if (!["failed", "canceled"].includes(run.state))
    throw new AccessError(
      409,
      "실패하거나 취소한 정리만 재시도할 수 있습니다.",
    );
  const basis = await ingestBasis(db, run);
  if (
    basis.hash !== run.basisHash ||
    !(await sameIngestKnowledge(db, run, await ingestKnowledgeStamp(db, run)))
  )
    throw new AccessError(
      409,
      "원문·설정·관련 지식이 바뀌었습니다. 현재 자료로 새 정리를 실행하세요.",
    );
  await db
    .update(ingestRun)
    .set({
      origin: "manual",
      state: run.generationTaskId
        ? "generation"
        : run.analysisTaskId
          ? "analysis"
          : "waiting",
      errorMessage: null,
    })
    .where(eq(ingestRun.id, run.id));
  const tasks = await db
    .select()
    .from(aiTask)
    .where(
      and(
        eq(aiTask.ingestRunId, run.id),
        sql`${aiTask.state} IN ('failed','canceled')`,
      ),
    )
    .for("update");
  for (const task of tasks) {
    await verifyTask(db, task, true);
    await db
      .update(aiTask)
      .set({
        state: "waiting",
        leaseToken: null,
        activeJobId: null,
        recoveries: 0,
        errorMessage: "자동 정리 재시도 대기",
      })
      .where(eq(aiTask.id, task.id));
    await db
      .update(aiStep)
      .set({ state: "pending", errorMessage: null })
      .where(
        and(eq(aiStep.taskId, task.id), sql`${aiStep.state}<>'completed'`),
      );
  }
}
