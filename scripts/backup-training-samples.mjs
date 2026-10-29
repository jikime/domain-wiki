import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import nextEnv from "@next/env";
import pg from "pg";
import {
  localAccounts,
  localDatabase,
  originalPath,
  sampleName,
  validateBundle,
} from "./lib/training-samples.mjs";

nextEnv.loadEnvConfig(process.cwd());
let client;
try {
  if (process.argv.length > 3)
    throw new Error("사용법: npm run training:backup -- 새파일.json");
  const output =
    process.argv[2] ||
    `.local/backups/training-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  if (!output.endsWith(".json"))
    throw new Error("샘플 백업 파일은 .json 확장자로 저장하세요.");
  client = new pg.Client({
    connectionString: localDatabase(process.env),
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const { workspaceId } = await localAccounts(client);
  const domains = await client.query(
    `SELECT id,name,purpose,purpose_markdown,schema_markdown,overview_markdown,
    purpose_guide,terms,guide,record_template FROM domain WHERE workspace_id=$1 AND name=$2`,
    [workspaceId, sampleName],
  );
  if (domains.rows.length !== 1)
    throw new Error("백업할 가상 교육용 도메인이 없습니다.");
  const domain = domains.rows[0];
  const projects = (
    await client.query(
      "SELECT id,name,client_name,description FROM project WHERE domain_id=$1 ORDER BY name",
      [domain.id],
    )
  ).rows;
  const rows = (
    await client.query(
      `SELECT s.id,s.project_id,s.title,s.category,s.published_version_id
    FROM source s WHERE s.domain_id=$1 ORDER BY s.title`,
      [domain.id],
    )
  ).rows;
  const sources = [];
  for (const s of rows) {
    const result = await client.query(
      `SELECT id,number,filename,mime_type,sha256,byte_size,parser_version,testimony,storage_key
      FROM source_version WHERE id=$1 AND source_id=$2 AND publication='published' AND processing='completed'`,
      [s.published_version_id, s.id],
    );
    if (result.rows.length !== 1)
      throw new Error("공개·추출 완료 상태의 기본 샘플만 백업할 수 있습니다.");
    const { storage_key, ...version } = result.rows[0];
    const original = await readFile(
      originalPath(
        process.env.ORIGINALS_DIR || ".local/originals",
        storage_key,
      ),
    );
    if (s.category !== "testimony") {
      if (
        ![
          "01-project-a.md",
          "02-review-guide.md",
          "03-acceptance-v1.md",
          "04-meeting.md",
          "05-project-b.md",
        ].includes(version.filename)
      )
        throw new Error("교육용 기본 원본 이외의 파일이 있습니다.");
      const canonical = await readFile(
        `docs/training/samples/${version.filename}`,
      );
      if (!original.equals(canonical))
        throw new Error(
          "기본 샘플 원본이 변경되었습니다. 교육용 배포본에 회사 자료를 섞지 마세요.",
        );
    }
    const chunks = (
      await client.query(
        "SELECT id,ordinal,text,locator FROM source_chunk WHERE version_id=$1 ORDER BY ordinal",
        [version.id],
      )
    ).rows;
    const { published_version_id: _published, ...source } = s;
    sources.push({
      ...source,
      version: { ...version, original_base64: original.toString("base64") },
      chunks,
    });
  }
  const pages = (
    await client.query(
      `SELECT p.id,p.project_id,v.id AS version_id,v.title,v.body,v.metadata
    FROM wiki_page p JOIN wiki_version v ON v.id=p.published_version_id AND v.state='approved'
    WHERE p.domain_id=$1 ORDER BY v.title`,
      [domain.id],
    )
  ).rows;
  for (const p of pages)
    p.evidence = (
      await client.query(
        "SELECT chunk_id FROM wiki_evidence WHERE version_id=$1 ORDER BY chunk_id",
        [p.version_id],
      )
    ).rows.map((e) => e.chunk_id);
  const bundle = validateBundle({
    format: "domain-wiki-training-snapshot",
    version: 1,
    created_at: new Date().toISOString(),
    notice:
      "가상 교육용 초기 상태의 복사본. 계정·암호·세션·API 키·대화·운영 이력은 포함하지 않습니다. 원본 6개와 문단·게시 위키·근거를 포함합니다. 전체 서버 백업이 아닙니다.",
    source_workspace_id: workspaceId,
    domain,
    projects,
    sources,
    pages,
  });
  await client.query("ROLLBACK");
  await mkdir(dirname(resolve(output)), { recursive: true, mode: 0o700 });
  await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(`교육용 샘플 백업 저장: ${output}`);
  console.log(
    "자료 6건·게시 위키 2건과 원본 파일을 포함합니다. 공유 전 가상 교육 자료만 있는지 확인하세요.",
  );
} catch (error) {
  const code = /^[A-Z0-9_]{2,40}$/.test(error.code ?? "") ? error.code : null;
  console.error(
    code
      ? `샘플 백업 실패 [${code}]. DB 연결·파일 경로를 확인하세요. 기존 파일은 덮어쓰지 않습니다.`
      : error.name === "ZodError"
        ? "교육용 기본 샘플 형식과 다릅니다. 자료·버전·위키 수를 확인하세요."
        : error.message,
  );
  process.exitCode = 1;
} finally {
  if (client) await client.end();
}
