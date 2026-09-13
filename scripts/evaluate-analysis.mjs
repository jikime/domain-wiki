// Real-model development evaluation. Reuses only its own immutable fixture and task.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";
import { chromium, expect, request } from "@playwright/test";

nextEnv.loadEnvConfig(process.cwd());
const out = "docs/evaluation/core/analysis-10";
mkdirSync(out, { recursive: true });
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
const origin = "http://localhost:3010",
  base = `/api/workspaces/${fixture.workspaceId}`,
  root = `/w/${fixture.workspaceId}`;
const statePath = ".local/analysis-evaluation.json";
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : {};
const save = () =>
  writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
const repeated =
  "읽기 연습용 문장입니다. 이 문장은 새로운 수치나 업무 요구를 정하지 않습니다. ".repeat(
    260,
  );
const original = Buffer.from(
  `# 가상 솔빛시 관제 운영 기준 — 긴 문서 개발 표본\n\n이 문서는 실제 사업과 무관한 가상 평가 자료입니다.\n\n## 관제 화면\n\n관제 화면은 30초마다 갱신합니다. 모든 화면에 일괄 적용하지 않습니다.\n\n${repeated}\n\n## 전원과 현장 확인\n\n비상 전원은 8시간 동안 유지해야 합니다. 현장 직원의 구두 설명만으로 검수를 완료하지 않습니다.\n\n${repeated}\n\n## 보관 및 마지막 조건\n\n운영 기록은 30일 동안 보관합니다. 다른 사업의 보관 기간으로 바꾸지 않습니다.\n\n${repeated}\n\n### 문서 마지막의 표\n\n| 적용 대상 | 갱신 간격 |\n| --- | --- |\n| 보조 화면 | 90초 |\n\n[^1]: 통신 단절 상태에서는 자동 갱신을 금지합니다. 재연결 후 새 데이터 수신을 확인해야 합니다.\n`,
);
const hash = createHash("sha256").update(original).digest("hex");
if (state.fileHash && state.fileHash !== hash)
  throw new Error("평가 파일이 변경되었습니다. 기존 표본을 보존하세요.");
