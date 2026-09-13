// Real model and browser rehearsal, restricted to this development deployment.
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, expect, request } from "@playwright/test";
import { deployment, hash } from "./lib/deployment.mjs";

const [mode, profile, phase = "initial", originProfile = profile] =
  process.argv.slice(2);
if (
  !/^wiki-stage16-/.test(profile ?? "") ||
  !/^wiki-stage16-/.test(originProfile ?? "") ||
  ![
    "prepare",
    "publish",
    "quality",
    "defer",
    "defer-semantic",
    "verify",
  ].includes(mode) ||
  !["initial", "revision"].includes(phase)
)
  throw new Error("16단계 개발 리허설 인수를 확인하세요.");
const target = deployment(profile),
  original = deployment(originProfile);
const admin = JSON.parse(
  readFileSync(join(original.folder, "initial-admin.json"), "utf8"),
);
const { workspaceId } = JSON.parse(
  readFileSync(join(original.folder, "workspace.json"), "utf8"),
);
const file = join(original.folder, "core-rehearsal.json"),
  out =
    process.env.CORE_DEPLOYMENT_OUTPUT || "docs/evaluation/core/deployment-16";
mkdirSync(out, { recursive: true });
const state = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : { accounts: {}, initial: {}, revision: {} };
const current = state[phase],
  origin = target.env.BETTER_AUTH_URL,
  base = `/api/workspaces/${workspaceId}`,
  root = `/w/${workspaceId}`;
const save = () =>
  writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
const reportFile = `${out}/${phase}.json`;
const report = existsSync(reportFile)
  ? JSON.parse(readFileSync(reportFile, "utf8"))
  : {
      date: new Date().toISOString(),
      phase,
      profile,
      businessReview: null,
      views: [],
      queries: [],
    };
const saveReport = () =>
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
const clients = {},
  pages = {},
  errors = [];
