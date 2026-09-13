// Apply explicitly prepared review decisions through the regular browser form.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, expect, request } from "@playwright/test";
import { deployment, hash } from "./lib/deployment.mjs";

const [profile] = process.argv.slice(2);
expect(profile).toMatch(/^wiki-stage16-/);
const t = deployment(profile),
  out = "docs/evaluation/core/deployment-16";
const stateFile = join(t.folder, "core-rehearsal.json");
const state = JSON.parse(readFileSync(stateFile, "utf8"));
const { workspaceId } = JSON.parse(
  readFileSync(join(t.folder, "workspace.json"), "utf8"),
);
const decisions = JSON.parse(
  readFileSync(join(t.folder, "revision-review-decisions.json"), "utf8"),
);
const original = readFileSync(`${out}/source-initial.md`, "utf8"),
  revised = readFileSync(`${out}/source-revision.md`, "utf8");
expect(revised).toBe(original.replace("30초 간격", "45초 간격"));
const base = `/api/workspaces/${workspaceId}`,
  root = `/w/${workspaceId}`;
const api = await request.newContext({
  baseURL: t.env.BETTER_AUTH_URL,
  storageState: join(t.folder, "writer-browser-session.json"),
  extraHTTPHeaders: { Origin: t.env.BETTER_AUTH_URL },
});
const browser = await chromium.launch(),
  errors = [],
  reviewed = [];
const json = async (r, code = 200) => {
  const d = await r.json();
  expect(r.status(), d.error ?? "검토 요청").toBe(code);
  return d;
};
try {
  const context = await browser.newContext({
    baseURL: t.env.BETTER_AUTH_URL,
    storageState: await api.storageState(),
    viewport: { width: 390, height: 900 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  state.revision.reviewedBatchIds ??= [];
  for (const decision of decisions) {
    if (state.revision.reviewedBatchIds.length > reviewed.length) {
      reviewed.push({
        id: state.revision.reviewedBatchIds[reviewed.length],
        replay: true,
      });
      continue;
    }
    const before = await json(
      await api.get(`${base}/proposals/${decision.batchId}`),
    );
    expect(before.isLatest).toBe(true);
    expect(before.available).toBe(true);
    expect(hash(JSON.stringify(before.batch.items))).toBe(
      decision.expectedItemsHash,
    );
    expect(before.batch.items.length).toBe(decision.items.length);
    await page.goto(`${root}/proposals/${decision.batchId}`);
    await page
      .getByText("내용을 수정해 새 묶음으로 작성", { exact: true })
      .click();
    for (const [i, item] of decision.items.entries()) {
      expect(item.pageId).toBe(
        before.batch.items[i].pageId ?? before.batch.items[i].plannedPageId,
      );
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
    const response = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().endsWith("/proposals"),
    );
    await page
      .getByRole("button", { name: "수정한 새 변경 묶음 저장", exact: true })
      .click();
    const result = await json(await response, 201);
    await page.waitForURL(`**/proposals/${result.id}`);
    const after = await json(await api.get(`${base}/proposals/${result.id}`));
    expect(
      after.batch.items.map((i) => ({
        pageId: i.pageId ?? i.plannedPageId,
        body: i.body,
      })),
    ).toEqual(decision.items.map(({ pageId, body }) => ({ pageId, body })));
    expect(after.batch.items.every((i) => !i.requiresResolution)).toBe(true);
    state.revision.reviewedBatchIds.push(result.id);
    writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
    reviewed.push({
      previousBatchId: decision.batchId,
      id: result.id,
      items: decision.items,
      results: after,
    });
    await page.screenshot({
      path: `${out}/revision-reviewed-${reviewed.length}-390.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
  writeFileSync(
    `${out}/revision-manual-review.json`,
    `${JSON.stringify({ date: new Date().toISOString(), reviewed, errors, businessReview: null }, null, 2)}\n`,
  );
  console.log(`가상 개정 원문 대조 후 수정 묶음 ${reviewed.length}개 저장`);
} finally {
  await browser.close();
  await api.dispose();
}
