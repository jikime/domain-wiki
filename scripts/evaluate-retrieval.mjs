// Real-model retrieval regression on the existing synthetic development fixtures.
// Local account files are read privately; reports never contain credentials.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";
import { chromium, expect, request } from "@playwright/test";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
const phase = process.argv[2] ?? "graph-13";
if (!/^[a-z0-9-]{1,40}$/.test(phase))
  throw new Error("평가 이름을 확인하세요.");
const out = `docs/evaluation/core/${phase}`;
if (existsSync(`${out}/results.json`))
  throw new Error("기존 평가를 보존합니다. 새 평가 이름을 사용하세요.");
mkdirSync(out, { recursive: true });
const fixture = JSON.parse(readFileSync(".local/core-evaluation.json", "utf8"));
const account = JSON.parse(
  readFileSync(".local/initial-accounts.json", "utf8"),
).accounts.find((a) => !a.isAdmin);
const baseline = JSON.parse(
  readFileSync("docs/evaluation/core/baseline-09/results.json", "utf8"),
);
const questions = JSON.parse(
  readFileSync("docs/evaluation/questions.json", "utf8"),
);
const statusRecheck = process.argv.includes("--status-recheck");
const ingest = JSON.parse(
  readFileSync(".local/ingest-evaluation.json", "utf8"),
);
const origin = "http://localhost:3010",
  base = `/api/workspaces/${fixture.workspaceId}`;
const api = await request.newContext({
  baseURL: origin,
  extraHTTPHeaders: { Origin: origin },
});
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let browser;
const report = {
  phase,
  date: new Date().toISOString(),
  dataClassification: "직접 작성한 가상 개발 표본",
  businessReview: null,
  baseline: "baseline-09",
  baselineLimit: 8,
  maximumSupplementary: 4,
  queries: [],
  browser: [],
};
const read = async (response, status = 200) => {
  const value = await response.json();
  if (response.status() !== status)
    throw new Error(
      `평가 API ${response.status()}: ${value.error ?? "요청 실패"}`,
    );
  return value;
};
const save = (name = "partial") =>
  writeFileSync(`${out}/${name}.json`, `${JSON.stringify(report, null, 2)}\n`);
