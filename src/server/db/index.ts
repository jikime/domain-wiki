import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getServerEnv } from "@/server/env";
import * as schema from "./schema";

const globalDb = globalThis as unknown as { wikiPool?: Pool };
export function getPool() {
  if (!globalDb.wikiPool) {
    globalDb.wikiPool = new Pool({
      connectionString: getServerEnv().DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
    });
    globalDb.wikiPool.on("error", () =>
      console.error("유휴 DB 연결 오류가 발생했습니다."),
    );
  }
  return globalDb.wikiPool;
}
export function getDb() {
  return drizzle(getPool(), { schema });
}
