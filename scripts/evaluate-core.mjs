// Development fixtures only. Credentials stay in .local and are never written to reports.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";
import { chromium, expect, request } from "@playwright/test";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
const phase = process.argv[2] ?? "baseline-09";
if (!/^[a-z0-9-]{1,40}$/.test(phase))
  throw new Error("평가 이름을 확인하세요.");
const initial = JSON.parse(
  readFileSync(".local/initial-accounts.json", "utf8"),
);
const team = JSON.parse(readFileSync(".local/content-accounts.json", "utf8"));
const accounts = {
  admin: initial.accounts.find((a) => a.isAdmin),
  reader: initial.accounts.find((a) => !a.isAdmin),
  writer: team.accounts.find((a) => a.role === "writer"),
  reviewer: team.accounts.find((a) => a.role === "reviewer"),
};
const origin = "http://localhost:3010",
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const manifestPath = process.argv.includes("--isolated")
    ? `.local/core-${phase}.json`
    : ".local/core-evaluation.json",
  out = `docs/evaluation/core/${phase}`;
mkdirSync(out, { recursive: true });
if (existsSync(`${out}/results.json`) && !process.argv.includes("--rerun"))
  throw new Error("이미 완료한 평가입니다. 새 단계 이름을 사용하세요.");
const api = {};
let browser;
const report = {
  phase,
  date: new Date().toISOString(),
  dataClassification: "직접 작성한 가상 개발 표본",
  businessReview: null,
  queries: [],
};
let fixture = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : null;
const save = () =>
  writeFileSync(manifestPath, `${JSON.stringify(fixture, null, 2)}\n`, {
    mode: 0o600,
  });
