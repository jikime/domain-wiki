import { closeSync, openSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { deployment, execute, hashFile, literal } from "./lib/deployment.mjs";

const [profile, folderArg] = process.argv.slice(2);
let phase = "백업 검사";
try {
  if (!folderArg)
    throw new Error("사용법: node scripts/restore.mjs wiki-새프로필 백업폴더");
  const target = deployment(profile);
  const folder = resolve(folderArg);
  const manifest = JSON.parse(
    readFileSync(join(folder, "manifest.json"), "utf8"),
  );
  if (
    manifest.version !== 1 ||
    manifest.profile === profile ||
    !Array.isArray(manifest.files) ||
    !manifest.counts ||
    !manifest.fingerprints
  )
    throw new Error("복원 대상은 원본과 다른 새 프로필이어야 합니다.");
  if (
    target.env.APP_IMAGE !== manifest.appImage ||
    execute("docker", [
      "image",
      "inspect",
      target.env.APP_IMAGE,
      "--format",
      "{{.Id}}",
    ]) !== manifest.appImageId
  )
    throw new Error(
      "먼저 백업 당시 이미지로 복원하세요. 검증 후 새 버전으로 올릴 수 있습니다.",
    );
  const dump = join(folder, "database.dump");
  if ((await hashFile(dump)) !== manifest.databaseSha256)
    throw new Error("DB 백업 해시가 일치하지 않습니다.");
  for (const item of manifest.files) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(item.key))
      throw new Error("원본 경로 검사 실패");
    const path = join(folder, "originals", item.key);
    if (
      statSync(path).size !== item.bytes ||
      (await hashFile(path)) !== item.sha256
    )
      throw new Error("원본 백업 해시가 일치하지 않습니다.");
  }
  const containers = target.compose(["ps", "-aq", "web", "worker"]);
  if (containers)
    throw new Error("기존 서비스는 덮어쓰지 않습니다. 새 프로필을 준비하세요.");
  phase = "빈 복구 DB 준비";
  target.compose(["up", "-d", "--wait", "db"]);
  if (
    target.sql(
      "SELECT count(*) FROM pg_roles WHERE rolname='domain_wiki'",
      "postgres",
    ) === "0"
  )
    target.sql(
      `CREATE ROLE domain_wiki LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(target.env.APP_DB_PASSWORD)}`,
      "postgres",
    );
  if (
    target.sql(
      "SELECT count(*) FROM pg_database WHERE datname='domain_wiki'",
      "postgres",
    ) !== "0"
  )
    throw new Error(
      "대상 DB가 이미 있습니다. 빈 새 프로필만 복원할 수 있습니다.",
    );
  target.sql("CREATE DATABASE domain_wiki OWNER domain_wiki", "postgres");
  target.sql("CREATE EXTENSION IF NOT EXISTS vector");
  phase = "DB 복원";
  const fd = openSync(dump, "r");
  try {
    target.compose(
      [
        "exec",
        "-T",
        "db",
        "pg_restore",
        "-U",
        "postgres",
        "--role=domain_wiki",
        "-d",
        "domain_wiki",
        "--no-owner",
        "--no-acl",
        "--no-comments",
        "--exit-on-error",
        "--single-transaction",
      ],
      { stdio: [fd, "pipe", "pipe"] },
    );
  } finally {
    closeSync(fd);
  }
  phase = "DB 내용 대조";
  if (
    target.migrations() !== manifest.migrations ||
    JSON.stringify(target.tableCounts()) !== JSON.stringify(manifest.counts)
  )
    throw new Error("복원 스키마 또는 행 수가 일치하지 않습니다.");
  for (const [name, value] of Object.entries(manifest.fingerprints)) {
    if (!/^[a-z_]+$/.test(name)) throw new Error("백업 테이블 이름 오류");
    if (
      target.sql(
        `SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)),'')) FROM public."${name}" t`,
      ) !== value
    )
      throw new Error("복원 테이블 내용이 일치하지 않습니다.");
  }
  phase = "원본 볼륨 복사";
  target.compose(["create", "web", "worker"]);
  target.compose([
    "cp",
    `${join(folder, "originals")}/.`,
    "web:/var/lib/wiki/originals/",
  ]);
  target.compose([
    "run",
    "--rm",
    "--no-deps",
    "-T",
    "--user",
    "0",
    "maintenance",
    "chown",
    "-R",
    "1000:1000",
    "/var/lib/wiki/originals",
  ]);
  // 재기동 전에 실제 볼륨에 복사된 파일을 다시 읽어 검증합니다.
  const checker = `const {createReadStream,statSync}=require('node:fs');const {createHash}=require('node:crypto');let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',async()=>{for(const f of JSON.parse(s)){const p='/var/lib/wiki/originals/'+f.key,h=createHash('sha256');for await(const c of createReadStream(p))h.update(c);if(statSync(p).size!==f.bytes||h.digest('hex')!==f.sha256)process.exit(1)}});`;
  target.compose(
    ["run", "--rm", "--no-deps", "-T", "maintenance", "node", "-e", checker],
    { input: JSON.stringify(manifest.files) },
  );
  console.log(
    `복원 및 전체 행·본문·원본 검증 완료: ${manifest.files.length}개 원본. deploy up으로 시작하고 새 주소에서 다시 로그인하세요.`,
  );
} catch (error) {
  console.error(`${phase}: ${error.message}`);
  process.exitCode = 1;
}
