import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} 실행 실패 (종료 코드 ${result.status ?? "없음"}). 해당 컨테이너 상태와 로그를 확인하세요.`,
    );
  return result.stdout?.trim() ?? "";
}
export function deployment(profile) {
  if (!/^wiki-[a-z0-9][a-z0-9-]{1,40}$/.test(profile ?? ""))
    throw new Error(
      "프로필은 wiki-로 시작하는 영문 소문자·숫자·하이픈이어야 합니다.",
    );
  const folder = resolve(".local/deploy", profile);
  const file = resolve(folder, "runtime.env");
  const env = parseEnv(readFileSync(file, "utf8"));
  const composeArgs = [
    "compose",
    "--project-directory",
    process.cwd(),
    "-p",
    profile,
    "--env-file",
    file,
    "-f",
    "compose.production.yaml",
  ];
  const compose = (args, options) =>
    execute("docker", [...composeArgs, ...args], options);
  const sql = (statement, database = "domain_wiki") =>
    compose(
      [
        "exec",
        "-T",
        "db",
        "psql",
        "-X",
        "-U",
        "postgres",
        "-d",
        database,
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
      ],
      { input: statement },
    );
  const tableCounts = () => {
    const tables = JSON.parse(
      sql(
        "SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public'",
      ),
    );
    return Object.fromEntries(
      tables.map((name) => [
        name,
        Number(
          sql(`SELECT count(*) FROM public."${name.replaceAll('"', '""')}"`),
        ),
      ]),
    );
  };
  const migrations = () =>
    sql(
      "SELECT coalesce(string_agg(hash, ',' ORDER BY id),'') FROM drizzle.__drizzle_migrations",
    );
  return { profile, folder, file, env, compose, sql, tableCounts, migrations };
}
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const literal = (value) => `'${value.replaceAll("'", "''")}'`;

export async function hashFile(path) {
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  return digest.digest("hex");
}
