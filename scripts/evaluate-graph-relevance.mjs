// A synthetic graph-only discovery challenge using real accounts, approvals, indexing and the model.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";
import { chromium, expect, request } from "@playwright/test";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
const fixture = JSON.parse(readFileSync(".local/core-evaluation.json", "utf8"));
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
const path = ".local/graph-evaluation.json";
const state = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : { sources: {}, pages: {} };
const save = () =>
  writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
const origin = "http://localhost:3010",
  base = `/api/workspaces/${fixture.workspaceId}`,
  out = "docs/evaluation/core/graph-13-indirect";
mkdirSync(out, { recursive: true });
if (existsSync(`${out}/results.json`))
  throw new Error("완료한 평가가 있습니다.");
const api = {},
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let browser;
const report = {
  date: new Date().toISOString(),
  dataClassification:
    "직접 작성한 가상 개발 표본 · 검색어가 반복되는 목차와 두 단계 연결",
  businessReview: null,
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
const poll = async (fn, done) => {
  for (let i = 0; i < 120; i++) {
    const value = await fn();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("평가 대기 시간 초과");
};
async function source(key, title, body) {
  writeFileSync(`${out}/${key}.md`, body);
  if (!state.sources[key]) {
    state.sources[key] = await read(
      await api.writer.post(`${base}/sources`, {
        multipart: {
          title,
          domainId: state.domainId,
          projectId: "",
          category: "reference",
          file: {
            name: `${key}.md`,
            mimeType: "text/markdown",
            buffer: Buffer.from(body),
          },
        },
      }),
      201,
    );
    save();
  }
  const item = state.sources[key];
  const detail = await poll(
    async () =>
      read(
        await api.writer.get(
          `${base}/sources/${item.sourceId}?version=${item.versionId}`,
        ),
      ),
    (d) => ["completed", "failed"].includes(d.version.processing),
  );
  expect(detail.version.processing).toBe("completed");
  if (detail.version.publication !== "published")
    await read(
      await api.reviewer.post(
        `${base}/source-versions/${item.versionId}/action`,
        {
          data: {
            action: "approve",
            note: "직접 작성한 가상 검색 평가 원문 확인",
          },
        },
      ),
    );
  item.chunks = detail.chunks.map((c) => ({
    id: c.id,
    text: c.text,
    locator: c.locator,
  }));
  save();
  return item;
}
async function wiki(key, title, body, doc, type) {
  const evidence = doc.chunks.find((c) => !c.text.trim().startsWith("#"));
  if (!evidence) throw new Error("위키 본문을 뒷받침할 원문 문단이 없습니다.");
  if (!state.pages[key]) {
    state.pages[key] = await read(
      await api.writer.post(`${base}/wiki`, {
        data: {
          title,
          body,
          domainId: state.domainId,
          projectId: null,
          parentVersionId: null,
          basePublishedVersionId: null,
          chunkIds: [evidence.id],
          classification: { type, aliases: [] },
        },
      }),
      201,
    );
    save();
  }
  let item = state.pages[key];
  let detail = await read(
    await api.writer.get(
      `${base}/wiki/${item.pageId}?version=${item.versionId}`,
    ),
  );
  if (!detail.evidence.some((e) => e.id === evidence.id)) {
    item = await read(
      await api.writer.post(`${base}/wiki/${item.pageId}`, {
        data: {
          title,
          body,
          domainId: state.domainId,
          projectId: null,
          parentVersionId: detail.page.latestVersionId,
          basePublishedVersionId: detail.page.publishedVersionId,
          chunkIds: [evidence.id],
          classification: { type, aliases: [] },
        },
      }),
      201,
    );
    state.pages[key] = item;
    save();
    detail = await read(
      await api.writer.get(
        `${base}/wiki/${item.pageId}?version=${item.versionId}`,
      ),
    );
  }
  if (detail.version.state === "draft")
    await read(
      await api.writer.post(`${base}/wiki-versions/${item.versionId}/action`, {
        data: { action: "submit" },
      }),
    );
  if (detail.version.state !== "approved")
    await read(
      await api.reviewer.post(
        `${base}/wiki-versions/${item.versionId}/action`,
        {
          data: {
            action: "approve",
            note: "가상 원문과 위키의 명시적인 연결 대조",
          },
        },
      ),
    );
  return item;
}
try {
  for (const [role, account] of Object.entries(accounts)) {
    api[role] = await request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    });
    await read(
      await api[role].post("/api/auth/sign-in/email", {
        data: { email: account.email, password: account.password },
      }),
    );
  }
  if (!state.domainId) {
    state.domainId = (
      await read(
        await api.admin.post(`${base}/domains`, {
          data: {
            name: "간접 관계 검색 · 가상 표본",
            purpose:
              "반복되는 목차를 넘어서 연결된 원문의 보관 시간과 장애 예외를 찾는다. 이 목적 자체는 보관 시간의 근거가 아니다.",
            terms: [],
            recordTemplate: "확인할 내용",
          },
        }),
        201,
      )
    ).id;
    save();
  }
  const intro =
    "접수알파절차의 연결 안내를 따라 무엇을 확인해야 하는지는 후속 기준의 원문에서 확인합니다. 이 목차는 보관 시간이나 적용 예외를 정하지 않습니다.";
  const start = await source(
    "entry",
    "00 접수알파절차 연결 안내",
    Array.from(
      { length: 45 },
      (_, i) => `## 접수알파절차 연결 안내 ${i + 1}\n\n${intro}`,
    ).join("\n\n"),
  );
  const middle = await source(
    "bridge",
    "연결 문서의 관계 설명",
    "접수알파절차 이후의 확인은 ‘가상 후속 기준’의 보관 시간과 장애 예외를 대조하는 일입니다. 연결 안내 위키에서 해당 기준으로 이동합니다.",
  );
  const target = await source(
    "target",
    "가상 후속 기준",
    "검증 기록은 72시간 보관합니다. 장애가 난 장비에는 이 조건을 적용하지 않습니다. 정상 장비의 납품 이후 검증 기록에 적용합니다.",
  );
  expect(start.chunks.length).toBeGreaterThan(16);
  const z = await wiki(
    "target",
    "후속 검증 기준",
    "검증 기록은 72시간 보관합니다. 장애가 난 장비에는 이 조건을 적용하지 않습니다.",
    target,
    "concept",
  );
  const m = await wiki(
    "bridge",
    "확인 문서 안내",
    `접수알파절차 이후의 확인 사항은 [후속 검증 기준](/w/${fixture.workspaceId}/wiki/${z.pageId})의 원문에서 확인합니다.`,
    middle,
    "procedure",
  );
  await wiki(
    "entry",
    "접수알파절차 목차",
    `${intro}\n\n[확인 문서 안내](/w/${fixture.workspaceId}/wiki/${m.pageId})를 따릅니다.`,
    start,
    "procedure",
  );
  const targetIds = [
    ...Object.values(state.sources).flatMap((s) => s.chunks.map((c) => c.id)),
    ...Object.values(state.pages).map((p) => p.versionId),
  ];
  report.indexed = await poll(
    async () =>
      (
        await pool.query(
          "SELECT count(DISTINCT target_id)::int AS count FROM content_embedding WHERE workspace_id=$1 AND target_id=ANY($2::uuid[]) AND model LIKE '%:utf8-6000-mean-v1:full-body-v2'",
          [fixture.workspaceId, targetIds],
        )
      ).rows[0].count,
    (n) => n === targetIds.length,
  );
  report.fixture = {
    workspaceId: fixture.workspaceId,
    domainId: state.domainId,
    sources: state.sources,
    pages: state.pages,
  };
  for (const sourceOnly of [false, true]) {
    const question = "접수알파절차의 연결 안내를 따라 무엇을 확인해야 하나요?";
    const scope = {
      domainId: state.domainId,
      projectId: null,
      sourceId: null,
      wikiId: null,
      sourceOnly,
    };
    const conversation = await read(
      await api.reader.post(`${base}/conversations`, {
        data: { title: "간접 관계 실제 평가", scope },
      }),
      201,
    );
    const startTime = Date.now();
    const response = await api.reader.post(
      `${base}/conversations/${conversation.id}/stream`,
      { data: { requestId: randomUUID(), prompt: question }, timeout: 180000 },
    );
    expect(response.status()).toBe(200);
    await response.text();
    const detail = await read(
      await api.reader.get(`${base}/conversations/${conversation.id}`),
    );
    const run = detail.runs.at(-1);
    const row = {
      question,
      sourceOnly,
      conversationId: conversation.id,
      state: run.state,
      mode: run.retrievalMode,
      model: run.model,
      elapsedMs: Date.now() - startTime,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      answer: run.messages.find((m) => m.role === "assistant")?.body,
      citations: run.citations.map((c) => ({ ...c.snapshot, used: c.used })),
      links: [],
    };
    report.queries.push(row);
    writeFileSync(
      `${out}/partial.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    expect(row.state, run.errorMessage ?? row.answer).toBe("completed");
    for (const ref of row.citations.filter((c) => c.used)) {
      const status = (await api.reader.get(ref.href)).status();
      row.links.push({ href: ref.href, status });
      expect(status).toBe(200);
    }
    if (!sourceOnly) {
      expect(
        row.citations.slice(0, 8).some((r) => r.id === target.sourceId),
      ).toBe(false);
      expect(
        row.citations.some(
          (r) =>
            r.id === target.sourceId &&
            r.graph?.pages.some((p) => p.id === m.pageId),
        ),
      ).toBe(true);
      expect(row.answer).toContain("72시간");
      expect(row.answer).toContain("장애");
    } else {
      expect(row.citations.every((r) => r.kind === "source" && !r.graph)).toBe(
        true,
      );
      expect(row.citations.some((r) => r.id === target.sourceId)).toBe(false);
      expect(row.answer).not.toContain("72시간");
    }
    console.log(
      `원문만 ${sourceOnly}: ${row.state}, ${row.mode}, 관계 원문 ${row.citations.filter((r) => r.graph).length}, ${row.elapsedMs}ms`,
    );
  }
  browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: await api.reader.storageState(),
    viewport: { width: 390, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const row of report.queries) {
    const response = await page.goto(
      `${origin}/w/${fixture.workspaceId}/chat?conversation=${row.conversationId}`,
    );
    await expect(
      page.getByRole("button", { name: "답변 복사" }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${out}/${row.sourceOnly ? "source-only" : "graph"}-390.png`,
      style: "nextjs-portal {visibility:hidden}",
    });
    report.browser.push({
      sourceOnly: row.sourceOnly,
      status: response.status(),
      width: 390,
      overflow: false,
    });
  }
  expect(errors).toEqual([]);
  report.browserErrors = errors;
  report.completedAt = new Date().toISOString();
  writeFileSync(`${out}/results.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`실제 관계 비교 완료: ${out}/results.json`);
} catch (error) {
  report.failure = error.message;
  writeFileSync(
    `${out}/failure-${Date.now()}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  throw error;
} finally {
  await browser?.close();
  await Promise.all(Object.values(api).map((c) => c.dispose()));
  await pool.end();
}
