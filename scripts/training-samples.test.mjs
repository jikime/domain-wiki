import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import nextEnv from "@next/env";
import pg from "pg";
import {
  checkTrainingData,
  installTrainingBundle,
  localDatabase,
  readBundle,
  removeCreatedFiles,
  validateBundle,
} from "./lib/training-samples.mjs";

nextEnv.loadEnvConfig(process.cwd());

test("교육용 백업은 원본·문단·위키 근거를 보관하고 손상된 연결을 거부한다", async () => {
  const bundle = await readBundle();
  assert.equal(
    bundle.sources.reduce((n, s) => n + s.chunks.length, 0),
    53,
  );
  assert.equal(
    bundle.pages.reduce((n, p) => n + p.evidence.length, 0),
    37,
  );
  const broken = structuredClone(bundle);
  broken.sources[0].version.original_base64 =
    Buffer.from("깨진 원본").toString("base64");
  assert.throws(() => validateBundle(broken), /해시/);
  const invalid = structuredClone(bundle);
  invalid.pages[0].evidence = [randomUUID()];
  assert.throws(() => validateBundle(invalid), /근거/);
  const leaked = structuredClone(bundle);
  leaked.accounts = [];
  assert.throws(() => validateBundle(leaked));
});

test("운영 환경과 원격 DB에서는 교육용 초기화를 거부한다", () => {
  assert.throws(
    () => localDatabase({ DATABASE_URL: "postgresql://host/example" }),
    /로컬/,
  );
  assert.throws(
    () =>
      localDatabase({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/example",
      }),
    /로컬/,
  );
});

async function fixture(t) {
  const client = new pg.Client({
    connectionString: localDatabase(process.env),
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
  await client.connect();
  const originalsDir = await mkdtemp(join(tmpdir(), "wiki-training-"));
  const createdFiles = [];
  t.after(async () => {
    try {
      await client.query("ROLLBACK");
    } finally {
      await client.end();
      await removeCreatedFiles(createdFiles);
      await rm(originalsDir, { recursive: true, force: true });
    }
  });
  await client.query("BEGIN");
  const workspaceId = randomUUID(),
    writerId = randomUUID(),
    actorId = randomUUID();
  await client.query("INSERT INTO workspace (id,name) VALUES ($1,$2)", [
    workspaceId,
    "자동 검사 전용 · 종료 시 되돌림",
  ]);
  for (const id of [writerId, actorId])
    await client.query(
      "INSERT INTO app_user (id,name,email) VALUES ($1,$2,$3)",
      [id, "검사 전용", `${id}@training-test.invalid`],
    );
  return { client, workspaceId, writerId, actorId, originalsDir, createdFiles };
}

test("새 작업공간에 복원하고 재실행해도 실습 변경과 기존 자료를 유지한다", async (t) => {
  const context = await fixture(t);
  const { client, workspaceId, originalsDir, createdFiles } = context;
  const bundle = await readBundle();
  const installed = await installTrainingBundle(client, bundle, context);
  assert.equal(installed.created, true);
  const summary = await checkTrainingData(client, workspaceId, originalsDir);
  assert.deepEqual(summary.projects, [
    "프로젝트 A · 가람시",
    "프로젝트 B · 누리시",
  ]);
  assert.equal(createdFiles.length, 6);
  const linked = await client.query(
    `SELECT count(*)::int AS count FROM wiki_evidence e
    JOIN source_chunk c ON c.id=e.chunk_id JOIN wiki_version v ON v.id=e.version_id
    WHERE e.workspace_id=$1 AND c.workspace_id=$1 AND v.workspace_id=$1`,
    [workspaceId],
  );
  assert.equal(linked.rows[0].count, 37);
  const testimony = await client.query(
    "SELECT count(*)::int AS count FROM source_version WHERE workspace_id=$1 AND testimony IS NOT NULL",
    [workspaceId],
  );
  assert.equal(testimony.rows[0].count, 1);
  const reviews = await client.query(
    "SELECT DISTINCT action FROM review_decision WHERE workspace_id=$1",
    [workspaceId],
  );
  assert.deepEqual(reviews.rows, [{ action: "training_import" }]);
  const stored = await client.query(
    "SELECT id FROM source WHERE domain_id=$1 ORDER BY title LIMIT 1",
    [installed.domainId],
  );
  await client.query("UPDATE source SET title=$1 WHERE id=$2", [
    "교육생이 수정한 제목",
    stored.rows[0].id,
  ]);
  const retried = await installTrainingBundle(client, bundle, context);
  assert.equal(retried.created, false);
  assert.equal(createdFiles.length, 6);
  assert.equal(
    (
      await client.query("SELECT title FROM source WHERE id=$1", [
        stored.rows[0].id,
      ])
    ).rows[0].title,
    "교육생이 수정한 제목",
  );
  // 현재 DB의 샘플과 같은 ID를 쓰지 않고 다른 작업공간으로 연결해야 한다.
  assert.notEqual(installed.domainId, bundle.domain.id);
  const foreign = await client.query(
    "SELECT count(*)::int AS count FROM source WHERE workspace_id=$1 AND id=ANY($2::uuid[])",
    [workspaceId, bundle.sources.map((s) => s.id)],
  );
  assert.equal(foreign.rows[0].count, 0);
});

test("복원 중 오류는 DB를 되돌리고 이번 실행의 원본 파일만 정리할 수 있다", async (t) => {
  const context = await fixture(t);
  const { client, workspaceId, createdFiles } = context;
  const guarded = {
    query: (sql, params) => {
      if (sql.startsWith("INSERT INTO wiki_version"))
        throw new Error("시험용 저장 실패");
      return client.query(sql, params);
    },
  };
  await client.query("SAVEPOINT before_sample");
  await assert.rejects(
    installTrainingBundle(guarded, await readBundle(), context),
    /시험용/,
  );
  assert.equal(createdFiles.length, 6);
  await client.query("ROLLBACK TO SAVEPOINT before_sample");
  await removeCreatedFiles(createdFiles);
  const remaining = await client.query(
    "SELECT count(*)::int AS count FROM domain WHERE workspace_id=$1",
    [workspaceId],
  );
  assert.equal(remaining.rows[0].count, 0);
  for (const path of createdFiles)
    await assert.rejects(readFile(path), { code: "ENOENT" });
});