const json = async (response, expected = 200) => {
  const data = await response.json();
  if (response.status() !== expected)
    throw new Error(
      `평가 API ${response.status()}: ${data.error ?? "응답 확인 필요"}`,
    );
  return data;
};
const poll = async (fn, predicate, timeout = 120000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const d = await fn();
    if (predicate(d)) return d;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error("평가 작업 대기 시간 초과");
};
try {
  for (const [role, account] of Object.entries(accounts)) {
    if (!account) throw new Error("로컬 평가 계정이 없습니다.");
    api[role] = await request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    });
    await json(
      await api[role].post("/api/auth/sign-in/email", {
        data: { email: account.email, password: account.password },
      }),
    );
  }
  if (!fixture) {
    fixture = { workspaceId: randomUUID(), sources: {}, projects: {} };
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        "INSERT INTO workspace(id,name) VALUES($1,'핵심 기능 평가 · 개발 표본')",
        [fixture.workspaceId],
      );
      for (const [role, account] of Object.entries(accounts)) {
        const user = (
          await db.query("SELECT id FROM app_user WHERE email=$1", [
            account.email,
          ])
        ).rows[0];
        await db.query(
          "INSERT INTO membership(workspace_id,user_id,role,is_admin) VALUES($1,$2,$3,$4)",
          [
            fixture.workspaceId,
            user.id,
            ["writer", "reviewer"].includes(role) ? role : "reader",
            role === "admin",
          ],
        );
      }
      await db.query("COMMIT");
      save();
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  const base = `/api/workspaces/${fixture.workspaceId}`,
    root = `/w/${fixture.workspaceId}`;
  if (!fixture.domainId) {
    fixture.domainId = (
      await json(
        await api.admin.post(`${base}/domains`, {
          data: {
            name: "교통관제 업무",
            purpose:
              "가상의 사업 문서로 수치·부정문·예외·사업별 적용 범위와 작성자 진술을 구분한다.",
            terms: [
              {
                term: "ITS",
                definition: "지능형 교통체계",
                aliases: ["지능형교통체계"],
              },
            ],
            recordTemplate: "상황\n판단과 이유\n결과\n추가 확인할 내용",
          },
        }),
        201,
      )
    ).id;
    save();
  }
  for (const key of ["spring", "winter"]) {
    if (!fixture.projects[key]) {
      fixture.projects[key] = (
        await json(
          await api.admin.post(`${base}/projects`, {
            data: {
              domainId: fixture.domainId,
              name:
                key === "spring"
                  ? "가상 새봄시 관제 시범사업"
                  : "가상 겨울시 관제 사업",
              clientName: "가상 발주기관",
              description: "핵심 기능 비교용 개발 표본",
            },
          }),
          201,
        )
      ).id;
      save();
    }
  }
  const files = [
    "01-project-guide.md",
    "02-field-note.txt",
    "03-other-project.md",
  ];
  for (const [index, file] of files.entries()) {
    const original = readFileSync(`docs/evaluation/sources/${file}`);
    const hash = createHash("sha256").update(original).digest("hex");
    if (fixture.sources[file] && fixture.sources[file].fileHash !== hash)
      throw new Error(
        "평가 원문이 바뀌었습니다. 기준 버전을 보존하고 별도 개정 평가를 준비하세요.",
      );
    if (!fixture.sources[file]) {
      const projectId = fixture.projects[index === 2 ? "winter" : "spring"];
      let uploaded;
      if (index === 1) {
        uploaded = await json(
          await api.writer.post(`${base}/records`, {
            data: {
              title: "가상 새봄시 현장 점검 기록",
              domainId: fixture.domainId,
              projectId,
              rawNote: original.toString("utf8"),
              situation:
                "2번 가상 교차로의 통신 연결을 끊자 화면에 마지막 값이 남아 있었다.",
              reasoning:
                "마지막 수신 시각이 보이지 않아 담당자가 최신 정보로 오해할 수 있다고 판단했다.",
              result: "변경안은 아직 검토 중이며 반영 완료로 확인되지 않았다.",
              followUp: "재연결 후 새 데이터 수신 시각을 별도로 점검해야 한다.",
              chunkIds: [],
            },
          }),
          201,
        );
      } else
        uploaded = await json(
          await api.writer.post(`${base}/sources`, {
            multipart: {
              title:
                index === 0
                  ? "가상 새봄시 관제 시범사업 안내"
                  : "가상 겨울시 관제 사업 안내",
              domainId: fixture.domainId,
              projectId,
              category: "project",
              file: { name: file, mimeType: "text/markdown", buffer: original },
            },
          }),
          201,
        );
      fixture.sources[file] = {
        sourceId: uploaded.sourceId,
        versionId: uploaded.versionId,
        fileHash: hash,
      };
      save();
    }
    const sample = fixture.sources[file];
    const d = await poll(
      async () =>
        json(
          await api.writer.get(
            `${base}/sources/${sample.sourceId}?version=${sample.versionId}`,
          ),
        ),
      (d) => !["queued", "processing"].includes(d.version.processing),
    );
    expect(d.version.processing).toBe("completed");
    if (d.version.publication !== "published")
      await json(
        await api.reviewer.post(
          `${base}/source-versions/${sample.versionId}/action`,
          { data: { action: "approve", note: "가상의 고정 평가 원문 공개" } },
        ),
      );
  }
  const main = fixture.sources[files[0]];
  if (!fixture.wikiId) {
    const d = await json(
      await api.writer.get(`${base}/sources/${main.sourceId}`),
    );
    const chunk = d.chunks.find((c) => c.text.includes("30초 간격"));
    const saved = await json(
      await api.writer.post(`${base}/wiki`, {
        data: {
          title: "새봄시 관제 화면의 정상 갱신 조건",
          body: "가상 새봄시 관제 시범사업에서는 정상 통신 상태일 때 관제 화면을 30초 간격으로 갱신합니다. 이 조건을 모든 사업의 법적 의무로 일반화하지 않습니다.",
          domainId: fixture.domainId,
          projectId: fixture.projects.spring,
          chunkIds: [chunk.id],
          parentVersionId: null,
          basePublishedVersionId: null,
        },
      }),
      201,
    );
    fixture.wikiId = saved.pageId;
    fixture.wikiVersionId = saved.versionId;
    save();
  }
  const wiki = await json(
    await api.writer.get(`${base}/wiki/${fixture.wikiId}`),
  );
  if (wiki.version.state === "draft")
    await json(
      await api.writer.post(
        `${base}/wiki-versions/${fixture.wikiVersionId}/action`,
        { data: { action: "submit", note: "기준 위키 검토" } },
      ),
    );
  if (wiki.version.state !== "approved")
    await json(
      await api.reviewer.post(
        `${base}/wiki-versions/${fixture.wikiVersionId}/action`,
        {
          data: { action: "approve", note: "원문에 맞는 개발 평가 기준 위키" },
        },
      ),
    );
  // Wait for the real embedding worker so baseline comparisons use the same search mode.
  const expectedChunks =
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM source_chunk WHERE workspace_id=$1",
          [fixture.workspaceId],
        )
      ).rows[0].count,
    ) + 1;
  await poll(
    async () =>
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM content_embedding WHERE workspace_id=$1",
            [fixture.workspaceId],
          )
        ).rows[0].count,
      ),
    (n) => n >= expectedChunks,
  );
  report.fixture = { ...fixture, sourceFiles: files };
  report.role = "reader";
  report.retrievalLimit = 8;
  const questions = JSON.parse(
    readFileSync("docs/evaluation/questions.json", "utf8"),
  );
  for (const q of questions) {
    const scope = {
      domainId: fixture.domainId,
      projectId:
        q.scope === "교통관제 업무"
          ? null
          : q.scope.includes("겨울")
            ? fixture.projects.winter
            : fixture.projects.spring,
      sourceId: null,
      wikiId: null,
    };
    const conversation = await json(
      await api.reader.post(`${base}/conversations`, {
        data: { title: `${phase} ${q.id}`, scope },
      }),
      201,
    );
    const row = {
      id: q.id,
      question: q.question,
      scope,
      answerable: q.answerable,
      expectedClaims: q.expectedClaims,
      conversationId: conversation.id,
    };
    const begin = Date.now();
    for (const prompt of [q.previousQuestion, q.question].filter(Boolean)) {
      const response = await api.reader.post(
        `${base}/conversations/${conversation.id}/stream`,
        { data: { requestId: randomUUID(), prompt }, timeout: 180000 },
      );
      expect(response.status()).toBe(200);
      await response.text();
    }
    const detail = await json(
      await api.reader.get(`${base}/conversations/${conversation.id}`),
    );
    const run = detail.runs.at(-1);
    row.elapsedMs = Date.now() - begin;
    row.state = run.state;
    row.answer = run.messages.find((m) => m.role === "assistant")?.body ?? "";
    row.model = run.model;
    row.retrievalMode = run.retrievalMode;
    row.inputTokens = run.inputTokens;
    row.outputTokens = run.outputTokens;
    row.citations = run.citations.map((c) => ({
      key: c.key,
      used: c.used,
      ...c.snapshot,
    }));
    row.evidenceHits = q.evidence.map((e) => ({
      source: e.source,
      quote: e.quote,
      found: row.citations.some((c) => c.text.includes(e.quote)),
    }));
    row.sourceLinks = [];
    for (const ref of row.citations.filter((c) => c.used)) {
      const r = await api.reader.get(ref.href);
      row.sourceLinks.push({ href: ref.href, status: r.status() });
      expect(r.status()).toBe(200);
    }
    row.businessReview = null;
    report.queries.push(row);
    writeFileSync(
      `${out}/partial.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      `${q.id}: ${run.state}, 근거 ${row.evidenceHits.filter((h) => h.found).length}/${row.evidenceHits.length}, ${row.elapsedMs}ms`,
    );
  }
  const generated = await json(
    await api.writer.post(`${base}/generations`, {
      data: {
        action: "source",
        requestId: randomUUID(),
        sourceId: main.sourceId,
        targetPageId: fixture.wikiId,
        chunkIds: [],
      },
      timeout: 180000,
    }),
    201,
  );
  const batch = await json(
    await api.writer.get(`${base}/proposals/${generated.batchId}`),
  );
  report.singleProposal = {
    generationId: generated.id,
    batchId: generated.batchId,
    state: batch.batch?.state ?? batch.state,
    items: batch.batch?.items ?? batch.items,
    businessReview: null,
  };
  const summary = await json(
    await api.writer.post(`${base}/ai-tasks`, {
      data: { requestId: randomUUID(), sourceId: main.sourceId },
    }),
    201,
  );
  const completed = await poll(
    async () => json(await api.writer.get(`${base}/ai-tasks/${summary.id}`)),
    (d) => ["completed", "failed"].includes(d.state),
    180000,
  );
  report.backgroundTask = completed;
  expect(completed.state).toBe("completed");
  report.profile = (
    await pool.query(
      "SELECT profile,prompt_version,rules_hash FROM ai_task WHERE id=$1",
      [summary.id],
    )
  ).rows[0];
  const finalStats = await pool.query(
    "SELECT parser_version,sha256 FROM source_version WHERE workspace_id=$1 ORDER BY source_id",
    [fixture.workspaceId],
  );
  report.parsers = finalStats.rows;
  browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: await api.writer.storageState(),
  });
  const page = await context.newPage();
  report.browser = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      `${root}/ai-tasks/${summary.id}`,
      `${root}/sources/${main.sourceId}`,
    ]) {
      const r = await page.goto(origin + route);
      await expect(page.locator("main h1")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      report.browser.push({ width, route, status: r.status(), overflow });
      expect(overflow).toBe(false);
      if (width === 390 && route.includes("ai-tasks"))
        await page.screenshot({
          path: `${out}/task-mobile.png`,
          fullPage: true,
          style: "nextjs-portal {visibility:hidden}",
        });
    }
  }
  report.completedAt = new Date().toISOString();
  writeFileSync(`${out}/results.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      phase,
      questions: report.queries.length,
      backgroundTask: completed.state,
      output: `${out}/results.json`,
    }),
  );
} finally {
  await browser?.close();
  await Promise.all(Object.values(api).map((c) => c.dispose()));
  await pool.end();
}
