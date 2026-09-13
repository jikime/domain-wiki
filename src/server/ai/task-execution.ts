import "server-only";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { streamModel } from "@/server/ai/client";
import { hashValue, type Task, verifyTask } from "@/server/ai/task-context";
import { getDb } from "@/server/db";
import { aiStep, aiTask, generation } from "@/server/db/schema";
import { getServerEnv } from "@/server/env";
import { AccessError } from "@/server/errors";
import type { QueryDb } from "@/server/services/wiki";

export class TaskExecution {
  constructor(
    readonly task: Task,
    readonly token: string,
    readonly signal: AbortSignal,
  ) {}
  async guard(tx: QueryDb) {
    const [task] = await tx
      .select()
      .from(aiTask)
      .where(
        and(
          eq(aiTask.id, this.task.id),
          eq(aiTask.state, "running"),
          eq(aiTask.leaseToken, this.token),
        ),
      )
      .for("update");
    if (!task) throw new AccessError(409, "작업 실행 권한이 종료되었습니다.");
    await verifyTask(tx, this.task, true);
    this.signal.throwIfAborted();
  }
  async prepare(steps: Omit<typeof aiStep.$inferInsert, "taskId">[]) {
    await getDb().transaction(async (tx) => {
      await this.guard(tx);
      await tx
        .insert(aiStep)
        .values(steps.map((s) => ({ ...s, taskId: this.task.id })))
        .onConflictDoNothing();
      const existing = await tx
        .select()
        .from(aiStep)
        .where(eq(aiStep.taskId, this.task.id));
      if (
        steps.some((s) => {
          const old = existing.find((e) => e.ordinal === s.ordinal);
          return (
            !old ||
            old.kind !== s.kind ||
            !isDeepStrictEqual(old.input, s.input)
          );
        })
      )
        throw new AccessError(
          409,
          "저장한 분석 범위가 현재 분할 기준과 다릅니다. 새 작업을 시작하세요.",
        );
    });
  }
  async step(ordinal: number) {
    const [step] = await getDb()
      .select()
      .from(aiStep)
      .where(and(eq(aiStep.taskId, this.task.id), eq(aiStep.ordinal, ordinal)));
    if (!step) throw new Error("등록된 AI 단계 없음");
    return step;
  }
  async save(
    ordinal: number,
    result: Record<string, unknown>,
    cacheOriginStepId?: string,
  ) {
    await getDb().transaction(async (tx) => {
      await this.guard(tx);
      await tx
        .update(aiStep)
        .set({
          state: "completed",
          result,
          errorMessage: null,
          ...(cacheOriginStepId ? { cacheOriginStepId } : {}),
        })
        .where(
          and(eq(aiStep.taskId, this.task.id), eq(aiStep.ordinal, ordinal)),
        );
    });
    return result;
  }
  async model<T extends Record<string, unknown>>(
    ordinal: number,
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    validate: (value: unknown) => T,
  ): Promise<T> {
    const step = await this.step(ordinal);
    if (step.state === "completed") return validate(step.result);
    const attempt = await getDb().transaction(async (tx) => {
      await this.guard(tx);
      await tx
        .update(aiStep)
        .set({
          state: "running",
          result: null,
          attempts: sql`${aiStep.attempts}+1`,
          errorMessage: null,
        })
        .where(eq(aiStep.id, step.id));
      const [attempt] = await tx
        .insert(generation)
        .values({
          workspaceId: this.task.workspaceId,
          authorId: this.task.authorId,
          taskId: this.task.id,
          stepId: step.id,
          requestId: randomUUID(),
          inputHash: hashValue(messages),
          kind: `task-${step.kind}`,
          state: "running",
          model: this.task.profile?.model,
        })
        .returning();
      return attempt;
    });
    try {
      await verifyTask(getDb(), this.task);
      this.signal.throwIfAborted();
      const output = await streamModel(
        messages,
        async () => this.signal.throwIfAborted(),
        AbortSignal.any([
          this.signal,
          AbortSignal.timeout(getServerEnv().AI_TIMEOUT_SECONDS * 1000),
        ]),
        "knowledge",
      );
      await getDb()
        .update(generation)
        .set({
          inputTokens: output.inputTokens,
          outputTokens: output.outputTokens,
        })
        .where(eq(generation.id, attempt.id));
      let parsed: T;
      try {
        parsed = validate(
          JSON.parse(
            output.text
              .trim()
              .replace(/^```(?:json)?\s*\n/i, "")
              .replace(/\n```\s*$/, ""),
          ),
        );
      } catch (error) {
        await getDb()
          .transaction(async (tx) => {
            await this.guard(tx);
            await tx
              .update(aiStep)
              .set({
                result: {
                  rejected: true,
                  validationError:
                    error instanceof Error ? error.message : "구조화 결과 오류",
                  modelOutput: output.text,
                },
              })
              .where(eq(aiStep.id, step.id));
          })
          .catch(() => {
            /* A canceled or revoked lease must not retain a late model output. */
          });
        if (error instanceof AccessError) throw error;
        throw new AccessError(
          502,
          error instanceof Error &&
            error.name !== "ZodError" &&
            !(error instanceof SyntaxError)
            ? error.message
            : "완성된 구조화 분석을 받지 못했습니다. 다시 시도하세요.",
        );
      }
      await getDb().transaction(async (tx) => {
        await this.guard(tx);
        await tx
          .update(aiStep)
          .set({ state: "completed", result: parsed, errorMessage: null })
          .where(eq(aiStep.id, step.id));
        await tx
          .update(generation)
          .set({ state: "completed" })
          .where(eq(generation.id, attempt.id));
      });
      return parsed;
    } catch (error) {
      await getDb()
        .update(generation)
        .set({
          state: "failed",
          errorMessage:
            error instanceof AccessError
              ? error.message
              : "모델 호출이 중단되었습니다.",
        })
        .where(
          and(eq(generation.id, attempt.id), eq(generation.state, "running")),
        );
      throw error;
    }
  }
}
