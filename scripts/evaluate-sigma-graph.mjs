import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, expect, request } from "@playwright/test";

const core = JSON.parse(readFileSync(".local/core-evaluation.json", "utf8"));
const source = JSON.parse(readFileSync(".local/graph-evaluation.json", "utf8"));
const account = JSON.parse(
  readFileSync(".local/content-accounts.json", "utf8"),
).accounts.find((a) => a.role === "writer");
const origin = "http://localhost:3010",
  out = "docs/improvements/06-sigma-graph";
mkdirSync(out, { recursive: true });
const api = await request.newContext({
  baseURL: origin,
  extraHTTPHeaders: { Origin: origin },
});
const browser = await chromium.launch();
const report = {
  date: new Date().toISOString(),
  source:
    "기존 실제 모델 평가로 게시한 가상 개발 위키. 이번 그래프 표시는 모델을 호출하지 않음.",
  versions: {},
  views: [],
  businessReview: null,
};
for (const pkg of [
  "sigma",
  "@react-sigma/core",
  "graphology-layout-forceatlas2",
  "graphology",
  "graphology-communities-louvain",
])
  report.versions[pkg] = JSON.parse(
    readFileSync(`node_modules/${pkg}/package.json`, "utf8"),
  ).version;
try {
  expect(
    (
      await api.post("/api/auth/sign-in/email", {
        data: { email: account.email, password: account.password },
      })
    ).status(),
  ).toBe(200);
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width, height: 900 },
      storageState: await api.storageState(),
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const response = await page.goto(
      `/w/${core.workspaceId}/graph?domainId=${source.domainId}`,
    );
    expect(response.status()).toBe(200);
    const graph = page.locator('.sigma-container[data-ready="true"]');
    await expect(graph).toHaveAttribute("data-node-count", "3");
    await expect(page.locator(".graph-filters")).toHaveCount(0);
    await expect(page.locator(".graph-side-panel")).toHaveCount(0);
    const capture = async (name) => {
      // Move off the canvas and allow the library to finish its scheduled frame.
      await page
        .getByRole("heading", { name: "지식 그래프", exact: true })
        .hover();
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
      const overflow = await page.evaluate(() =>
        Math.max(0, document.documentElement.scrollWidth - innerWidth),
      );
      expect(overflow).toBe(0);
      expect(errors).toEqual([]);
      await page.screenshot({ path: `${out}/${name}-${width}.png` });
      report.views.push({
        name,
        width,
        overflow,
        errors: [...errors],
        canvasCount: await page.locator(".graph-stage canvas").count(),
      });
    };
    await capture("graph");
    await page.getByRole("button", { name: "군집", exact: true }).click();
    await capture("communities");
    await page.getByRole("button", { name: "필터", exact: true }).click();
    const form = page.getByRole("form", { name: "그래프 필터" });
    await expect(form.getByLabel("도메인", { exact: true })).toBeVisible();
    await capture("filters");
    await page.getByRole("button", { name: "필터 닫기", exact: true }).click();
    await page.getByRole("button", { name: "인사이트", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "그래프 인사이트" }),
    ).toBeVisible();
    await capture("insights");
    await page.getByRole("button", { name: "패널 닫기", exact: true }).click();
    await page.getByRole("button", { name: "위키 목록", exact: true }).click();
    await page
      .getByRole("group", { name: "위키 목록", exact: true })
      .getByRole("button")
      .first()
      .click();
    const detail = page.getByRole("complementary", {
      name: "선택한 위키 상세",
    });
    const link = detail.getByRole("link", { name: "선택한 게시 본문" });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect((await api.get(href)).status()).toBe(200);
    await capture("selected");
    await context.close();
  }
  writeFileSync(`${out}/results.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      views: report.views.length,
      errors: 0,
      versions: report.versions,
    }),
  );
} finally {
  await browser.close();
  await api.dispose();
}