let browser;
async function json(response, status = 200) {
  const value = await response.json();
  expect(response.status(), value.error ?? "요청 실패").toBe(status);
  return value;
}
async function login(role, account) {
  const sessionFile = join(target.folder, `${role}-browser-session.json`);
  const api = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
    ...(existsSync(sessionFile) ? { storageState: sessionFile } : {}),
  });
  clients[role] = api;
  const session = await (await api.get("/api/auth/get-session")).json();
  if (session?.user?.email !== account.email) {
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await api.post("/api/auth/sign-in/email", {
        data: { email: account.email, password: account.password },
      });
      if (response.status() !== 429) break;
      console.log("로그인 요청 제한 시간 후 다시 시도합니다.");
      await new Promise((r) =>
        setTimeout(
          r,
          Math.min(
            60,
            Math.max(1, Number(response.headers()["retry-after"]) || 60),
          ) * 1000,
        ),
      );
    }
    await json(response);
  }
  writeFileSync(sessionFile, JSON.stringify(await api.storageState()), {
    mode: 0o600,
  });
  const ctx = await browser.newContext({
    baseURL: origin,
    storageState: await api.storageState(),
    viewport: { width: 390, height: 900 },
    timezoneId: "Asia/Seoul",
  });
  pages[role] = await ctx.newPage();
  pages[role].on("pageerror", (e) => errors.push(e.message));
}
async function wait(read, done) {
  const start = Date.now();
  let last;
  while (Date.now() - start < 900000) {
    const value = await read();
    const status = value.state ?? value.version?.processing;
    if (status && last !== status) {
      console.log(`${phase}: ${status}`);
      last = status;
    }
    if (done(value)) return value;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("리허설 작업 대기 시간 초과");
}
async function action(role, url, endpoint, label) {
  const page = pages[role];
  await page.goto(url);
  const button = page.getByRole("button", { name: label, exact: true });
  const form = button.locator("xpath=ancestor::form");
  await form
    .locator("textarea")
    .fill(
      "가상 운영 리허설 원문의 수치·조건·부정문과 현재 버전 근거를 직접 대조했습니다.",
    );
  const response = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith(endpoint),
  );
  await button.click();
  return json(await response);
}
async function view(name, path, role = "reader") {
  const page = pages[role];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    if (name === "graph") {
      await expect(page.getByText(/개 중 \d+개 표시 · 연결/)).toBeVisible({
        timeout: 25000,
      });
      if (mode === "verify")
        await expect(
          page.locator('.sigma-container[data-ready="true"]'),
        ).toHaveAttribute("data-node-count", "3");
    }
    await page.screenshot({
      path: `${out}/${profile}-${phase}-${name}-${width}.png`,
      fullPage: true,
    });
    const overflow = await page.evaluate(() =>
      Math.max(0, document.documentElement.scrollWidth - innerWidth),
    );
    expect(response.status()).toBe(200);
    expect(overflow).toBe(0);
    expect(errors).toEqual([]);
    report.views.push({
      name,
      width,
      status: response.status(),
      overflow,
      errors: [...errors],
    });
  }
}
const contents = `# 가상 은하군 관제 운영 지침\n\n개발용 가상 표본이며 실제 고객 지침이나 법적 기준이 아닙니다. 이 지침은 가상 은하군의 시범 교차로 두 곳에만 적용합니다.\n\n## 정상 갱신\n정상 통신 상태에서는 관제 화면을 ${phase === "revision" ? "45" : "30"}초 간격으로 갱신합니다. 통신 장애 중에는 이 갱신 기준을 충족했다고 판정하지 않습니다.\n\n## 통신 중단과 재연결\n통신이 끊기면 마지막 수신 시각과 통신 중단 표시를 함께 보여 줍니다. 마지막 수신 값을 최신 값으로 표시하면 안 됩니다. 재연결 후 60초 안에 새 데이터 수신 여부를 확인합니다.\n\n## 점검 기록\n이 시범사업의 정상 장비 점검 기록은 72시간 보관합니다. 장애 장비의 기록에는 이 보관 기간을 적용하지 않습니다. 담당자는 두 교차로의 정상 통신과 통신 중단 상황을 각각 확인하고 결과를 기록합니다. 이 문서에는 사업 예산과 장애 장비의 보관 기간이 적혀 있지 않습니다.\n`;
try {
  browser = await chromium.launch();
  await login("admin", admin);
  if (mode === "prepare") {
    for (const role of ["writer", "reviewer", "reader"])
      if (!state.accounts[role]) {
        const account = {
          name: `${role} 운영 리허설`,
          email: `${role}@stage16.rehearsal.invalid`,
          password: randomBytes(24).toString("base64url"),
          role,
          isAdmin: false,
        };
        await json(
          await clients.admin.post(`${base}/members`, { data: account }),
          201,
        );
        state.accounts[role] = account;
        save();
      }
  }
  for (const [role, account] of Object.entries(state.accounts))
    await login(role, account);
  if (mode === "prepare") {
    if (phase === "revision") expect(state.initial.published).toBe(true);
    if (!state.domainId) {
      const d = await json(
        await clients.admin.post(`${base}/domains`, {
          data: {
            name: "가상 은하군 운영 리허설",
            purpose:
              "원문의 적용 범위와 조건을 보존하며 정상 갱신, 장애 대응, 점검 기록을 확인합니다.",
            purposeGuide: {
              keyQuestions:
                "정상 갱신, 통신 중단 표시, 재연결 확인, 점검 기록 보관은 각각 어떻게 하나요?",
              scopeIncluded: "가상 은하군 시범 교차로 두 곳",
              scopeExcluded: "다른 사업의 기준과 법적 판단",
              workingAssumptions: "개발용 가상 표본",
              successCriteria:
                "원문의 수치·부정문을 보존하고 근거 위치로 이동할 수 있습니다.",
            },
            terms: [],
            recordTemplate: "상황·판단·결과",
            autoIngest: true,
          },
        }),
        201,
      );
      state.domainId = d.id;
      save();
    }
    if (!state.projectId) {
      state.projectId = (
        await json(
          await clients.admin.post(`${base}/projects`, {
            data: {
              domainId: state.domainId,
              name: "가상 은하군 시범사업",
              clientName: "가상 기관",
              description: "운영 이미지의 실제 모델·검토·복원 확인",
            },
          }),
          201,
        )
      ).id;
      save();
    }
    writeFileSync(`${out}/source-${phase}.md`, contents);
    if (!current.source) {
      const page = pages.writer;
      if (phase === "initial") {
        await page.goto(
          `${root}/sources?domainId=${state.domainId}&projectId=${state.projectId}`,
        );
        await page
          .getByRole("button", { name: "새 자료 등록", exact: true })
          .click();
        await page
          .getByLabel("자료 제목", { exact: true })
          .fill("가상 은하군 관제 운영 지침");
        await page
          .getByRole("dialog")
          .getByLabel("프로젝트", { exact: true })
          .click();
        await page
          .getByRole("option", { name: "가상 은하군 시범사업", exact: true })
          .click();
      } else {
        await page.goto(`${root}/sources/${state.initial.source.sourceId}`);
        await page.getByText("새 원본 버전 등록", { exact: true }).click();
      }
      await page.getByLabel("원본 파일", { exact: true }).setInputFiles({
        name: `source-${phase}.md`,
        mimeType: "text/markdown",
        buffer: Buffer.from(contents),
      });
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          /\/sources(?:\/[\w-]+)?$/.test(r.url()),
      );
      await page
        .getByRole("button", {
          name: phase === "initial" ? "자료 등록" : "새 버전 등록",
          exact: true,
        })
        .click();
      current.source = await json(await response, 201);
      current.startedAt = new Date().toISOString();
      save();
    }
    const s = current.source;
    const detail = await wait(
      async () =>
        json(
          await clients.writer.get(
            `${base}/sources/${s.sourceId}?version=${s.versionId}`,
          ),
        ),
      (d) => ["completed", "failed"].includes(d.version.processing),
    );
    expect(detail.version.processing).toBe("completed");
    expect(detail.version.sha256).toBe(hash(Buffer.from(contents)));
    if (detail.version.publication !== "published")
      await action(
        "reviewer",
        `${root}/sources/${s.sourceId}?version=${s.versionId}`,
        `${base}/source-versions/${s.versionId}/action`,
        "자료 공개 승인",
      );
    if (process.argv.includes("--restart")) {
      const page = pages.writer;
      await page.goto(`${root}/sources/${s.sourceId}`);
      const button = page.getByRole("button", {
        name: "자료 정리 실행",
        exact: true,
      });
      if (await button.isEnabled()) {
        const response = page.waitForResponse(
          (r) =>
            r.request().method() === "POST" && r.url().endsWith("/ingest-runs"),
        );
        await button.click();
        await json(await response, 201);
      }
    }
    if (process.argv.includes("--retry") && report.run?.state === "failed") {
      const failure = { ...report.run };
      const page = pages.writer;
      await page.goto(`${root}/sources/${s.sourceId}`);
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === "PATCH" &&
          r.url().endsWith(`/ingest-runs/${failure.id}`),
      );
      await page
        .getByRole("button", { name: "정리 재시도", exact: true })
        .click();
      await json(await response);
      report.failures ??= [];
      report.failures.push({ ...failure, retriedAt: new Date().toISOString() });
      saveReport();
    }
    const run = await wait(
      async () =>
        (
          await json(
            await clients.writer.get(
              `${base}/ingest-runs?sourceId=${s.sourceId}&sourceVersionId=${s.versionId}`,
            ),
          )
        ).items[0] ?? {},
      (r) =>
        ["review", "completed", "failed", "outdated", "canceled"].includes(
          r.state,
        ),
    );
    report.run = run;
    saveReport();
    expect(["review", "completed"], run.errorMessage).toContain(run.state);
    current.runId = run.id;
    current.batchIds = run.groups.map((g) => g.id);
    save();
    report.analysis = await json(
      await clients.writer.get(`${base}/ai-tasks/${run.analysisTaskId}`),
    );
    report.generation = await json(
      await clients.writer.get(`${base}/ai-tasks/${run.generationTaskId}`),
    );
    report.batches = [];
    for (const id of current.batchIds)
      report.batches.push(
        await json(await clients.writer.get(`${base}/proposals/${id}`)),
      );
    report.source = { ...s, sha256: detail.version.sha256 };
    saveReport();
    await view("source", `${root}/sources/${s.sourceId}`, "writer");
    await view("task", `${root}/ai-tasks/${run.generationTaskId}`, "writer");
    console.log(
      `원문 대조 대상 저장: ${reportFile}, 변경 묶음 ${current.batchIds.length}개`,
    );
  } else if (mode === "publish") {
    report.publication = [];
    for (const id of current.reviewedBatchIds ?? current.batchIds) {
      const detail = await json(
        await clients.writer.get(`${base}/proposals/${id}`),
      );
      if (
        detail.batch.items.some(
          (i) => i.requiresResolution || i.kind === "conflict",
        )
      )
        throw new Error(
          "본문을 직접 대조하고 새 수정 묶음을 만든 뒤 게시하세요.",
        );
      if (detail.batch.state === "draft")
        await action(
          "writer",
          `${root}/proposals/${id}`,
          `${base}/proposals/${id}/action`,
          "묶음 검토 요청",
        );
      if (detail.batch.state !== "approved")
        await action(
          "reviewer",
          `${root}/proposals/${id}`,
          `${base}/proposals/${id}/action`,
          "전체 변경 승인·게시",
        );
      const published = await json(
        await clients.writer.get(`${base}/proposals/${id}`),
      );
      for (const item of published.batch.results) {
        const wiki = await json(
          await clients.reader.get(`${base}/wiki/${item.pageId}`),
        );
        report.publication.push({
          ...item,
          title: wiki.version.title,
          body: wiki.version.body,
          metadata: wiki.version.metadata,
        });
      }
    }
    current.published = true;
    save();
    saveReport();
    const questions =
      phase === "initial"
        ? [
            "두 교차로의 통신을 끊은 점검에서 화면 갱신 기준을 만족했다고 기록해도 되나요?",
            "연결이 돌아오면 언제까지 무엇을 점검하나요?",
            "장애 장비의 점검 기록도 72시간 뒤에 삭제해도 되나요?",
            "이 시범사업 예산은 얼마인가요?",
          ]
        : [
            "개정된 지침에서 정상 화면 갱신 간격은 몇 초인가요?",
            "그 기준은 통신이 끊긴 동안에도 충족한 것으로 보나요?",
          ];
    let conversation;
    for (const [i, prompt] of questions.entries()) {
      if (report.queries.some((q) => q.prompt === prompt)) continue;
      if (!conversation || phase === "initial")
        conversation = await json(
          await clients.reader.post(`${base}/conversations`, {
            data: {
              title: `운영 리허설 ${phase} ${i + 1}`,
              scope: {
                domainId: state.domainId,
                projectId: state.projectId,
                sourceId: null,
                wikiId: null,
                sourceOnly: false,
              },
            },
          }),
          201,
        );
      const start = Date.now();
      const response = await clients.reader.post(
        `${base}/conversations/${conversation.id}/stream`,
        { data: { requestId: randomUUID(), prompt }, timeout: 180000 },
      );
      expect(response.status()).toBe(200);
      await response.text();
      const d = await json(
        await clients.reader.get(`${base}/conversations/${conversation.id}`),
      );
      const run = d.runs.at(-1);
      expect(run.state).toBe("completed");
      report.queries.push({
        prompt,
        conversationId: conversation.id,
        elapsedMs: Date.now() - start,
        run,
      });
      saveReport();
      console.log(`새 질문 ${i + 1} 완료`);
    }
    await view("wiki", `${root}/wiki/${report.publication[0].pageId}`);
    await view(
      "chat",
      `${root}/chat?conversation=${report.queries.at(-1).conversationId}`,
    );
  } else if (mode === "quality") {
    if (process.argv.includes("--force")) {
      current.previousQuality ??= [];
      current.previousQuality.push(current.quality ?? {});
      current.quality = {};
      save();
    }
    current.quality ??= {};
    report.quality ??= [];
    for (const kind of ["structural", "semantic"]) {
      if (!current.quality[kind]) {
        current.quality[kind] = await json(
          await clients.reviewer.post(`${base}/quality`, {
            data: {
              domainId: state.domainId,
              projectId: state.projectId,
              mode: kind,
              requestId: randomUUID(),
              force: true,
            },
          }),
          201,
        );
        save();
      }
      const run = await wait(
        async () =>
          (
            await json(
              await clients.reviewer.get(
                `${base}/quality?domainId=${state.domainId}&projectId=${state.projectId}`,
              ),
            )
          ).runs.find((r) => r.id === current.quality[kind].id),
        (r) => !["queued", "running"].includes(r.state),
      );
      expect(run.state, run.errorMessage).toBe("completed");
      const d = await json(
        await clients.reviewer.get(
          `${base}/quality?domainId=${state.domainId}&projectId=${state.projectId}`,
        ),
      );
      report.quality.push(d);
      saveReport();
    }
    await view(
      "quality",
      `${root}/quality?domainId=${state.domainId}&projectId=${state.projectId}`,
      "reviewer",
    );
    await view(
      "graph",
      `${root}/graph?domainId=${state.domainId}&projectId=${state.projectId}`,
    );
  } else if (["defer", "defer-semantic"].includes(mode)) {
    const d = await json(
      await clients.reviewer.get(
        `${base}/quality?domainId=${state.domainId}&projectId=${state.projectId}`,
      ),
    );
    const findings = d.findings.filter(
      (f) =>
        (mode === "defer"
          ? f.kind === "stale-evidence"
          : ["duplicate", "purpose-gap"].includes(f.kind)) &&
        f.present &&
        f.current &&
        f.state !== "resolved",
    );
    expect(findings.length).toBeGreaterThan(0);
    const decisions = [];
    for (const f of findings) {
      const page = pages.reviewer;
      await page.goto(`${root}/reviews/desk?kind=quality&targetId=${f.id}`);
      const card = page.locator(`#review-quality-${f.id}`);
      await expect(card).toBeVisible();
      await card.getByLabel("처리", { exact: true }).click();
      await page
        .getByRole("option", { name: "사유를 남기고 보류", exact: true })
        .click();
      const note =
        mode === "defer"
          ? "가상 원문이 30초에서 45초로 개정되어 이전 버전 근거를 확인했습니다. 현재 생성된 수정 묶음의 본문 대조와 게시를 마칠 때까지 보류합니다."
          : f.kind === "duplicate"
            ? "가상 표본에서 원문 요약·통신 확인·점검 기록 문서를 구분했고, 인용된 공통 조건과 상호 위키 링크를 직접 대조했습니다. 내용은 일치합니다. 독립 절차 문서에 적용 범위와 조건을 반복할지에 관한 편집 판단은 실제 담당자 검토 전까지 보류합니다."
            : "현재 게시된 통신 확인 절차에는 마지막 수신 시각·중단 표시·최신 값 표시 금지가 있고, 연결된 점검 기록 관리에는 정상 장비 72시간 보관과 장애 장비 제외 조건이 있습니다. 관련 링크와 본문을 대조했습니다. 각 페이지에 같은 설명을 더 반복할지는 담당자 검토 전까지 보류합니다.";
      await card.locator("textarea").fill(note);
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" && r.url().endsWith("/review-desk"),
      );
      await card
        .getByRole("button", { name: "처리 저장", exact: true })
        .click();
      await json(await response, 201);
      decisions.push({ id: f.id, note });
    }
    if (mode === "defer") report.deferred = decisions.map((d) => d.id);
    else report.semanticReviewNotes = decisions;
    report.finalQuality = await json(
      await clients.reviewer.get(
        `${base}/quality?domainId=${state.domainId}&projectId=${state.projectId}`,
      ),
    );
    await view(
      mode === "defer" ? "deferred-review" : "semantic-review",
      `${root}/reviews/desk?kind=quality&targetId=${findings[0].id}`,
      "reviewer",
    );
  } else {
    expect((await clients.reader.get(`${base}/members`)).status()).toBe(403);
    for (const p of ["initial", "revision"]) {
      const s = state[p].source;
      const response = await clients.writer.get(
        `${base}/source-versions/${s.versionId}/file`,
      );
      expect(response.status()).toBe(200);
      expect(hash(await response.body())).toBe(
        hash(readFileSync(`${out}/source-${p}.md`)),
      );
    }
    for (const item of report.publication) {
      const wiki = await json(
        await clients.reader.get(`${base}/wiki/${item.pageId}`),
      );
      expect(wiki.version.body).toBe(item.body);
    }
    const graph = await json(
      await clients.reader.get(
        `${base}/graph?domainId=${state.domainId}&projectId=${state.projectId}`,
      ),
    );
    expect(graph.nodes.map((n) => `${n.id}:${n.versionId}`).sort()).toEqual(
      report.publication.map((p) => `${p.pageId}:${p.versionId}`).sort(),
    );
    expect(
      graph.nodes.every((n) =>
        n.sources.every((s) => s.versionId === current.source.versionId),
      ),
    ).toBe(true);
    const quality = await json(
      await clients.reviewer.get(
        `${base}/quality?domainId=${state.domainId}&projectId=${state.projectId}`,
      ),
    );
    expect(
      quality.findings
        .map((f) => ({
          id: f.id,
          state: f.state,
          present: f.present,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      report.finalQuality.findings
        .map((f) => ({
          id: f.id,
          state: f.state,
          present: f.present,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
    for (const q of report.queries) {
      const d = await json(
        await clients.reader.get(`${base}/conversations/${q.conversationId}`),
      );
      expect(d.runs.find((r) => r.id === q.run.id).messages).toEqual(
        q.run.messages,
      );
    }
    for (const [name, path, role] of [
      ["source", `sources/${current.source.sourceId}`, "writer"],
      ["wiki", `wiki/${report.publication[0].pageId}`, "reader"],
      [
        "chat",
        `chat?conversation=${report.queries.at(-1).conversationId}`,
        "reader",
      ],
      ["task", `ai-tasks/${report.run.generationTaskId}`, "writer"],
      [
        "quality",
        `quality?domainId=${state.domainId}&projectId=${state.projectId}`,
        "reviewer",
      ],
      [
        "graph",
        `graph?domainId=${state.domainId}&projectId=${state.projectId}`,
        "reader",
      ],
    ])
      await view(name, `${root}/${path}`, role);
    writeFileSync(
      `${out}/${profile}-verified.json`,
      JSON.stringify(
        {
          date: new Date().toISOString(),
          profile,
          sourceHashes: true,
          wikiBodies: true,
          savedChats: true,
          readerRole: true,
          views: report.views.slice(-12),
          tableCounts: target.tableCounts(),
        },
        null,
        2,
      ),
    );
  }
  expect(errors).toEqual([]);
  if (mode !== "verify") saveReport();
} finally {
  await browser?.close();
  await Promise.all(Object.values(clients).map((c) => c.dispose()));
}
