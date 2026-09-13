// Real-model development evaluation. Credentials remain in .local.
// Reuses the completed stage-10 source and analysis; new attempts are explicit.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";
import { chromium, expect, request } from "@playwright/test";

nextEnv.loadEnvConfig(process.cwd());
const fixture = JSON.parse(readFileSync(".local/core-evaluation.json", "utf8"));
const analysis = JSON.parse(
  readFileSync(".local/analysis-evaluation.json", "utf8"),
);
const initial = JSON.parse(
  readFileSync(".local/initial-accounts.json", "utf8"),
);
const team = JSON.parse(readFileSync(".local/content-accounts.json", "utf8"));
const accounts = {
  writer: team.accounts.find((a) => a.role === "writer"),
  reviewer: team.accounts.find((a) => a.role === "reviewer"),
  reader: initial.accounts.find((a) => !a.isAdmin),
};
const origin = "http://localhost:3010",
  base = `/api/workspaces/${fixture.workspaceId}`,
  root = `/w/${fixture.workspaceId}`;
const out = "docs/evaluation/core/generation-11",
  statePath = ".local/generation-evaluation.json";
mkdirSync(out, { recursive: true });
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : {};
const save = () =>
  writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
const api = {};
let browser;
const json = async (r, status = 200) => {
  const d = await r.json();
  if (r.status() !== status)
    throw new Error(`평가 API ${r.status()}: ${d.error ?? "오류"}`);
  return d;
};
const getTask = () =>
  api.writer.get(`${base}/ai-tasks/${state.taskId}`).then((r) => json(r));
