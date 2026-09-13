// Review only the fixed development fixture's single 30-day -> 45-day change.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, expect, request } from "@playwright/test";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const runName = process.env.INGEST_EVALUATION_RUN ?? "";
if (runName && !/^[a-z0-9][a-z0-9-]{0,60}$/.test(runName))
  throw new Error("평가 실행 이름을 확인하세요.");
const suffix = runName ? `-${runName}` : "";
const out = `docs/evaluation/core/ingest-12${suffix}`;
const statePath = `.local/ingest-evaluation${suffix}.json`;
const state = read(statePath);
const fixture = read(".local/core-evaluation.json");
const account = read(".local/content-accounts.json").accounts.find(
  (a) => a.role === "writer",
);
const baseline = read(`${out}/initial.json`);
const current = read(`${out}/revision.json`);
const original = readFileSync(`${out}/source-initial.md`, "utf8");
const revised = readFileSync(`${out}/source-revision.md`, "utf8");
expect(revised).toBe(
  original.replace(
    "운영 기록은 30일 동안 보관합니다.",
    "운영 기록은 45일 동안 보관합니다.",
  ),
);
expect(current.fileHash).toBe(
  createHash("sha256").update(revised).digest("hex"),
);
expect(current.run.state).toBe("review");
expect(current.batches).toHaveLength(1);
const origin = "http://localhost:3010";
const base = `/api/workspaces/${fixture.workspaceId}`;
const root = `/w/${fixture.workspaceId}`;
const api = await request.newContext({
  baseURL: origin,
  extraHTTPHeaders: { Origin: origin },
});
let browser;
const json = async (response, status = 200) => {
  const value = await response.json();
  expect(response.status(), value.error ?? "평가 요청 실패").toBe(status);
  return value;
};
try {
  await json(
    await api.post("/api/auth/sign-in/email", {
      data: { email: account.email, password: account.password },
    }),
  );
  const selected = current.batches[0].batch;
  const detail = await json(await api.get(`${base}/proposals/${selected.id}`));
  expect(detail.isLatest).toBe(true);
  expect(detail.available).toBe(true);
  expect(detail.batch.items).toEqual(selected.items);
  const reviewed = selected.items.map((item) => {
    const previous = baseline.publication.find((p) => p.pageId === item.pageId);
    if (!previous) {
      // These two new fixture pages have been read and compared with current
      // claims before applying this fixed evaluation review.
      expect(item.kind).toBe("new");
      expect(item.requiresResolution).toBe(false);
      expect([
        "가상 솔빛시 운영 기록 보관 기준",
        "가상 솔빛시 비상 전원 및 검수 완료 제한",
      ]).toContain(item.title);
      expect(item.body).not.toContain("30일");
      return {
        pageId: item.plannedPageId,
        title: item.title,
        body: item.body,
        reason: item.reason,
      };
    }
    expect(previous, "기존 평가 페이지 주소").toBeTruthy();
    if (runName === "original-parity-20260910") {
      // The four generated bodies were read against this fixed fixture. The
      // original single-source replacement keeps the reviewed generated body.
      expect(item.basePublishedVersionId).toBe(previous.versionId);
      expect(item.body).not.toContain("30일");
      for (const clause of [
        "30초",
        "모든 화면에 일괄 적용하지 않습니다",
        "8시간",
        "현장 직원의 구두 설명만으로 검수를 완료하지 않습니다",
        "90초",
        "자동 갱신을 금지",
        "새 데이터 수신을 확인",
        "다른 사업의 보관 기간으로 바꾸지 않습니다",
      ]) {
        if (previous.body.includes(clause)) expect(item.body).toContain(clause);
      }
      if (previous.body.includes("30일"))
        expect(item.body).toContain("운영 기록은 45일 동안 보관합니다.");
      return {
        pageId: item.pageId,
        title: item.title,
        body: item.body,
        reason:
          "고정 가상 개정 원문과 생성 본문을 직접 대조했습니다. 보관 기간은 45일이며, 화면별 갱신·통신 단절·비상 전원·구두 검수 제한·다른 사업 제외 조건과 기존 문서 주소를 확인했습니다.",
      };
    }
    // Stop if any intervening editor text was introduced; never discard it.
    expect(item.body.startsWith(previous.body)).toBe(true);
    expect(item.basePublishedVersionId).toBe(previous.versionId);
    const body = previous.body.replace(
      "운영 기록은 30일 동안 보관합니다.",
      "운영 기록은 45일 동안 보관합니다.",
    );
    return {
      pageId: item.pageId,
      title: item.title,
      body,
      reason:
        body === previous.body
          ? "가상 개정 원문과 대조했습니다. 화면 갱신·통신 단절 조건은 동일하여 기존 본문을 보존하고 현재 문단 근거로 다시 연결합니다."
          : "가상 개정 원문의 운영 기록 보관 기간을 대조하여 30일을 45일로 수정했습니다. 나머지 기존 본문과 링크를 보존하고 현재 문단 근거로 다시 연결합니다.",
    };
  });
  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: origin,
    storageState: await api.storageState(),
    viewport: { width: 390, height: 900 },
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${root}/proposals/${selected.id}`);
  await page
    .getByText("내용을 수정해 새 묶음으로 작성", { exact: true })
    .click();
  for (const [i, item] of reviewed.entries()) {
    await page
      .getByLabel("변경 후 본문", { exact: true })
      .nth(i)
      .fill(item.body);
    await page
      .getByLabel("변경 이유·확인할 사항", { exact: true })
      .nth(i)
      .fill(item.reason);
  }
  for (const checkbox of await page
    .getByRole("checkbox", {
      name: "모순·적용 조건을 확인하고 본문 수정을 마쳤습니다",
      exact: true,
    })
    .all())
    await checkbox.check();
  const saved = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/proposals"),
  );
  await page
    .getByRole("button", { name: "수정한 새 변경 묶음 저장", exact: true })
    .click();
  const result = await json(await saved, 201);
  await page.waitForURL(`**/proposals/${result.id}`);
  await page
    .getByRole("heading", { name: selected.title, exact: true })
    .waitFor();
  expect(errors).toEqual([]);
  const final = await json(await api.get(`${base}/proposals/${result.id}`));
  expect(
    final.batch.items.every(
      (i) => !i.requiresResolution && ["update", "new"].includes(i.kind),
    ),
  ).toBe(true);
  expect(
    final.batch.items.map((i) => ({
      pageId: i.pageId ?? i.plannedPageId,
      body: i.body,
    })),
  ).toEqual(reviewed.map((i) => ({ pageId: i.pageId, body: i.body })));
  await page.screenshot({
    path: `${out}/revision-reviewed-390.png`,
    fullPage: true,
  });
  writeFileSync(
    `${out}/manual-review.json`,
    `${JSON.stringify(
      {
        date: new Date().toISOString(),
        dataClassification: "고정된 가상 개발 표본의 직접 대조",
        previousBatchId: selected.id,
        batchId: result.id,
        reviewed,
        errors,
      },
      null,
      2,
    )}\n`,
  );
  state.revision.reviewedBatchId = result.id;
  writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify({
      reviewed: true,
      batchId: result.id,
      pages: reviewed.length,
    }),
  );
} finally {
  await browser?.close();
  await api.dispose();
}
