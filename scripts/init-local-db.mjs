import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
const pool = new pg.Pool({
  host: "127.0.0.1",
  port: Number(process.env.DB_PORT || 55433),
  user: "postgres",
  password: process.env.POSTGRES_PASSWORD,
  database: "postgres",
});
try {
  if (!process.env.APP_DB_PASSWORD) throw new Error("APP_DB_PASSWORD 필요");
  const role = await pool.query(
    "SELECT 1 FROM pg_roles WHERE rolname = 'domain_wiki'",
  );
  if (!role.rowCount) {
    const { rows } = await pool.query(
      "SELECT format('CREATE ROLE domain_wiki LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', $1::text) AS statement",
      [process.env.APP_DB_PASSWORD],
    );
    await pool.query(rows[0].statement);
  }
  for (const name of ["domain_wiki", "domain_wiki_test"]) {
    const exists = await pool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [name],
    );
    if (!exists.rowCount)
      await pool.query(`CREATE DATABASE ${name} OWNER domain_wiki`);
  }
  for (const name of ["domain_wiki", "domain_wiki_test"]) {
    const extensionPool = new pg.Pool({
      host: "127.0.0.1",
      port: Number(process.env.DB_PORT ?? 55433),
      user: "postgres",
      password: process.env.POSTGRES_PASSWORD,
      database: name,
    });
    try {
      await extensionPool.query("CREATE EXTENSION IF NOT EXISTS vector");
    } finally {
      await extensionPool.end();
    }
  }
  console.log(
    "로컬 DB·pgvector와 일반 접속 계정 준비 완료. 기존 데이터는 유지합니다.",
  );
} catch {
  console.error(
    "로컬 DB 초기화 실패. 전용 컨테이너와 .env.local 설정을 확인하세요.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
