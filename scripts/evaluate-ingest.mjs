// Development-only, real-model ingest evaluation. Credentials stay in .local.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";
import { chromium, expect, request } from "@playwright/test";

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
const origin = "http://localhost:3010",
  base = `/api/workspaces/${fixture.workspaceId}`,
  root = `/w/${fixture.workspaceId}`;
const runName = process.env.INGEST_EVALUATION_RUN ?? "";
if (runName && !/^[a-z0-9][a-z0-9-]{0,60}$/.test(runName))
  throw new Error("평가 실행 이름을 확인하세요.");
const statePath = `.local/ingest-evaluation${runName ? `-${runName}` : ""}.json`,
  out = `docs/evaluation/core/ingest-12${runName ? `-${runName}` : ""}`;
mkdirSync(out, { recursive: true });
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : {};
const save = () =>
  writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
const revised = process.argv.includes("--revision") || !!state.revision;
const phase = revised ? "revision" : "initial";
state[phase] ??= {};
const current = state[phase],
  api = {};
let browser;
const json = async (response, status = 200) => {
  const data = await response.json();
  if (response.status() !== status)
    throw new Error(
      `평가 API ${response.status()}: ${data.error ?? "요청 실패"}`,
    );
  return data;
};
async function poll(read, done, limit = 900000) {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < limit) {
    const value = await read();
    const progress = `${value.state ?? value.version?.processing ?? "대기"}`;
    if (progress !== last) {
      console.log(`${phase} 정리: ${progress}`);
      last = progress;
    }
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("정리 평가 대기 시간 초과");
}
const getRun = async () => {
  const result = await json(
    await api.writer.get(
      `${base}/ingest-runs?sourceId=${state.sourceId}&sourceVersionId=${current.versionId}`,
    ),
  );
  return result.items[0] ?? { state: "등록 대기" };
};
const getTask = async (id) =>
  json(await api.writer.get(`${base}/ai-tasks/${id}`));
const original = readFileSync(
  "docs/evaluation/core/analysis-10/source.md",
  "utf8",
);
const contents = revised
  ? original.replace(
      "운영 기록은 30일 동안 보관합니다.",
      "운영 기록은 45일 동안 보관합니다.",
    )
  : original;
