import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
const out = "docs/evaluation/core/final-16-fixed",
  before = JSON.parse(
    readFileSync("docs/evaluation/core/baseline-09/results.json", "utf8"),
  ),
  after = JSON.parse(readFileSync(`${out}/results.json`, "utf8"));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const report = {
  date: new Date().toISOString(),
  sources: [],
  wiki: null,
  queries: [],
  usage: {},
  businessReview: null,
};
try {
  for (const filename of before.fixture.sourceFiles) {
    const a = before.fixture.sources[filename],
      b = after.fixture.sources[filename];
    assert.equal(a.fileHash, b.fileHash);
    const read = async (versionId) => {
      const v = (
        await pool.query(
          "SELECT sha256,parser_version FROM source_version WHERE id=$1",
          [versionId],
        )
      ).rows[0];
      const chunks = (
        await pool.query(
          "SELECT ordinal,text,locator FROM source_chunk WHERE version_id=$1 ORDER BY ordinal",
          [versionId],
        )
      ).rows;
      return { ...v, chunks };
    };
    const av = await read(a.versionId),
      bv = await read(b.versionId);
    assert.equal(av.sha256, bv.sha256);
    assert.deepEqual(av.chunks, bv.chunks);
    report.sources.push({
      filename,
      fileHash: a.fileHash,
      storedFileHash: av.sha256,
      contentHash: digest(av.chunks),
      chunks: av.chunks.length,
      beforeVersion: a.versionId,
      afterVersion: b.versionId,
      beforeParser: av.parser_version,
      afterParser: bv.parser_version,
      identical: true,
    });
  }
  const readWiki = async (id) =>
    (
      await pool.query(
        "SELECT title,body,metadata FROM wiki_version WHERE id=$1",
        [id],
      )
    ).rows[0];
  const aw = await readWiki(before.fixture.wikiVersionId),
    bw = await readWiki(after.fixture.wikiVersionId);
  assert.deepEqual(aw, bw);
  report.wiki = {
    contentHash: digest(aw),
    identical: true,
    title: aw.title,
    beforeVersion: before.fixture.wikiVersionId,
    afterVersion: after.fixture.wikiVersionId,
  };
  for (const old of before.queries) {
    const next = after.queries.find((q) => q.id === old.id);
    assert.equal(old.question, next.question);
    assert.equal(old.model, next.model);
    assert.equal(next.state, "completed");
    report.queries.push({
      id: old.id,
      sameQuestion: true,
      sameModel: next.model,
      beforeEvidenceHits: old.evidenceHits.filter((e) => e.found).length,
      afterEvidenceHits: next.evidenceHits.filter((e) => e.found).length,
      expectedEvidence: old.evidenceHits.length,
      beforeMs: old.elapsedMs,
      afterMs: next.elapsedMs,
      beforeAnswer: old.answer,
      afterAnswer: next.answer,
    });
  }
  for (const [phase, data] of [
    ["before", before],
    ["after", after],
  ])
    report.usage[phase] = (
      await pool.query(
        "SELECT count(*)::int AS calls,COALESCE(sum(input_tokens),0)::int AS input_tokens,COALESCE(sum(output_tokens),0)::int AS output_tokens,count(*) FILTER(WHERE input_tokens IS NULL OR output_tokens IS NULL)::int AS unknown FROM chat_run WHERE conversation_id=ANY($1::uuid[])",
        [data.queries.map((q) => q.conversationId)],
      )
    ).rows[0];
  report.limitations = [
    "입력 원문 파일·추출 문단·기준 위키·질문·모델 이름은 동일하다. 평가 공간·문서 ID와 생성 시점은 다르다.",
    "모델 응답의 확률성과 제공자의 내부 변경을 고정하지 않는다. 사용 지시문·검색 문맥은 구현 변경의 비교 대상이다.",
    "고객 업무 담당자의 전문적 품질 판정은 수행하지 않았다.",
  ];
  writeFileSync(
    `${out}/comparison.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      identicalSources: report.sources.length,
      identicalWiki: report.wiki.identical,
      queries: report.queries.length,
      usage: report.usage,
    }),
  );
} finally {
  await pool.end();
}
