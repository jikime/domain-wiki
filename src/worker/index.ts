import { loadEnvConfig } from "@next/env";
import type { AiJob, ExtractionJob } from "../server/jobs/queue";

loadEnvConfig(process.cwd());
async function main() {
  const { createBoss, EXTRACT_QUEUE, AI_QUEUE } = await import(
    "../server/jobs/queue"
  );
  const { extractJob, reconcileJobs } = await import("../server/jobs/extract");
  const { getPool } = await import("../server/db");
  const boss = await createBoss(true);
  const options = {
    batchSize: 1,
    includeMetadata: true,
    pollingIntervalSeconds: 1,
  } as const;
  await boss.work<ExtractionJob, void, typeof options>(
    EXTRACT_QUEUE,
    options,
    async (jobs) => {
      for (const job of jobs) await extractJob(job);
    },
  );
  const { runAiTask, reconcileAiTasks } = await import(
    "../server/jobs/ai-tasks"
  );
  const { reconcileIngest } = await import("../server/jobs/ingest");
  await boss.work<AiJob, void, typeof options>(
    AI_QUEUE,
    options,
    async (jobs) => {
      for (const job of jobs) await runAiTask(job);
    },
  );
  const { indexPublishedContent } = await import(
    "../server/ai/knowledge-index"
  );
  const { runNextQuality, scheduleQuality } = await import(
    "../server/jobs/quality"
  );
  let qualityRunning = false;
  const qualityInterval = setInterval(async () => {
    if (qualityRunning) return;
    qualityRunning = true;
    try {
      await runNextQuality();
    } catch {
      console.error("품질 점검 작업 상태를 확인하지 못했습니다.");
    } finally {
      qualityRunning = false;
    }
  }, 3000);
  let qualityScheduling = false;
  const qualityScheduleInterval = setInterval(async () => {
    if (qualityScheduling) return;
    qualityScheduling = true;
    try {
      await scheduleQuality();
    } catch {
      console.error("품질 점검 예약을 확인하지 못했습니다.");
    } finally {
      qualityScheduling = false;
    }
  }, 15000);
  const { runNextSourceImport } = await import("../server/jobs/source-imports");
  const { runNextResearch, reconcileResearch } = await import(
    "../server/jobs/research"
  );
  const researchAbort = new AbortController();
  const researchTasks = new Set<Promise<unknown>>();
  const researchInterval = setInterval(() => {
    for (let slot = researchTasks.size; slot < 3; slot++) {
      const work = runNextResearch(researchAbort.signal)
        .catch(() => {
          console.error("조사 작업 상태를 확인하지 못했습니다.");
        })
        .finally(() => researchTasks.delete(work));
      researchTasks.add(work);
    }
  }, 3000);
  let importing = false;
  const importInterval = setInterval(async () => {
    if (importing) return;
    importing = true;
    try {
      await runNextSourceImport();
    } catch {
      console.error("폴더 가져오기 상태를 확인하지 못했습니다.");
    } finally {
      importing = false;
    }
  }, 5000);
  let indexing = false;
  const indexInterval = setInterval(async () => {
    if (indexing) return;
    indexing = true;
    try {
      await indexPublishedContent();
    } catch {
      console.error("의미 검색 색인에 실패했습니다. 다음 주기에 재시도합니다.");
    } finally {
      indexing = false;
    }
  }, 10000);
  const { collectOriginals, reconcileAiRuns } = await import(
    "../server/jobs/maintenance"
  );
  let reconciling = false;
  const interval = setInterval(async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      await reconcileJobs(boss);
      await reconcileAiRuns();
      await reconcileResearch();
      await reconcileIngest();
      await reconcileAiTasks(boss);
      await collectOriginals();
    } catch {
      console.error("문서 작업 상태를 확인하지 못했습니다.");
    } finally {
      reconciling = false;
    }
  }, 3000);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(interval);
    clearInterval(indexInterval);
    clearInterval(importInterval);
    clearInterval(qualityInterval);
    clearInterval(qualityScheduleInterval);
    clearInterval(researchInterval);
    researchAbort.abort();
    await Promise.allSettled(researchTasks);
    await boss.stop({ graceful: true, timeout: 5000 });
    await getPool().end();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  console.log("문서 처리 작업자가 준비되었습니다.");
}
main().catch(() => {
  console.error(
    "문서 작업자 시작 실패: DB·환경 변수·마이그레이션을 확인하세요.",
  );
  process.exitCode = 1;
});
