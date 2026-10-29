import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

export const sampleName = "가상 교통관제 자료";
export const defaultBundle = "docs/training/samples/training-snapshot.json";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const id = z.uuid();
const json = z.json();
const text = z.string();
const sampleTitle = text.startsWith("[가상 교육 자료]");
const projectSchema = z
  .object({
    id,
    name: text,
    client_name: text,
    description: text,
  })
  .strict();
const versionSchema = z
  .object({
    id,
    number: z.literal(1),
    filename: text,
    mime_type: z.literal("text/markdown"),
    sha256: text.regex(/^[a-f0-9]{64}$/),
    byte_size: z.number().int().positive().max(1_000_000),
    parser_version: text.nullable(),
    testimony: json.nullable(),
    original_base64: text.max(1_400_000),
  })
  .strict();
const bundleSchema = z
  .object({
    format: z.literal("domain-wiki-training-snapshot"),
    version: z.literal(1),
    created_at: z.iso.datetime(),
    notice: text,
    source_workspace_id: id,
    domain: z
      .object({
        id,
        name: z.literal(sampleName),
        purpose: text,
        purpose_markdown: text,
        schema_markdown: text,
        overview_markdown: text,
        purpose_guide: json,
        terms: json,
        guide: json,
        record_template: text,
      })
      .strict(),
    projects: z.array(projectSchema).length(2),
    sources: z
      .array(
        z
          .object({
            id,
            project_id: id.nullable(),
            title: sampleTitle,
            category: z.enum([
              "project",
              "guideline",
              "reference",
              "testimony",
            ]),
            version: versionSchema,
            chunks: z
              .array(
                z
                  .object({
                    id,
                    ordinal: z.number().int().nonnegative(),
                    text,
                    locator: json,
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .length(6),
    pages: z
      .array(
        z
          .object({
            id,
            project_id: id.nullable(),
            version_id: id,
            title: sampleTitle,
            body: text,
            metadata: json,
            evidence: z.array(id).min(1),
          })
          .strict(),
      )
      .length(2),
  })
  .strict();

export function validateBundle(value) {
  const bundle = bundleSchema.parse(value);
  const entities = [
    bundle.source_workspace_id,
    bundle.domain.id,
    ...bundle.projects.map((p) => p.id),
    ...bundle.sources.flatMap((s) => [
      s.id,
      s.version.id,
      ...s.chunks.map((c) => c.id),
    ]),
    ...bundle.pages.flatMap((p) => [p.id, p.version_id]),
  ];
  if (new Set(entities).size !== entities.length)
    throw new Error("샘플 식별자가 겹칩니다.");
  const projects = new Set(bundle.projects.map((p) => p.id));
  const chunks = new Set(
    bundle.sources.flatMap((s) => s.chunks.map((c) => c.id)),
  );
  for (const item of [...bundle.sources, ...bundle.pages]) {
    if (item.project_id && !projects.has(item.project_id))
      throw new Error("샘플 프로젝트 연결이 맞지 않습니다.");
  }
  for (const s of bundle.sources) {
    const bytes = Buffer.from(s.version.original_base64, "base64");
    if (
      bytes.length !== s.version.byte_size ||
      sha256(bytes) !== s.version.sha256
    )
      throw new Error("샘플 원본의 크기 또는 해시가 맞지 않습니다.");
    if (new Set(s.chunks.map((c) => c.ordinal)).size !== s.chunks.length)
      throw new Error("샘플 문단 순서가 겹칩니다.");
  }
  for (const p of bundle.pages) {
    if (
      new Set(p.evidence).size !== p.evidence.length ||
      p.evidence.some((c) => !chunks.has(c))
    )
      throw new Error("위키와 원문 근거의 연결이 맞지 않습니다.");
  }
  return bundle;
}

export async function readBundle(path = defaultBundle) {
  const raw = await readFile(path, "utf8");
  if (Buffer.byteLength(raw) > 10_000_000)
    throw new Error("교육용 샘플 파일이 너무 큽니다.");
  return validateBundle(JSON.parse(raw));
}

export function localDatabase(env) {
  const url = new URL(env.DATABASE_URL);
  if (
    env.NODE_ENV === "production" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("개인 PC의 로컬 개발 DB에서만 샘플을 준비할 수 있습니다.");
  return url.toString();
}

export function originalPath(root, key) {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key))
    throw new Error("원본 저장 경로가 올바르지 않습니다.");
  const base = resolve(root);
  const relation = relative(resolve("public"), base);
  if (!relation || (!relation.startsWith("..") && !isAbsolute(relation)))
    throw new Error("원본은 public 폴더 밖에 저장해야 합니다.");
  return resolve(base, key);
}

export async function localAccounts(client) {
  const { rows } = await client.query(`SELECT m.workspace_id, u.id
    FROM membership m JOIN app_user u ON u.id=m.user_id
    WHERE u.email='admin@wiki.local' AND m.is_admin AND m.is_active`);
  if (rows.length !== 1)
    throw new Error(
      "먼저 npm run db:bootstrap으로 개인 실습 계정을 준비하세요.",
    );
  const admin = rows[0];
  const writers = await client.query(
    `SELECT u.id FROM membership m JOIN app_user u ON u.id=m.user_id
    WHERE m.workspace_id=$1 AND u.email='writer@wiki.local' AND m.role='writer' AND m.is_active`,
    [admin.workspace_id],
  );
  if (writers.rows.length !== 1)
    throw new Error(
      "먼저 npm run db:content-team으로 작성·검토 계정을 준비하세요.",
    );
  return {
    workspaceId: admin.workspace_id,
    writerId: writers.rows[0].id,
    actorId: admin.id,
  };
}

async function insert(client, table, row) {
  // 테이블과 열 이름은 아래의 고정 코드에서만 전달한다. 값은 모두 매개변수로 보낸다.
  const keys = Object.keys(row);
  const values = Object.values(row).map((v) =>
    v !== null && typeof v === "object" ? JSON.stringify(v) : v,
  );
  await client.query(
    `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
    values,
  );
}

// 호출자가 트랜잭션과 실패 시 원본 정리를 맡는다. 교육용 초기 상태만 추가한다.
export async function installTrainingBundle(client, input, options) {
  const bundle = validateBundle(input);
  const { workspaceId, writerId, actorId, originalsDir, createdFiles } =
    options;
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `training-samples:${workspaceId}`,
  ]);
  const existing = await client.query(
    "SELECT id FROM domain WHERE workspace_id=$1 AND name=$2",
    [workspaceId, sampleName],
  );
  if (existing.rows.length)
    return { created: false, domainId: existing.rows[0].id };
  const ids = new Map([[bundle.source_workspace_id, workspaceId]]);
  const entities = [
    bundle.domain.id,
    ...bundle.projects.map((p) => p.id),
    ...bundle.sources.flatMap((s) => [
      s.id,
      s.version.id,
      ...s.chunks.map((c) => c.id),
    ]),
    ...bundle.pages.flatMap((p) => [p.id, p.version_id]),
  ];
  for (const old of entities) ids.set(old, randomUUID());
  const remap = (value) =>
    JSON.parse(
      JSON.stringify(value).replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
        (old) => ids.get(old) ?? old,
      ),
    );
  const data = remap(bundle);
  const domainId = data.domain.id;
  await insert(client, "domain", {
    ...data.domain,
    workspace_id: workspaceId,
    auto_ingest: false,
  });
  for (const p of data.projects)
    await insert(client, "project", {
      ...p,
      workspace_id: workspaceId,
      domain_id: domainId,
    });
  for (const s of data.sources) {
    const v = s.version;
    const key = `${workspaceId}/${randomUUID()}`;
    const path = originalPath(originalsDir, key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const handle = await open(path, "wx", 0o600);
    createdFiles.push(path);
    try {
      await handle.writeFile(Buffer.from(v.original_base64, "base64"));
    } finally {
      await handle.close();
    }
    await insert(client, "source", {
      id: s.id,
      workspace_id: workspaceId,
      domain_id: domainId,
      project_id: s.project_id,
      title: s.title,
      category: s.category,
      created_by: writerId,
      version_count: 1,
    });
    const { original_base64: _bytes, ...version } = v;
    await insert(client, "source_version", {
      ...version,
      workspace_id: workspaceId,
      source_id: s.id,
      storage_key: key,
      uploaded_by: writerId,
      publication: "published",
      processing: "completed",
    });
    for (const chunk of s.chunks)
      await insert(client, "source_chunk", {
        ...chunk,
        workspace_id: workspaceId,
        version_id: v.id,
      });
    await client.query(
      "UPDATE source SET latest_version_id=$1,published_version_id=$1 WHERE id=$2",
      [v.id, s.id],
    );
    await insert(client, "review_decision", {
      workspace_id: workspaceId,
      source_version_id: v.id,
      actor_id: actorId,
      action: "training_import",
      note: "가상 교육용 초기 상태를 샘플 백업에서 가져옴. 이 실행에서 사람이 검토·승인했다는 기록이 아닙니다.",
    });
  }
  for (const p of data.pages) {
    await insert(client, "wiki_page", {
      id: p.id,
      workspace_id: workspaceId,
      domain_id: domainId,
      project_id: p.project_id,
      created_by: writerId,
      version_count: 1,
    });
    await insert(client, "wiki_version", {
      id: p.version_id,
      workspace_id: workspaceId,
      page_id: p.id,
      number: 1,
      title: p.title,
      body: p.body,
      metadata: p.metadata,
      author_id: writerId,
      state: "approved",
    });
    for (const chunkId of p.evidence)
      await insert(client, "wiki_evidence", {
        workspace_id: workspaceId,
        version_id: p.version_id,
        chunk_id: chunkId,
      });
    await client.query(
      "UPDATE wiki_page SET latest_version_id=$1,published_version_id=$1 WHERE id=$2",
      [p.version_id, p.id],
    );
    await insert(client, "review_decision", {
      workspace_id: workspaceId,
      wiki_version_id: p.version_id,
      actor_id: actorId,
      action: "training_import",
      note: "가상 교육용 게시 위키를 샘플 백업에서 가져옴. 실제 업무 자료에는 별도 검토가 필요합니다.",
    });
  }
  return { created: true, domainId };
}

export async function checkTrainingData(client, workspaceId, originalsDir) {
  const domains = await client.query(
    "SELECT id FROM domain WHERE workspace_id=$1 AND name=$2",
    [workspaceId, sampleName],
  );
  if (!domains.rows.length)
    throw new Error(
      "샘플 도메인이 없습니다. npm run db:seed-training을 실행하세요.",
    );
  const domainId = domains.rows[0].id;
  const projects = await client.query(
    "SELECT name FROM project WHERE domain_id=$1 ORDER BY name",
    [domainId],
  );
  const sources = await client.query(
    `SELECT s.title,v.storage_key,v.sha256,v.byte_size,v.processing,v.publication
    FROM source s LEFT JOIN source_version v ON v.id=s.published_version_id WHERE s.domain_id=$1`,
    [domainId],
  );
  const pages = await client.query(
    `SELECT v.title,v.state,(SELECT count(*)::int FROM wiki_evidence e WHERE e.version_id=v.id) AS evidence
    FROM wiki_page p LEFT JOIN wiki_version v ON v.id=p.published_version_id WHERE p.domain_id=$1`,
    [domainId],
  );
  const chunks = await client.query(
    `SELECT count(*)::int AS count FROM source_chunk c JOIN source_version v ON v.id=c.version_id
    JOIN source s ON s.id=v.source_id WHERE s.domain_id=$1 AND s.published_version_id=v.id`,
    [domainId],
  );
  if (
    projects.rows.length !== 2 ||
    sources.rows.length !== 6 ||
    pages.rows.length !== 2 ||
    chunks.rows[0].count !== 53
  )
    throw new Error(
      "기본 샘플 수와 다릅니다. 이미 실습한 환경이면 변경 내용을 유지하고 강사와 확인하세요. 자동 초기화하지 않습니다.",
    );
  for (const s of sources.rows) {
    if (s.processing !== "completed" || s.publication !== "published")
      throw new Error("공개·추출을 확인할 샘플이 있습니다.");
    const bytes = await readFile(originalPath(originalsDir, s.storage_key));
    if (sha256(bytes) !== s.sha256 || bytes.length !== s.byte_size)
      throw new Error("샘플 원본 파일이 DB 기록과 다릅니다.");
  }
  if (pages.rows.some((p) => p.state !== "approved" || !p.evidence))
    throw new Error("위키 게시·근거 연결을 확인하세요.");
  return {
    domain: sampleName,
    projects: projects.rows.map((p) => p.name),
    sources: 6,
    chunks: 53,
    wikiPages: 2,
  };
}

export async function removeCreatedFiles(files) {
  for (const path of files)
    await unlink(path).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
}
