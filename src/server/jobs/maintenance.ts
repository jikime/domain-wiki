import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb, getPool } from "@/server/db";
import { originalGc } from "@/server/db/schema";
import { originals } from "@/server/storage/originals";
export async function collectOriginals() {
  const rows = await getDb()
    .select()
    .from(originalGc)
    .where(sql`${originalGc.removedAt} IS NULL`)
    .orderBy(originalGc.attempts, originalGc.createdAt)
    .limit(20);
  for (const row of rows) {
    try {
      const used = await getPool().query(
        "SELECT 1 FROM source_version WHERE storage_key=$1 UNION ALL SELECT 1 FROM source_asset WHERE storage_key=$1 UNION ALL SELECT 1 FROM archive_file WHERE storage_key=$1 LIMIT 1",
        [row.storageKey],
      );
      if (used.rowCount) continue;
      await originals.remove(row.storageKey);
      await getDb()
        .update(originalGc)
        .set({ removedAt: new Date() })
        .where(eq(originalGc.storageKey, row.storageKey));
    } catch {
      await getDb()
        .update(originalGc)
        .set({ attempts: row.attempts + 1 })
        .where(eq(originalGc.storageKey, row.storageKey));
    }
  }
}

export async function reconcileAiRuns() {
  await getPool().query(
    "UPDATE official_candidate SET state='failed',error_message='수집 연결이 종료되었습니다. 새 요청으로 다시 시도하세요.',updated_at=now() WHERE state='fetching' AND created_at<now()-interval '2 minutes'",
  );
  await getPool().query(
    "UPDATE chat_run SET state='interrupted',error_message='연결이 종료되어 답변이 중단되었습니다.',updated_at=now() WHERE state='running' AND updated_at<now()-interval '30 seconds'",
  );
  await getPool().query(
    "UPDATE generation SET state='failed',error_message='작업 연결이 종료되었습니다. 새 요청으로 다시 시도하세요.',updated_at=now() WHERE state='running' AND task_id IS NULL AND (CASE WHEN kind IN ('wiki-quality','deep-research') THEN updated_at ELSE created_at END)<now()-interval '3 minutes'",
  );
}
