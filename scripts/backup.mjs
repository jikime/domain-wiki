import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { deployment, execute, hashFile } from "./lib/deployment.mjs";

const [profile, folderArg] = process.argv.slice(2);
let target;
let stopped = false;
let resume = [];
try {
  if (!folderArg)
    throw new Error("사용법: node scripts/backup.mjs wiki-프로필 새백업폴더");
  target = deployment(profile);
  const folder = resolve(folderArg);
  mkdirSync(folder, { mode: 0o700 });
  resume = target
    .compose(["ps", "--services", "--status", "running"])
    .split("\n")
    .filter((name) => ["web", "worker"].includes(name));
  target.compose(["stop", "web", "worker"]);
  stopped = true;
  const running = target
    .compose(["ps", "--services", "--status", "running"])
    .split("\n");
  if (running.some((name) => name !== "db"))
    throw new Error("백업 전에 다른 작업 컨테이너도 중지하세요.");
  const before = target.tableCounts();
  const fingerprints = Object.fromEntries(
    Object.keys(before).map((name) => [
      name,
      target.sql(
        `SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)),'')) FROM public."${name.replaceAll('"', '""')}" t`,
      ),
    ]),
  );
  const storageTables = [
    "source_version",
    "source_asset",
    "archive_file",
  ].filter((name) => Object.hasOwn(before, name));
  const files = JSON.parse(
    target.sql(
      `SELECT coalesce(json_agg(json_build_object('key',storage_key,'sha256',sha256,'bytes',byte_size) ORDER BY storage_key),'[]') FROM (${storageTables.map((name) => `SELECT storage_key,sha256,byte_size FROM ${name}`).join(" UNION ")}) originals`,
    ),
  );
  const dump = join(folder, "database.dump");
  const fd = openSync(dump, "wx", 0o600);
  try {
    target.compose(
      [
        "exec",
        "-T",
        "db",
        "pg_dump",
        "-U",
        "postgres",
        "-d",
        "domain_wiki",
        "--format=custom",
        "--no-owner",
        "--no-acl",
      ],
      { stdio: ["ignore", fd, "pipe"] },
    );
  } finally {
    closeSync(fd);
  }
  const web = target.compose(["ps", "-aq", "web"]);
  if (!web)
    throw new Error("백업할 웹 컨테이너가 없습니다. 먼저 서비스를 생성하세요.");
  target.compose([
    "cp",
    "web:/var/lib/wiki/originals",
    join(folder, "originals"),
  ]);
  for (const item of files) {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(item.key))
      throw new Error("원본 저장 키 검사 실패");
    const path = join(folder, "originals", item.key);
    if (
      (await hashFile(path)) !== item.sha256 ||
      statSync(path).size !== item.bytes
    )
      throw new Error("백업 원본의 크기 또는 해시 불일치");
    chmodSync(path, 0o600);
  }
  if (JSON.stringify(target.tableCounts()) !== JSON.stringify(before))
    throw new Error("백업 도중 DB 데이터가 변경되었습니다.");
  for (const [name, value] of Object.entries(fingerprints))
    if (
      target.sql(
        `SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)),'')) FROM public."${name.replaceAll('"', '""')}" t`,
      ) !== value
    )
      throw new Error("백업 도중 DB 내용이 변경되었습니다.");
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    profile,
    appImage: target.env.APP_IMAGE,
    appImageId: execute("docker", ["inspect", web, "--format", "{{.Image}}"]),
    migrations: target.migrations(),
    databaseSha256: await hashFile(dump),
    counts: before,
    fingerprints,
    files,
  };
  writeFileSync(
    join(folder, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    `일관성·해시 검사를 마친 백업 저장 완료: 원본 ${files.length}개, 테이블 ${Object.keys(before).length}개`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (stopped && resume.length) {
    try {
      target.compose(["up", "-d", "--wait", ...resume]);
    } catch {
      console.error(
        "백업 후 서비스 재시작 실패. deploy status와 up으로 확인하세요.",
      );
      process.exitCode = 1;
    }
  }
}