try {
  for (const [role, a] of Object.entries(accounts)) {
    if (!a) throw new Error("로컬 평가 계정 없음");
    api[role] = await request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    });
    await json(
      await api[role].post("/api/auth/sign-in/email", {
        data: { email: a.email, password: a.password },
      }),
    );
  }
  const parent = await json(
    await api.writer.get(`${base}/ai-tasks/${analysis.taskId}`),
  );
  expect(parent.state).toBe("completed");
  expect(parent.current).toBe(true);
  if (state.taskId && process.argv.includes("--new-task")) {
    const old = await getTask();
    if (["waiting", "queued", "running"].includes(old.state))
      throw new Error("이전 작업이 아직 실행 중입니다.");
    writeFileSync(
      `${out}/attempt-${state.taskId}.json`,
      `${JSON.stringify(old, null, 2)}\n`,
    );
    state.previousTasks = [...(state.previousTasks ?? []), state.taskId];
    state.taskId = null;
    save();
  }
  if (!state.taskId) {
    const t = await json(
      await api.writer.post(`${base}/ai-tasks`, {
        data: {
          requestId: randomUUID(),
          sourceId: analysis.sourceId,
          kind: "wiki-generation",
          analysisTaskId: analysis.taskId,
        },
      }),
      201,
    );
    state.taskId = t.id;
    state.analysisTaskId = analysis.taskId;
    save();
  }
  if (process.argv.includes("--retry")) {
    const t = await getTask();
    if (["failed", "canceled"].includes(t.state))
      await json(
        await api.writer.patch(`${base}/ai-tasks/${state.taskId}`, {
          data: { action: "retry" },
        }),
      );
  }
  let task,
    last = "";
  const started = Date.now();
  do {
    task = await getTask();
    const progress = `${task.state}: ${task.steps.filter((s) => s.state === "completed").length}/${task.steps.length}단계`;
    if (progress !== last) {
      console.log(`위키 생성 ${progress}`);
      last = progress;
    }
    if (["completed", "failed", "canceled"].includes(task.state)) break;
    if (Date.now() - started > 900000)
      throw new Error("평가 작업 대기 시간 초과");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (!["completed", "failed", "canceled"].includes(task.state));
  const report = {
    date: new Date().toISOString(),
    dataClassification: "직접 작성한 가상 개발 표본",
    businessReview: null,
    task,
  };
  const writeReport = () =>
    writeFileSync(
      `${out}/results.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
  writeReport();
  expect(task.state, task.errorMessage ?? "위키 생성 완료").toBe("completed");
  const batches = [];
  for (const g of task.groups)
    batches.push(await json(await api.writer.get(`${base}/proposals/${g.id}`)));
  report.batches = batches;
  report.conditions = [
    "30초",
    "일괄 적용하지 않습니다",
    "8시간",
    "30일",
    "90초",
    "자동 갱신을 금지",
  ].map((text) => ({
    text,
    found: batches.some((b) =>
      b.batch.items.some((i) =>
        i.body.replace(/\s+/g, "").includes(text.replace(/\s+/g, "")),
      ),
    ),
  }));
  report.claimCoverage = {
    analysisClaims: parent.result.claims.length,
    summaryClaims: new Set(
      batches.flatMap((b) =>
        b.batch.items
          .filter((i) => i.metadata?.type === "source")
          .flatMap((i) => i.claimIds ?? []),
      ),
    ).size,
  };
  report.usage = {
    calls: task.usage.length,
    inputTokens: task.usage.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
    outputTokens: task.usage.reduce((n, r) => n + (r.outputTokens ?? 0), 0),
    unknown: task.usage.filter(
      (r) => r.inputTokens === null || r.outputTokens === null,
    ).length,
  };
  report.sourceLinkChecks = [];
  for (const e of [
    ...new Map(
      batches.flatMap((b) => b.evidence).map((e) => [e.id, e]),
    ).values(),
  ]) {
    const r = await api.writer.get(
      `${root}/sources/${e.sourceId}?version=${e.versionId}#chunk-${e.id}`,
    );
    report.sourceLinkChecks.push({ id: e.id, status: r.status() });
    expect(r.status()).toBe(200);
  }
  writeReport();
  expect(report.conditions.every((c) => c.found)).toBe(true);
  expect(report.claimCoverage.summaryClaims).toBe(
    report.claimCoverage.analysisClaims,
  );
  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: origin,
    storageState: await api.writer.storageState(),
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  report.browser = [];
  for (const width of [1440, 390])
    for (const [view, href] of [
      ["task", `${root}/ai-tasks/${task.id}`],
      ["review", `${root}/proposals/${batches[0].batch.id}`],
    ]) {
      await page.setViewportSize({ width, height: 900 });
      const r = await page.goto(href);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.addStyleTag({
        content:
          "nextjs-portal{display:none!important}.app-header{position:static!important}",
      });
      report.browser.push({
        width,
        view,
        status: r.status(),
        overflow: await page.evaluate(() =>
          Math.max(0, document.documentElement.scrollWidth - innerWidth),
        ),
        errors: [...errors],
      });
      await page.screenshot({
        path: `${out}/${view}-${width}.png`,
        fullPage: true,
      });
    }
  if (process.argv.includes("--publish")) {
    const reviewerContext = await browser.newContext({
      baseURL: origin,
      storageState: await api.reviewer.storageState(),
      viewport: { width: 390, height: 900 },
    });
    const reviewerPage = await reviewerContext.newPage();
    const submit = async (tab, id, label, note = "") => {
      await tab.goto(`${root}/proposals/${id}`);
      if (note)
        await tab
          .getByRole("textbox", { name: "검토 의견 (반려 시 필수)" })
          .fill(note);
      const response = tab.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().endsWith(`/proposals/${id}/action`),
      );
      await tab.getByRole("button", { name: label, exact: true }).click();
      await json(await response);
    };
    for (const b of batches) {
      if (b.batch.state === "approved") continue;
      if (
        b.batch.items.some((i) => i.kind === "conflict" || i.requiresResolution)
      )
        throw new Error("확인과 수정이 필요한 변경안이 있습니다.");
      if (b.batch.state === "draft")
        await submit(page, b.batch.id, "묶음 검토 요청");
      await submit(
        reviewerPage,
        b.batch.id,
        "전체 변경 승인·게시",
        "가상 장문 개발 표본의 수치·부정·예외·원문 근거를 대조했습니다. 고객 업무 판정은 아닙니다.",
      );
      await expect(
        reviewerPage.getByRole("heading", { name: "게시된 위키", exact: true }),
      ).toBeVisible();
    }
    report.task = await getTask();
    report.publication = [];
    for (const g of report.task.groups)
      for (const result of g.results) {
        const d = await json(
          await api.reader.get(`${base}/wiki/${result.pageId}`),
        );
        expect(d.version.state).toBe("approved");
        const checks = [];
        for (const l of d.version.metadata.links) {
          const r = await api.reader.get(`${base}/wiki/${l.pageId}`);
          checks.push({ id: l.pageId, status: r.status() });
          expect(r.status()).toBe(200);
        }
        report.publication.push({
          pageId: result.pageId,
          versionId: result.versionId,
          title: d.version.title,
          links: checks,
        });
      }
    const readerContext = await browser.newContext({
      baseURL: origin,
      storageState: await api.reader.storageState(),
      viewport: { width: 390, height: 900 },
    });
    const readerPage = await readerContext.newPage();
    readerPage.on("pageerror", (e) => errors.push(e.message));
    const published = report.publication[0];
    const response = await readerPage.goto(`${root}/wiki/${published.pageId}`);
    await expect(
      readerPage.getByRole("heading", { name: published.title, exact: true }),
    ).toBeVisible();
    await readerPage.addStyleTag({
      content:
        "nextjs-portal{display:none!important}.app-header{position:static!important}",
    });
    await readerPage.screenshot({
      path: `${out}/published-390.png`,
      fullPage: true,
    });
    report.browser.push({
      width: 390,
      view: "published",
      status: response.status(),
      overflow: await readerPage.evaluate(() =>
        Math.max(0, document.documentElement.scrollWidth - innerWidth),
      ),
      errors: [...errors],
    });
    if (published.links.length) {
      await readerPage
        .locator(
          `.wiki-markdown a[href="${root}/wiki/${published.links[0].id}"]`,
        )
        .click();
      await expect(readerPage).toHaveURL(new RegExp(published.links[0].id));
      await expect(readerPage.getByRole("heading", { level: 1 })).toBeVisible();
    }
  }
  writeReport();
  expect(
    report.browser.every(
      (r) => r.status === 200 && r.overflow === 0 && r.errors.length === 0,
    ),
  ).toBe(true);
  console.log(
    JSON.stringify(
      {
        taskId: task.id,
        pages: task.groups.reduce((n, g) => n + g.pages.length, 0),
        groups: task.groups.length,
        conditions: report.conditions,
        usage: report.usage,
        browser: report.browser,
        published: report.publication?.length ?? 0,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await Promise.all(Object.values(api).map((c) => c.dispose()));
}