const fileHash = createHash("sha256").update(contents).digest("hex");
const reportPath = `${out}/${phase}.json`;
const report = {
  date: new Date().toISOString(),
  dataClassification: "직접 작성한 가상 개발 표본",
  businessReview: null,
  phase,
  fileHash,
};
const writeReport = () =>
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
try {
  for (const [role, account] of Object.entries(accounts)) {
    if (!account) throw new Error("개발 평가 계정 없음");
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
  if (revised && !state.initial?.published)
    throw new Error("첫 정리 결과를 검토·게시한 뒤 개정 평가를 실행하세요.");
  if (!state.domainId) {
    const domain = await json(
      await api.admin.post(`${base}/domains`, {
        data: {
          name: `가상 솔빛시 자동 정리 평가${runName ? ` · ${runName}` : ""}`,
          purpose:
            "관제 운영 원문의 적용 대상·수치·부정 조건을 보존하고 개정 이력을 검토합니다.",
          purposeGuide: {
            keyQuestions:
              "정상 갱신과 통신 단절 시 각각 어떤 조건을 적용하나요?",
            scopeIncluded: "이 개발 표본에 적힌 관제 화면·전원·보관 조건",
            scopeExcluded: "다른 도시와 사업의 기준",
            workingAssumptions:
              "가상 평가 자료이며 실제 사업의 승인 근거가 아닙니다.",
            successCriteria:
              "원문 근거와 기존 페이지 주소를 유지하고 바뀐 조건을 검토합니다.",
          },
          terms: [],
          recordTemplate: "상황\n판단과 이유\n결과\n추가 확인할 내용",
          autoIngest: true,
        },
      }),
      201,
    );
    state.domainId = domain.id;
    save();
  }
  if (!state.projectId) {
    state.projectId = (
      await json(
        await api.admin.post(`${base}/projects`, {
          data: {
            domainId: state.domainId,
            name: "가상 자동 정리 개정 평가",
            clientName: "가상 평가기관",
            description: "개발 표본으로 자동 정리와 개정 근거를 확인합니다.",
          },
        }),
        201,
      )
    ).id;
    save();
  }
  if (!current.versionId) {
    const uploaded = await json(
      await api.writer.post(
        `${base}/sources${state.sourceId ? `/${state.sourceId}` : ""}`,
        {
          multipart: {
            title: "가상 솔빛시 관제 운영 기준 · 자동 정리",
            domainId: state.domainId,
            projectId: state.projectId,
            category: "guideline",
            file: {
              name: revised ? "ingest-revision.md" : "ingest-initial.md",
              mimeType: "text/markdown",
              buffer: Buffer.from(contents),
            },
          },
        },
      ),
      201,
    );
    state.sourceId = uploaded.sourceId;
    current.versionId = uploaded.versionId;
    current.fileHash = fileHash;
    save();
  }
  expect(current.fileHash).toBe(fileHash);
  writeFileSync(`${out}/source-${phase}.md`, contents);
  const source = await poll(
    async () =>
      json(
        await api.writer.get(
          `${base}/sources/${state.sourceId}?version=${current.versionId}`,
        ),
      ),
    (s) => !["queued", "processing"].includes(s.version.processing),
  );
  expect(source.version.processing, source.version.errorMessage).toBe(
    "completed",
  );
  if (source.version.publication === "pending") {
    expect(
      (
        await json(
          await api.writer.get(
            `${base}/ingest-runs?sourceId=${state.sourceId}&sourceVersionId=${current.versionId}`,
          ),
        )
      ).items,
    ).toHaveLength(0);
    await json(
      await api.reviewer.post(
        `${base}/source-versions/${current.versionId}/action`,
        {
          data: {
            action: "approve",
            note: "가상 개발 표본의 원문·추출 범위를 확인했습니다.",
          },
        },
      ),
    );
  }
  let run = await getRun();
  if (
    process.argv.includes("--retry") &&
    ["failed", "canceled"].includes(run.state)
  )
    await json(
      await api.writer.patch(`${base}/ingest-runs/${run.id}`, {
        data: { action: "retry" },
      }),
    );
  run = await poll(getRun, (r) =>
    ["review", "completed", "failed", "outdated", "canceled"].includes(r.state),
  );
  Object.assign(current, {
    runId: run.id,
    analysisTaskId: run.analysisTaskId,
    generationTaskId: run.generationTaskId,
  });
  save();
  report.run = run;
  report.analysis = run.analysisTaskId
    ? await getTask(run.analysisTaskId)
    : null;
  report.generation = run.generationTaskId
    ? await getTask(run.generationTaskId)
    : null;
  report.durationMs = report.generation
    ? new Date(report.generation.updatedAt).getTime() -
      new Date(run.createdAt).getTime()
    : null;
  writeReport();
  expect(["review", "completed"], run.errorMessage).toContain(run.state);
  const batches = [];
  for (const group of run.groups)
    batches.push(
      await json(await api.writer.get(`${base}/proposals/${group.id}`)),
    );
  report.batches = batches;
  report.conditions = [
    "30초",
    "일괄 적용하지 않습니다",
    "8시간",
    revised ? "45일" : "30일",
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
  expect(report.conditions.every((c) => c.found)).toBe(true);
  const usage = [...report.analysis.usage, ...report.generation.usage];
  report.usage = {
    calls: usage.length,
    inputTokens: usage.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
    outputTokens: usage.reduce((n, r) => n + (r.outputTokens ?? 0), 0),
    unknown: usage.filter(
      (r) => r.inputTokens === null || r.outputTokens === null,
    ).length,
  };
  report.reuse = {
    analysisUnits: report.analysis.steps.filter(
      (s) => s.kind === "analyze" && s.reused,
    ).length,
    wikiPages: report.generation.steps.filter(
      (s) => s.kind === "generate-wiki" && s.reused,
    ).length,
  };
  report.evidence = [
    ...new Map(
      batches.flatMap((b) => b.evidence).map((e) => [e.id, e]),
    ).values(),
  ].map((e) => ({ id: e.id, versionId: e.versionId, current: e.available }));
  expect(
    report.evidence.every(
      (e) => e.current && e.versionId === current.versionId,
    ),
  ).toBe(true);
  if (revised) {
    const baseline = JSON.parse(readFileSync(`${out}/initial.json`, "utf8"));
    const oldIds = new Set(baseline.publication.map((p) => p.pageId));
    const items = batches.flatMap((b) => b.batch.items);
    report.stablePageIds = [...oldIds].map((pageId) => ({
      pageId,
      preserved:
        items.filter((i) => i.pageId === pageId && i.plannedPageId === pageId)
          .length === 1,
    }));
    expect(report.stablePageIds.every((p) => p.preserved)).toBe(true);
    report.additionalPages = items
      .filter((i) => i.kind === "new")
      .map((i) => ({
        pageId: i.plannedPageId,
        title: i.title,
        reason: i.reason,
      }));
    expect(
      items.filter((i) => i.pageId).every((i) => oldIds.has(i.pageId)),
    ).toBe(true);
    expect(report.reuse.analysisUnits).toBeGreaterThan(0);
  }
  writeReport();
  browser = await chromium.launch();
  const contexts = {};
  for (const role of ["writer", "reviewer", "reader"])
    contexts[role] = await browser.newContext({
      baseURL: origin,
      storageState: await api[role].storageState(),
      viewport: { width: 390, height: 900 },
    });
  const page = await contexts.writer.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  report.browser = [];
  for (const width of [1440, 390])
    for (const [view, url] of [
      ["source", `${root}/sources/${state.sourceId}`],
      ["task", `${root}/ai-tasks/${run.generationTaskId}`],
      ["review", `${root}/proposals/${batches[0].batch.id}`],
    ]) {
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.addStyleTag({
        content:
          "nextjs-portal{display:none!important}.app-header{position:static!important}",
      });
      await page.screenshot({
        path: `${out}/${phase}-${view}-${width}.png`,
        fullPage: true,
      });
      if (view === "source")
        await page
          .getByRole("region", { name: "자료 자동 정리" })
          .screenshot({ path: `${out}/${phase}-ingest-${width}.png` });
      report.browser.push({
        view,
        width,
        status: response.status(),
        overflow: await page.evaluate(() =>
          Math.max(0, document.documentElement.scrollWidth - innerWidth),
        ),
        errors: [...errors],
      });
    }
  if (process.argv.includes("--publish")) {
    const reviewer = await contexts.reviewer.newPage();
    const act = async (tab, id, name) => {
      await tab.goto(`${root}/proposals/${id}`);
      const result = tab.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().endsWith(`/proposals/${id}/action`),
      );
      await tab.getByRole("button", { name, exact: true }).click();
      await json(await result);
    };
    report.publication = [];
    for (const b of batches) {
      if (
        b.batch.items.some((i) => i.requiresResolution || i.kind === "conflict")
      )
        throw new Error("변경 조건을 대조·수정하고 확인한 뒤 게시하세요.");
      if (b.batch.state === "draft")
        await act(page, b.batch.id, "묶음 검토 요청");
      if (b.batch.state !== "approved")
        await act(reviewer, b.batch.id, "전체 변경 승인·게시");
      const approved = await json(
        await api.writer.get(`${base}/proposals/${b.batch.id}`),
      );
      for (const result of approved.batch.results) {
        const wiki = await json(
          await api.reader.get(`${base}/wiki/${result.pageId}`),
        );
        report.publication.push({
          ...result,
          title: wiki.version.title,
          body: wiki.version.body,
        });
        for (const link of wiki.version.metadata.links)
          await json(await api.reader.get(`${base}/wiki/${link.pageId}`));
      }
    }
    current.published = true;
    save();
    report.run = await poll(getRun, (r) => r.state === "completed");
    const before = [
      ...(await getTask(run.analysisTaskId)).usage,
      ...(await getTask(run.generationTaskId)).usage,
    ].length;
    const repeated = await json(
      await api.writer.post(`${base}/ingest-runs`, {
        data: { sourceId: state.sourceId },
      }),
      201,
    );
    const after = [
      ...(await getTask(run.analysisTaskId)).usage,
      ...(await getTask(run.generationTaskId)).usage,
    ].length;
    report.repeat = {
      sameRun: repeated.id === run.id,
      replay: repeated.replay,
      newCalls: after - before,
    };
    expect(report.repeat).toEqual({ sameRun: true, replay: true, newCalls: 0 });
    const reader = await contexts.reader.newPage();
    const response = await reader.goto(
      `${root}/wiki/${report.publication[0].pageId}`,
    );
    await expect(reader.getByRole("heading", { level: 1 })).toBeVisible();
    await reader.addStyleTag({
      content:
        "nextjs-portal{display:none!important}.app-header{position:static!important}",
    });
    await reader.screenshot({
      path: `${out}/${phase}-published-390.png`,
      fullPage: true,
    });
    report.browser.push({
      view: "published",
      width: 390,
      status: response.status(),
      overflow: await reader.evaluate(() =>
        Math.max(0, document.documentElement.scrollWidth - innerWidth),
      ),
      errors: [],
    });
  }
  writeReport();
  expect(
    report.browser.every(
      (v) => v.status === 200 && v.overflow === 0 && !v.errors.length,
    ),
  ).toBe(true);
  console.log(
    JSON.stringify(
      {
        phase,
        runId: run.id,
        analysisTaskId: run.analysisTaskId,
        generationTaskId: run.generationTaskId,
        conditions: report.conditions,
        reuse: report.reuse,
        usage: report.usage,
        published: !!current.published,
      },
      null,
      2,
    ),
  );
} finally {
  writeReport();
  await browser?.close();
  await Promise.all(Object.values(api).map((a) => a.dispose()));
}