async function query(q, scope) {
  const conversation = await read(
    await api.post(`${base}/conversations`, {
      data: { title: `${phase} ${q.id}`, scope },
    }),
    201,
  );
  const start = Date.now();
  for (const prompt of [q.previousQuestion, q.question].filter(Boolean)) {
    const response = await api.post(
      `${base}/conversations/${conversation.id}/stream`,
      { data: { requestId: randomUUID(), prompt }, timeout: 180000 },
    );
    expect(response.status()).toBe(200);
    await response.text();
  }
  const detail = await read(
    await api.get(`${base}/conversations/${conversation.id}`),
  );
  const run = detail.runs.at(-1);
  const refs = run.citations.map((c) => ({ ...c.snapshot, used: c.used }));
  const row = {
    id: q.id,
    question: q.question,
    scope,
    conversationId: conversation.id,
    elapsedMs: Date.now() - start,
    state: run.state,
    error: run.errorMessage,
    model: run.model,
    mode: run.retrievalMode,
    inputTokens: detail.runs.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
    outputTokens: detail.runs.reduce((n, r) => n + (r.outputTokens ?? 0), 0),
    calls: detail.runs.length,
    answer: run.messages.find((m) => m.role === "assistant")?.body,
    citations: refs,
    evidenceHits: (q.evidence ?? []).map((e) => ({
      quote: e.quote,
      baseline:
        baseline.queries
          .find((b) => b.id === q.id)
          ?.evidenceHits.find((h) => h.quote === e.quote)?.found ?? null,
      top8: refs.slice(0, 8).some((r) => r.text.includes(e.quote)),
      found: refs.some((r) => r.text.includes(e.quote)),
    })),
    links: [],
    businessReview: null,
  };
  for (const ref of refs.filter((r) => r.used)) {
    const response = await api.get(ref.href);
    row.links.push({ href: ref.href, status: response.status() });
    expect(response.status()).toBe(200);
  }
  report.queries.push(row);
  save();
  console.log(
    `${q.id}: ${row.state}, 상위 근거 ${row.evidenceHits.filter((h) => h.top8).length}/${row.evidenceHits.length}, 관계 원문 ${refs.filter((r) => r.graph).length}, ${row.elapsedMs}ms`,
  );
  expect(row.state, row.error ?? row.answer).toBe("completed");
  expect(row.evidenceHits.every((h) => h.found)).toBe(true);
  return row;
}
try {
  await read(
    await api.post("/api/auth/sign-in/email", {
      data: { email: account.email, password: account.password },
    }),
  );
  const coverageSql = `WITH current AS (
    SELECT 'source' AS kind,c.id AS target FROM source_chunk c JOIN source_version v ON v.id=c.version_id JOIN source s ON s.published_version_id=v.id WHERE s.workspace_id=$1 AND v.publication='published' AND v.processing='completed' AND source_is_current(v.id)
    UNION ALL SELECT 'wiki',v.id FROM wiki_version v JOIN wiki_page p ON p.published_version_id=v.id WHERE p.workspace_id=$1 AND v.state='approved' AND NOT EXISTS(SELECT 1 FROM wiki_evidence e JOIN source_chunk c ON c.id=e.chunk_id WHERE e.version_id=v.id AND NOT source_is_current(c.version_id))
  ) SELECT count(*)::int AS total,count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM content_embedding e WHERE e.workspace_id=$1 AND e.kind=c.kind AND e.target_id=c.target AND e.model LIKE '%:utf8-6000-mean-v1:full-body-v2'))::int AS missing FROM current c`;
  for (let attempts = 0; attempts < 120; attempts++) {
    report.index = (
      await pool.query(coverageSql, [fixture.workspaceId])
    ).rows[0];
    if (report.index.missing === 0) break;
    if (attempts % 10 === 0)
      console.log(`현재 버전 색인 대기: ${report.index.missing}개`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  expect(report.index.missing).toBe(0);
  for (let sample = 1; sample <= (statusRecheck ? 3 : 1); sample++) {
    for (const q of questions.filter(
      (q) => !statusRecheck || ["Q05", "Q09"].includes(q.id),
    )) {
      const prior = baseline.queries.find((r) => r.id === q.id);
      const row = await query(q, prior.scope);
      row.sample = sample;
    }
  }
  if (!statusRecheck) {
    const ingestScope = {
      domainId: ingest.domainId,
      projectId: ingest.projectId,
      sourceId: null,
      wikiId: null,
    };
    await query(
      {
        id: "L01",
        question:
          "운영 기록은 며칠 동안 보관하며 임의로 수치를 보완해도 되나요?",
        evidence: [{ quote: "운영 기록은 45일 동안 보관합니다." }],
      },
      ingestScope,
    );
    await query(
      {
        id: "L02",
        question:
          "운영 기록은 며칠 동안 보관하며 임의로 수치를 보완해도 되나요?",
        evidence: [{ quote: "운영 기록은 45일 동안 보관합니다." }],
      },
      { ...ingestScope, sourceOnly: true },
    );
    expect(
      report.queries
        .at(-1)
        .citations.every((r) => r.kind === "source" && !r.graph),
    ).toBe(true);
  }
  browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: await api.storageState(),
    timezoneId: "Asia/Seoul",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const id of statusRecheck ? ["Q05", "Q09"] : ["Q04", "L01", "L02"]) {
      const row = report.queries.find((q) => q.id === id);
      const response = await page.goto(
        `${origin}/w/${fixture.workspaceId}/chat?conversation=${row.conversationId}`,
      );
      await expect(
        page.getByRole("button", { name: "답변 복사" }).first(),
      ).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      expect(overflow).toBe(false);
      report.browser.push({ id, width, status: response.status(), overflow });
      await page.screenshot({
        path: `${out}/${id.toLowerCase()}-${width}.png`,
        style: "nextjs-portal {visibility:hidden}",
      });
    }
  }
  expect(errors).toEqual([]);
  report.browserErrors = errors;
  report.completedAt = new Date().toISOString();
  save("results");
  console.log(
    `실제 검색 회귀 ${report.queries.length}개 완료: ${out}/results.json`,
  );
} catch (error) {
  report.failure = error.message;
  save(`failure-${Date.now()}`);
  throw error;
} finally {
  await browser?.close();
  await api.dispose();
  await pool.end();
}
