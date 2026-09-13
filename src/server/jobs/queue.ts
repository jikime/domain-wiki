import "server-only";
import { PgBoss } from "pg-boss";
import { getServerEnv } from "@/server/env";
export const AI_QUEUE = "ai-document";
export type AiJob = { workspaceId: string; taskId: string };
export const EXTRACT_QUEUE = "extract-source";
export type ExtractionJob = { workspaceId: string; versionId: string };
const globals = globalThis as unknown as { contentBoss?: Promise<PgBoss> };
export async function createBoss(worker = false) {
  const env = getServerEnv();
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    supervise: worker,
    schedule: false,
    superviseIntervalSeconds: 2,
    // Timeout recovery follows the monitor interval, not the supervisor timer.
    monitorIntervalSeconds: Math.min(15, env.JOB_LEASE_SECONDS),
  });
  boss.on("error", () =>
    console.error("문서 작업 큐 연결 오류가 발생했습니다."),
  );
  await boss.start();
  await boss.createQueue(EXTRACT_QUEUE, {
    retryLimit: 2,
    retryDelay: 2,
    expireInSeconds:
      process.env.MINERU_BACKEND && process.env.MINERU_BACKEND !== "disabled"
        ? Math.max(3660, env.JOB_LEASE_SECONDS)
        : env.JOB_LEASE_SECONDS,
    retentionSeconds: 7 * 86400,
  });
  await boss.createQueue(AI_QUEUE, {
    retryLimit: 0,
    expireInSeconds: 86400,
    heartbeatSeconds: env.AI_TASK_LEASE_SECONDS,
    retentionSeconds: 7 * 86400,
  });
  return boss;
}
export async function getBoss() {
  globals.contentBoss ??= createBoss().catch((error) => {
    globals.contentBoss = undefined;
    throw error;
  });
  return globals.contentBoss;
}
