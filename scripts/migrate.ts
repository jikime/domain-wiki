import { loadEnvConfig } from "@next/env";
import { migrate } from "drizzle-orm/node-postgres/migrator";

loadEnvConfig(process.cwd());
async function main() {
  const { getDb, getPool } = await import("../src/server/db");
  try {
    await migrate(getDb(), { migrationsFolder: "./drizzle" });
    console.log("DB 마이그레이션 완료");
  } finally {
    await getPool().end();
  }
}
main().catch(() => {
  console.error("마이그레이션 실패: 환경 변수와 DB 상태를 확인하세요.");
  process.exitCode = 1;
});
