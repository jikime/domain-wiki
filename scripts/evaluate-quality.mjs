// Synthetic quality-review cases exercised through real accounts, worker, model and browser.
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
  writer: team.accounts.find((a) => a.role === "writer"),
  reviewer: team.accounts.find((a) => a.role === "reviewer"),
};
const path = ".local/quality-evaluation.json",
  out = "docs/evaluation/core/quality-14",
  origin = "http://localhost:3010",
  base = `/api/workspaces/${fixture.workspaceId}`,
  root = `/w/${fixture.workspaceId}`;
mkdirSync(out, { recursive: true });
const state = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : { sources: {}, pages: {}, runs: {} };
const save = () =>
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
const revised = process.argv.includes("--revision"),
  phase = revised ? "revision" : "initial";
if (existsSync(`${out}/${phase}.json`))
  throw new Error("완료한 평가 파일이 있습니다.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  api = {};
let browser;
const previousReport = existsSync(`${out}/${phase}-partial.json`)
  ? JSON.parse(readFileSync(`${out}/${phase}-partial.json`, "utf8"))
  : null;
const report = {
  date: new Date().toISOString(),
  phase,
  dataClassification:
    "직접 작성한 가상 개발 표본 · 동일 대상·시점의 30일/45일 상충, 45일 중복, 폐기 승인 담당자 설명 공백",
  businessReview: null,
  runs: [],
  views: [],
};
const read = async (r, status = 200) => {
  const d = await r.json();
  if (r.status() !== status)
    throw new Error(`평가 API ${r.status()}: ${d.error ?? "실패"}`);
  return d;
};
const wait = async (read, done) => {
  for (let i = 0; i < 300; i++) {
    const d = await read();
    if (done(d)) return d;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("점검 대기 시간 초과");
};
const body = (days) =>
  `기준일은 2026년 9월 1일입니다. 가상 검수 사업의 정상 장비는 납품일부터 운영 기록을 ${days}일 동안 보관합니다. 장애 장비에는 이 보관 기간을 적용하지 않습니다. 기간이 끝난 기록은 폐기 승인 후 삭제합니다.`;
async function doc(key, title, days, prior) {
  const content = `# ${title}\n\n${body(days)}\n`;
  writeFileSync(`${out}/${key}.md`, content);
  if (!state.sources[key]) {
    state.sources[key] = await read(
      await api.writer.post(
        `${base}/sources${prior ? `/${prior.sourceId}` : ""}`,
        {
          multipart: {
            title,
            domainId: state.domainId,
            projectId: "",
            category: "reference",
            file: {
              name: `${key}.md`,
              mimeType: "text/markdown",
              buffer: Buffer.from(content),
            },
          },
        },
      ),
      201,
    );
    save();
  }
  const s = state.sources[key];
  const d = await wait(
    async () =>
      read(
        await api.writer.get(
          `${base}/sources/${s.sourceId}?version=${s.versionId}`,
        ),
      ),
    (d) => ["completed", "failed"].includes(d.version.processing),
  );
  expect(d.version.processing).toBe("completed");
  if (d.version.publication !== "published")
    await read(
      await api.reviewer.post(`${base}/source-versions/${s.versionId}/action`, {
        data: {
          action: "approve",
          note: "직접 작성한 가상 품질 평가 원문의 대상·시점·조건 확인",
        },
      }),
    );
  s.chunks = d.chunks;
  save();
  return s;
}
async function wiki(key, title, days, doc, prior) {
  const evidence = doc.chunks.find((c) => c.text.includes(`기록을 ${days}일`));
  if (!evidence) throw new Error("원문 구간 없음");
  if (!state.pages[key]) {
    let detail;
    if (prior)
      detail = await read(await api.writer.get(`${base}/wiki/${prior.pageId}`));
    state.pages[key] = await read(
      await api.writer.post(`${base}/wiki${prior ? `/${prior.pageId}` : ""}`, {
        data: {
          domainId: state.domainId,
          projectId: null,
          title,
          body: body(days),
          parentVersionId: detail?.page.latestVersionId ?? null,
          basePublishedVersionId: detail?.page.publishedVersionId ?? null,
          chunkIds: [evidence.id],
          classification: { type: "concept", aliases: [] },
        },
      }),
      201,
    );
    save();
  }
  const p = state.pages[key];
  const d = await read(
    await api.writer.get(`${base}/wiki/${p.pageId}?version=${p.versionId}`),
  );
  if (d.version.state === "draft")
    await read(
      await api.writer.post(`${base}/wiki-versions/${p.versionId}/action`, {
        data: {
          action: "submit",
          note: "가상 원문의 현재 조건을 반영한 변경안",
        },
      }),
    );
  if (d.version.state !== "approved")
    await read(
      await api.reviewer.post(`${base}/wiki-versions/${p.versionId}/action`, {
        data: {
          action: "approve",
          note: "대상·기준일·보관 기간·장애 제외 구절을 가상 원문과 대조했습니다.",
        },
      }),
    );
  return p;
}
async function inspect(mode, key) {
  const started = Date.now();
  if (!state.runs[key]) {
    state.runs[key] = await read(
      await api.reviewer.post(`${base}/quality`, {
        data: {
          domainId: state.domainId,
          projectId: null,
          mode,
          requestId: randomUUID(),
          force: true,
        },
      }),
      201,
    );
    save();
  }
  let last = "";
  const d = await wait(
    async () => {
      const all = await read(
        await api.reviewer.get(`${base}/quality?domainId=${state.domainId}`),
      );
      const run = all.runs.find((r) => r.id === state.runs[key].id);
      if (run.state !== last) {
        console.log(`${phase} ${mode}: ${run.state}`);
        last = run.state;
      }
      return { all, run };
    },
    (d) => !["queued", "running"].includes(d.run.state),
  );
  const calls = await pool.query(
    "SELECT g.id,g.kind,g.state,g.model,g.input_tokens,g.output_tokens,g.error_message FROM quality_step s JOIN generation g ON g.id=s.generation_id WHERE s.run_id=$1 ORDER BY s.ordinal",
    [d.run.id],
  );
  const item = {
    ...d.run,
    elapsedMs:
      previousReport?.runs?.find((r) => r.id === d.run.id)?.elapsedMs ??
      Date.now() - started,
    reloadedCompletedRun: !!previousReport?.runs?.find(
      (r) => r.id === d.run.id,
    ),
    findings: d.all.findings.filter((f) => f.run_id === d.run.id),
    calls: calls.rows,
  };
  report.runs.push(item);
  writeFileSync(
    `${out}/${phase}-partial.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  expect(d.run.state, d.run.error_message ?? "점검 실패").toBe("completed");
  return d.all;
}
try {
  for (const [role, a] of Object.entries(accounts)) {
    api[role] = await request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    });
    await read(
      await api[role].post("/api/auth/sign-in/email", {
        data: { email: a.email, password: a.password },
      }),
    );
  }
  if (!state.domainId) {
    const d = await read(
      await api.admin.post(`${base}/domains`, {
        data: {
          name: "품질 점검 · 가상 검수 표본",
          purpose:
            "같은 대상과 같은 기준일의 보관 조건을 비교하고 중복 안내와 빠진 설명을 검토한다. 이 목적은 사실의 근거가 아니다.",
          purposeGuide: {
            keyQuestions:
              "보관이 끝난 기록의 폐기를 승인하는 담당자는 누구인가요?",
            scopeIncluded:
              "가상 검수 사업의 정상 장비 운영 기록 보관 및 폐기 절차",
            scopeExcluded: "장애 장비의 별도 복구 절차",
            workingAssumptions: "",
            successCriteria:
              "수치와 적용 예외를 그대로 보존하고 설명이 부족한 구절을 확인한다.",
          },
          terms: [],
          recordTemplate: "조건\n예외\n확인할 내용",
        },
      }),
      201,
    );
    state.domainId = d.id;
    save();
  }
  if (!revised) {
    const a = await doc("alpha", "가상 검수 원문 갑", 30),
      b = await doc("beta", "가상 검수 원문 을", 45);
    await wiki("alpha", "운영 기록 보관 안내", 30, a);
    await wiki("beta", "검수 기록 보관 기준", 45, b);
    await wiki("duplicate", "운영 기록 보관 요약", 45, b);
    await inspect("structural", "initial-structural");
    const d = await inspect("semantic", "initial-semantic");
    report.observed = {
      contradictions: d.findings.filter((f) => f.kind === "contradiction")
        .length,
      duplicates: d.findings.filter((f) => f.kind === "duplicate").length,
      purposeGaps: d.findings.filter((f) => f.kind === "purpose-gap").length,
    };
    expect(report.observed.contradictions).toBeGreaterThan(0);
    expect(report.observed.duplicates).toBeGreaterThan(0);
    const f = d.findings.find((f) => f.kind === "contradiction");
    state.contradictionId = f.id;
    save();
    if (!f.assignee_name)
      await read(
        await api.reviewer.post(`${base}/review-desk`, {
          data: {
            kind: "quality",
            targetId: f.id,
            action: "assign",
            assigneeId: accounts.reviewer.id,
            note: "두 가상 원문의 같은 기준일과 다른 보관 기간을 확인합니다.",
          },
        }),
        201,
      );
    if (f.state !== "deferred")
      await read(
        await api.reviewer.post(`${base}/review-desk`, {
          data: {
            kind: "quality",
            targetId: f.id,
            action: "defer",
            note: "원문 갑의 기간 개정과 해당 위키의 게시 검토를 기다립니다.",
          },
        }),
        201,
      );
  } else {
    const a = await doc(
      "alpha-revised",
      "가상 검수 원문 갑",
      45,
      state.sources.alpha,
    );
    const stale = await inspect("structural", "revision-stale");
    expect(
      stale.findings.some(
        (f) => f.kind === "stale-evidence" && f.state !== "resolved",
      ),
    ).toBe(true);
    await wiki(
      "alpha-revised",
      "운영 기록 보관 안내",
      45,
      a,
      state.pages.alpha,
    );
    await inspect("structural", "revision-structural");
    const d = await inspect("semantic", "revision-semantic");
    report.observed = {
      activeContradictions: d.findings.filter(
        (f) => f.kind === "contradiction" && f.present,
      ).length,
      duplicates: d.findings.filter((f) => f.kind === "duplicate" && f.present)
        .length,
      unreproduced: d.findings.filter(
        (f) => f.kind === "contradiction" && !f.present,
      ),
    };
    expect(report.observed.activeContradictions).toBe(0);
    for (const candidate of report.observed.unreproduced)
      await read(
        await api.reviewer.post(`${base}/review-desk`, {
          data: {
            kind: "quality",
            targetId: candidate.id,
            action: "resolve",
            note: "현재 게시 원문과 세 위키가 모두 45일로 일치하고 장애 장비 제외 조건이 유지됩니다. AI 미발견 표시와 별개로 직접 대조하여 해결했습니다.",
            fixedWikiId: state.pages["alpha-revised"].pageId,
          },
        }),
        201,
      );
  }
  const d = await read(
    await api.reviewer.get(`${base}/quality?domainId=${state.domainId}`),
  );
  report.finalFindings = d.findings;
  const links = [
    ...new Set(
      d.findings.flatMap((f) =>
        f.quotes.map((q) => `${root}/wiki/${q.pageId}?version=${q.versionId}`),
      ),
    ),
  ];
  report.links = [];
  for (const href of links) {
    const r = await api.reviewer.get(href);
    report.links.push({ href, status: r.status() });
    expect(r.status()).toBe(200);
  }
  browser = await chromium.launch();
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      baseURL: origin,
      storageState: await api.reviewer.storageState(),
      viewport: { width, height: 900 },
      timezoneId: "America/New_York",
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const [name, href] of [
      ["quality", `${root}/quality?domainId=${state.domainId}`],
      [
        "review",
        `${root}/reviews/desk?kind=quality&targetId=${state.contradictionId}`,
      ],
    ]) {
      const response = await page.goto(href);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      const file = `${phase}-${name}-${width}.png`;
      await page.screenshot({ path: `${out}/${file}`, fullPage: true });
      report.views.push({
        name,
        width,
        status: response.status(),
        overflow,
        errors: [...errors],
        file,
      });
      expect(response.status()).toBe(200);
      expect(overflow).toBe(false);
      expect(errors).toEqual([]);
    }
    await context.close();
  }
  report.events = (
    await pool.query(
      "SELECT kind,action,note,created_at FROM review_event WHERE workspace_id=$1 AND target_id IN(SELECT id FROM quality_finding WHERE domain_id=$2) ORDER BY created_at",
      [fixture.workspaceId, state.domainId],
    )
  ).rows;
  report.domainId = state.domainId;
  report.completedAt = new Date().toISOString();
  writeFileSync(`${out}/${phase}.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      phase,
      observed: report.observed,
      runs: report.runs.map((r) => ({
        id: r.id,
        state: r.state,
        calls: r.calls.length,
        input: r.calls.reduce((n, c) => n + (c.input_tokens ?? 0), 0),
        output: r.calls.reduce((n, c) => n + (c.output_tokens ?? 0), 0),
      })),
      views: report.views.length,
    }),
  );
} catch (e) {
  report.error = e.message;
  writeFileSync(
    `${out}/${phase}-failure-${Date.now()}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  throw e;
} finally {
  await browser?.close();
  for (const c of Object.values(api)) await c.dispose();
  await pool.end();
}