writeFileSync(`${out}/source.md`, original);
const api = {};
let browser;
const json = async (r, status = 200) => {
  const d = await r.json();
  if (r.status() !== status)
    throw new Error(`평가 API ${r.status()}: ${d.error ?? "오류"}`);
  return d;
};
async function poll(fn, ready, timeout = 600000) {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeout) {
    const d = await fn();
    if (d.state && d.state !== last) {
      last = d.state;
      console.log(`분석 상태: ${d.state}`);
    }
    if (ready(d)) return d;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("평가 대기 시간 초과");
}
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
  if (!state.projectId) {
    state.projectId = (
      await json(
        await api.admin.post(`${base}/projects`, {
          data: {
            domainId: fixture.domainId,
            name: "가상 솔빛시 장문 분석",
            clientName: "가상 평가기관",
            description: "문서 끝과 표·각주의 조건을 검사하는 개발 표본",
          },
        }),
        201,
      )
    ).id;
    save();
  }
  if (!state.sourceId) {
    const uploaded = await json(
      await api.writer.post(`${base}/sources`, {
        multipart: {
          title: "가상 솔빛시 관제 운영 기준 · 긴 문서",
          domainId: fixture.domainId,
          projectId: state.projectId,
          category: "guideline",
          file: {
            name: "long-analysis.md",
            mimeType: "text/markdown",
            buffer: original,
          },
        },
      }),
      201,
    );
    Object.assign(state, {
      sourceId: uploaded.sourceId,
      versionId: uploaded.versionId,
      fileHash: hash,
    });
    save();
  }
  let source = await poll(
    async () =>
      json(
        await api.writer.get(
          `${base}/sources/${state.sourceId}?version=${state.versionId}`,
        ),
      ),
    (d) => !["queued", "processing"].includes(d.version.processing),
  );
  if (
    ["failed", "canceled"].includes(source.version.processing) &&
    process.argv.includes("--retry")
  ) {
    await json(
      await api.writer.post(
        `${base}/source-versions/${state.versionId}/action`,
        { data: { action: "retry" } },
      ),
    );
    source = await poll(
      async () =>
        json(
          await api.writer.get(
            `${base}/sources/${state.sourceId}?version=${state.versionId}`,
          ),
        ),
      (d) => !["queued", "processing"].includes(d.version.processing),
    );
  }
  expect(
    source.version.processing,
    source.version.errorMessage ?? "추출 완료",
  ).toBe("completed");
  if (source.version.publication !== "published")
    await json(
      await api.reviewer.post(
        `${base}/source-versions/${state.versionId}/action`,
        { data: { action: "approve", note: "가상 장문 평가 표본 공개" } },
      ),
    );
  if (state.taskId && process.argv.includes("--new-task")) {
    const previous = await json(
      await api.writer.get(`${base}/ai-tasks/${state.taskId}`),
    );
    if (["waiting", "queued", "running"].includes(previous.state))
      throw new Error("이전 평가 작업이 아직 실행 중입니다.");
    writeFileSync(
      `${out}/attempt-${state.taskId}.json`,
      JSON.stringify(previous, null, 2),
    );
    state.previousTasks = [...(state.previousTasks ?? []), state.taskId];
    state.taskId = null;
    save();
  }
  if (!state.taskId) {
    const task = await json(
      await api.writer.post(`${base}/ai-tasks`, {
        data: {
          sourceId: state.sourceId,
          requestId: randomUUID(),
          kind: "analysis",
        },
      }),
      201,
    );
    state.taskId = task.id;
    state.startedAt = new Date().toISOString();
    save();
  }
  if (process.argv.includes("--retry")) {
    const task = await json(
      await api.writer.get(`${base}/ai-tasks/${state.taskId}`),
    );
    if (["failed", "canceled"].includes(task.state))
      await json(
        await api.writer.patch(`${base}/ai-tasks/${state.taskId}`, {
          data: { action: "retry" },
        }),
      );
  }
  const task = await poll(
    async () => json(await api.writer.get(`${base}/ai-tasks/${state.taskId}`)),
    (d) => ["completed", "failed", "canceled"].includes(d.state),
  );
  const report = {
    date: new Date().toISOString(),
    dataClassification: "직접 작성한 가상 개발 표본",
    businessReview: null,
    sourceBytes: original.length,
    sourceChars: original.toString().length,
    fileHash: hash,
    startedAt: state.startedAt,
    task,
  };
  writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2));
  expect(task.state, task.errorMessage ?? "작업 완료").toBe("completed");
  const required = [
    "30초",
    "일괄 적용하지 않습니다",
    "8시간",
    "30일",
    "90초",
    "자동 갱신을 금지",
  ];
  report.conditions = required.map((text) => ({
    text,
    found: task.result.claims.some((c) =>
      c.evidence.some((e) => e.quote.includes(text)),
    ),
  }));
  const refs = [
    ...new Set(
      task.result.claims.flatMap((c) => c.evidence.map((e) => e.chunkId)),
    ),
  ];
  const sourceUrl = `${root}/sources/${state.sourceId}?version=${state.versionId}`;
  report.sourceLinkChecks = [];
  for (const id of refs) {
    const r = await api.writer.get(`${sourceUrl}#chunk-${id}`);
    report.sourceLinkChecks.push({ chunkId: id, status: r.status() });
    expect(r.status()).toBe(200);
  }
  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: origin,
    storageState: await api.writer.storageState(),
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  report.browser = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const r = await page.goto(`${root}/ai-tasks/${task.id}`);
    await expect(
      page.getByText("전체 분석 완료", { exact: true }),
    ).toBeVisible();
    await page
      .locator(".analysis-unit")
      .last()
      .locator(":scope > summary")
      .click();
    report.browser.push({
      width,
      status: r.status(),
      overflow: await page.evaluate(() =>
        Math.max(0, document.documentElement.scrollWidth - innerWidth),
      ),
      errors: [...errors],
    });
    await page.evaluate(() => {
      document.activeElement?.blur?.();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.screenshot({
      path: `${out}/analysis-${width}.png`,
      fullPage: true,
    });
  }
  report.executionSeconds =
    (new Date(task.updatedAt) - new Date(task.createdAt)) / 1000;
  report.usage = {
    calls: task.usage.length,
    inputTokens: task.usage.reduce((n, u) => n + (u.inputTokens ?? 0), 0),
    outputTokens: task.usage.reduce((n, u) => n + (u.outputTokens ?? 0), 0),
    unknown: task.usage.filter(
      (u) => u.inputTokens === null || u.outputTokens === null,
    ).length,
  };
  writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2));
  expect(report.conditions.every((c) => c.found)).toBe(true);
  expect(
    report.browser.every(
      (b) => b.status === 200 && b.overflow === 0 && !b.errors.length,
    ),
  ).toBe(true);
  console.log(
    JSON.stringify({
      state: task.state,
      coverage: task.result.coverage,
      conditions: report.conditions,
      usage: report.usage,
      executionSeconds: report.executionSeconds,
    }),
  );
} finally {
  await browser?.close();
  await Promise.all(Object.values(api).map((c) => c.dispose()));
}
