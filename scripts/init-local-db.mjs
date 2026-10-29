import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
const port = Number(process.env.DB_PORT || 55433);
const pool = new pg.Pool({
  host: "127.0.0.1",
  port,
  user: "postgres",
  password: process.env.POSTGRES_PASSWORD,
  database: "postgres",
  connectionTimeoutMillis: 5000,
});
let stage = "환경 설정 확인";
try {
  if (!process.env.POSTGRES_PASSWORD || !process.env.APP_DB_PASSWORD)
    throw Object.assign(new Error(), { code: "LOCAL_DB_PASSWORD_MISSING" });
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Object.assign(new Error(), { code: "LOCAL_DB_PORT_INVALID" });
  stage = "관리자 연결·앱 계정 확인";
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
    stage = `${name} 데이터베이스 준비`;
    const exists = await pool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [name],
    );
    if (!exists.rowCount)
      await pool.query(`CREATE DATABASE ${name} OWNER domain_wiki`);
  }
  for (const name of ["domain_wiki", "domain_wiki_test"]) {
    stage = `${name} pgvector 준비`;
    const extensionPool = new pg.Pool({
      host: "127.0.0.1",
      port,
      user: "postgres",
      password: process.env.POSTGRES_PASSWORD,
      database: name,
      connectionTimeoutMillis: 5000,
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
} catch (error) {
  const code = /^[A-Z0-9_]{2,40}$/.test(error.code ?? "")
    ? error.code
    : "UNKNOWN";
  console.error(`로컬 DB 초기화 실패 [${code}] · ${stage}`);
  const guidance = {
    "28P01":
      "DB 비밀번호 인증에 실패했습니다. .env.local의 POSTGRES_PASSWORD와 기존 DB의 관리자 비밀번호를 확인하세요. 컨테이너가 Healthy여도 비밀번호 인증은 실패할 수 있습니다.",
    ECONNREFUSED:
      "127.0.0.1의 DB에 연결할 수 없습니다. Docker Desktop·전용 DB 컨테이너의 실행 상태와 DB_PORT를 확인하세요.",
    ETIMEDOUT:
      "DB 연결 응답이 없습니다. 전용 DB 컨테이너의 상태와 DB_PORT를 확인하세요.",
    42501:
      "DB 계정의 권한이 부족합니다. 전용 로컬 DB의 postgres 관리자 계정으로 연결하는지 확인하세요.",
    "0A000":
      "필요한 DB 기능을 사용할 수 없습니다. 전용 DB가 pgvector를 포함한 이미지로 실행되는지 확인하세요.",
    LOCAL_DB_PASSWORD_MISSING:
      ".env.local에 POSTGRES_PASSWORD와 APP_DB_PASSWORD가 모두 필요합니다. 기존 DB를 사용한다면 처음 설정한 비밀번호를 복원하세요.",
    LOCAL_DB_PORT_INVALID:
      ".env.local의 DB_PORT는 1~65535 사이의 정수여야 합니다.",
  };
  console.error(
    guidance[code] ??
      "위 단계와 오류 코드를 기준으로 DB 로그·연결 설정을 확인하세요. 비밀번호와 접속 문자열은 공유하지 마세요.",
  );
  if (code === "28P01")
    console.error(
      "기존 데이터가 있다면 DB 볼륨을 삭제하지 마세요. 원래 설정을 복원하거나 기존 DB 계정의 비밀번호를 현재 설정과 맞춰야 합니다.",
    );
  process.exitCode = 1;
} finally {
  await pool.end();
}
