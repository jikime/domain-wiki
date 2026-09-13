import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import nextEnv from "@next/env";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
const target = process.env.TEST_DATABASE_URL;
const url = target ? new URL(target) : undefined;
if (
  !url ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname !== "/domain_wiki_test" ||
  target === process.env.DATABASE_URL
) {
  throw new Error(
    "별도의 로컬 domain_wiki_test DB가 필요합니다. 개발 DB에서는 시험을 실행하지 않습니다.",
  );
}
const testEnv = {
  ...process.env,
  TZ: "UTC",
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require=./scripts/preload-official-tests.cjs`,
  DATABASE_URL: target,
  BETTER_AUTH_URL: "http://localhost:3101",
  AI_BASE_URL: "http://127.0.0.1:3102/v1",
  AI_EMBEDDING_MODEL: "test-embedding",
  AI_EMBEDDING_BASE_URL: "",
  AI_EMBEDDING_API_KEY: "",
  AI_MODEL: "test-model",
  AI_CHAT_MODEL: "",
  AI_CHAT_BASE_URL: "",
  AI_CHAT_API_KEY: "",
  AI_KNOWLEDGE_MODEL: "test-knowledge",
  AI_KNOWLEDGE_BASE_URL: "",
  AI_KNOWLEDGE_API_KEY: "",
  AI_CHAT_CONTEXT_CHARS: "120000",
  AI_KNOWLEDGE_CONTEXT_CHARS: "48000",
  AI_TASK_LEASE_SECONDS: "10",
  ORIGINALS_DIR: ".local/test-originals",
  JOB_LEASE_SECONDS: "5",
  AI_API_KEY: `test-only-${randomBytes(24).toString("hex")}`,
};
const migration = spawnSync(
  process.execPath,
  ["--conditions=react-server", "--import", "tsx", "scripts/migrate.ts"],
  { env: testEnv, stdio: "inherit" },
);
if (migration.status !== 0) process.exit(migration.status ?? 1);
const mock = spawn(process.execPath, ["scripts/mock-model.mjs"], {
  env: testEnv,
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve, reject) => {
  mock.stdout.once("data", resolve);
  mock.once("error", reject);
  mock.once("exit", () => reject(new Error("시험 모델 서버 시작 실패")));
});
const pool = new pg.Pool({ connectionString: target, max: 1 });
const workspaceId = randomUUID();
const outsiderWorkspaceId = randomUUID();
const domainId = randomUUID();
const outsiderDomainId = randomUUID();
const accounts = [];
const marker = randomBytes(6).toString("hex");
try {
  await pool.query("BEGIN");
  await pool.query(
    "INSERT INTO workspace (id, name) VALUES ($1, $2), ($3, $4)",
    [workspaceId, "통합시험 공간", outsiderWorkspaceId, "다른 시험 공간"],
  );
  for (const role of ["admin", "reader", "writer", "reviewer", "outsider"]) {
    const id = randomUUID();
    const password = randomBytes(18).toString("base64url");
    const email = `${role}-${marker}@test.invalid`;
    accounts.push({ id, email, password, role });
    await pool.query(
      "INSERT INTO app_user (id, name, email) VALUES ($1,$2,$3)",
      [id, `${role} 시험 직원`, email],
    );
    await pool.query(
      "INSERT INTO auth_account (id, account_id, provider_id, user_id, password) VALUES ($1,$2,'credential',$2,$3)",
      [randomUUID(), id, await hashPassword(password)],
    );
    await pool.query(
      "INSERT INTO membership (workspace_id,user_id,role,is_admin) VALUES ($1,$2,$3,$4)",
      [
        role === "outsider" ? outsiderWorkspaceId : workspaceId,
        id,
        ["writer", "reviewer"].includes(role) ? role : "reader",
        role === "admin",
      ],
    );
  }
  await pool.query(
    "INSERT INTO domain (id, workspace_id, name, purpose) VALUES ($1,$2,'시험 도메인','개발 시험'), ($3,$4,'다른 도메인','다른 공간의 정보')",
    [domainId, workspaceId, outsiderDomainId, outsiderWorkspaceId],
  );
  await pool.query("COMMIT");
  mkdirSync(".local", { recursive: true, mode: 0o700 });
  writeFileSync(
    ".local/test-accounts.json",
    JSON.stringify({
      workspaceId,
      outsiderWorkspaceId,
      domainId,
      outsiderDomainId,
      accounts,
    }),
    { mode: 0o600 },
  );
  testEnv.RESEARCH_SEARCH_PROVIDERS = JSON.stringify([
    {
      provider: "searxng",
      baseUrl: "http://127.0.0.1:3102/research",
      workspaceIds: [workspaceId],
    },
  ]);
  testEnv.SOURCE_IMPORT_ROOTS = JSON.stringify([
    {
      key: "fixture",
      label: "시험 공유 폴더",
      path: resolve(`.local/test-watch/${workspaceId}`),
      workspaceId,
    },
  ]);
  mkdirSync(`.local/test-watch/${workspaceId}`, { recursive: true });
  const result = spawnSync(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
    { env: testEnv, stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
} catch {
  await pool.query("ROLLBACK");
  console.error("통합시험 준비 또는 실행에 실패했습니다.");
  process.exitCode = 1;
} finally {
  mock.kill("SIGTERM");
  if (
    (await pool.query("SELECT to_regclass('pgboss.job') AS jobs")).rows[0].jobs
  )
    await pool.query(
      "DELETE FROM pgboss.job WHERE data->>'workspaceId' = ANY($1::text[])",
      [[workspaceId, outsiderWorkspaceId]],
    );
  // This runner creates these IDs itself; only its own test fixtures are removed.
  await pool.query("DELETE FROM workspace WHERE id = ANY($1::uuid[])", [
    [workspaceId, outsiderWorkspaceId],
  ]);
  for (const item of accounts)
    await pool.query("DELETE FROM app_user WHERE id = $1", [item.id]);
  rmSync(`.local/test-originals/${workspaceId}`, {
    recursive: true,
    force: true,
  });
  rmSync(`.local/test-originals/${outsiderWorkspaceId}`, {
    recursive: true,
    force: true,
  });
  rmSync(`.local/test-watch/${workspaceId}`, { recursive: true, force: true });
  await pool.end();
  rmSync(".local/test-accounts.json", { force: true });
}
