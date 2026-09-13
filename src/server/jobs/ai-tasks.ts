import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { fromDrizzle, type JobWithMetadata, type PgBoss } from "pg-boss";
import { executeDocumentTask } from "@/server/ai/document-tasks";
import { knowledgeSnapshot, verifyTask } from "@/server/ai/task-context";
import { TaskExecution } from "@/server/ai/task-execution";
import { executeWikiGeneration } from "@/server/ai/wiki-generation";
import { getDb } from "@/server/db";
import { aiStep, aiTask, generation } from "@/server/db/schema";
import { getServerEnv } from "@/server/env";
import { AccessError } from "@/server/errors";
import { checkAiCapacity } from "@/server/services/operations";
import { AI_QUEUE, type AiJob } from "./queue";

export async function reconcileAiTasks(boss: PgBoss) {
  const pending = await getDb()
    .select({ id: aiTask.id })
    .from(aiTask)
    .where(sql`${aiTask.state} IN ('waiting','queued','running')`)
    .orderBy(aiTask.updatedAt)
    .limit(100);
  for (const { id } of pending) {
    await getDb().transaction(async (tx) => {
      const [task] = await tx
        .select()
        .from(aiTask)
        .where(eq(aiTask.id, id))
        .for("update", { skipLocked: true });
      if (!task || !["waiting", "queued", "running"].includes(task.state))
        return;
      const stale =
        task.state === "running" &&
        (!task.heartbeatAt ||
          Date.now() - task.heartbeatAt.getTime() >
            getServerEnv().AI_TASK_LEASE_SECONDS * 1000);
      if (task.state === "running" && !stale) return;
      if (task.state === "queued" && task.activeJobId) {
        const job = await boss.getJobById(AI_QUEUE, task.activeJobId, {
          db: fromDrizzle(tx, sql),
        });
        if (job && ["created", "retry", "active"].includes(job.state)) return;
      }
      try {
        await verifyTask(tx, task, true);
      } catch (error) {
        if (!(error instanceof AccessError)) throw error;
        await tx
          .update(aiTask)
          .set({
            state: "failed",
            leaseToken: null,
            activeJobId: null,
            errorMessage: error.message,
          })
          .where(eq(aiTask.id, id));
        await tx
          .update(generation)
          .set({ state: "failed", errorMessage: error.message })
          .where(
            and(eq(generation.taskId, id), eq(generation.state, "running")),
          );
        return;
      }
      if (stale) {
        await tx
          .update(generation)
          .set({
            state: "failed",
            errorMessage: "작업자 연결 종료로 중단된 시도입니다.",
          })
          .where(
            and(eq(generation.taskId, id), eq(generation.state, "running")),
          );
        await tx
          .update(aiStep)
          .set({
            state: "pending",
            errorMessage: "작업자 재시작 후 이어서 처리합니다.",
          })
          .where(and(eq(aiStep.taskId, id), eq(aiStep.state, "running")));
        if (task.recoveries >= 3) {
          await tx
            .update(aiTask)
            .set({
              state: "failed",
              leaseToken: null,
              activeJobId: null,
              errorMessage:
                "작업자 연결이 반복해서 종료되었습니다. 연결 상태를 확인한 뒤 재시도하세요.",
            })
            .where(eq(aiTask.id, id));
          return;
        }
      }
      const profile = task.profile ?? knowledgeSnapshot();
      if (!profile) {
        await tx
          .update(aiTask)
          .set({
            state: "waiting",
            activeJobId: null,
            errorMessage: "지식 생성 모델 설정 대기",
          })
          .where(eq(aiTask.id, id));
        return;
      }
      // Sending and saving activeJobId share the task transaction: no orphan dispatch window.
      const jobId = await boss.send(
        AI_QUEUE,
        { taskId: id, workspaceId: task.workspaceId },
        { db: fromDrizzle(tx, sql) },
      );
      if (!jobId) throw new Error("AI 작업 등록 실패");
      await tx
        .update(aiTask)
        .set({
          state: "queued",
          profile,
          activeJobId: jobId,
          leaseToken: null,
          heartbeatAt: null,
          recoveries: task.recoveries + (stale ? 1 : 0),
          errorMessage: null,
        })
        .where(eq(aiTask.id, id));
    });
  }
}
export async function runAiTask(job: JobWithMetadata<AiJob>) {
  const token = randomUUID();
  const claimed = await getDb().transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(aiTask)
      .where(
        and(
          eq(aiTask.id, job.data.taskId),
          eq(aiTask.workspaceId, job.data.workspaceId),
          eq(aiTask.activeJobId, job.id),
          eq(aiTask.state, "queued"),
        ),
      )
      .for("update");
    if (!task) return null;
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${task.workspaceId},3))`,
    );
    try {
      await checkAiCapacity(tx, task.workspaceId);
    } catch (error) {
      if (!(error instanceof AccessError) || error.status !== 429) throw error;
      await tx
        .update(aiTask)
        .set({
          state: "waiting",
          activeJobId: null,
          errorMessage: "팀의 다른 AI 작업이 끝나기를 기다리고 있습니다.",
        })
        .where(eq(aiTask.id, task.id));
      return null;
    }
    const [claimed] = await tx
      .update(aiTask)
      .set({
        state: "running",
        leaseToken: token,
        heartbeatAt: new Date(),
        errorMessage: null,
      })
      .where(eq(aiTask.id, task.id))
      .returning();
    return claimed;
  });
  if (!claimed) return;
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    job.signal,
    AbortSignal.timeout(86400000),
  ]);
  let heartbeatBusy = false;
  const heartbeat = setInterval(
    async () => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      try {
        await verifyTask(getDb(), claimed);
        const updated = await getDb()
          .update(aiTask)
          .set({ heartbeatAt: new Date() })
          .where(
            and(
              eq(aiTask.id, claimed.id),
              eq(aiTask.leaseToken, token),
              eq(aiTask.state, "running"),
            ),
          )
          .returning({ id: aiTask.id });
        if (!updated.length) controller.abort();
      } catch {
        controller.abort();
      } finally {
        heartbeatBusy = false;
      }
    },
    Math.min(3000, (getServerEnv().AI_TASK_LEASE_SECONDS * 1000) / 3),
  );
  try {
    const execution = new TaskExecution(claimed, token, signal);
    const result =
      claimed.kind === "wiki-generation"
        ? await executeWikiGeneration(execution)
        : await executeDocumentTask(execution);
    await getDb().transaction(async (tx) => {
      await execution.guard(tx);
      await tx
        .update(aiTask)
        .set({
          state: "completed",
          leaseToken: null,
          activeJobId: null,
          result,
          errorMessage: null,
        })
        .where(eq(aiTask.id, claimed.id));
    });
  } catch (error) {
    const message =
      error instanceof AccessError
        ? error.message
        : signal.aborted
          ? "작업이 중단되었거나 모델 응답 제한 시간을 넘었습니다. 재시도하면 완료한 단계부터 이어갑니다."
          : "AI 작업을 완료하지 못했습니다. 재시도해 주세요.";
    await getDb().transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(aiTask)
        .where(
          and(
            eq(aiTask.id, claimed.id),
            eq(aiTask.leaseToken, token),
            eq(aiTask.state, "running"),
          ),
        )
        .for("update");
      if (!current) return;
      await tx
        .update(aiTask)
        .set({
          state: job.signal.aborted ? "waiting" : "failed",
          leaseToken: null,
          activeJobId: null,
          errorMessage: message,
        })
        .where(eq(aiTask.id, claimed.id));
      await tx
        .update(aiStep)
        .set({
          state: job.signal.aborted ? "pending" : "failed",
          errorMessage: message,
        })
        .where(and(eq(aiStep.taskId, claimed.id), eq(aiStep.state, "running")));
    });
  } finally {
    clearInterval(heartbeat);
  }
}
