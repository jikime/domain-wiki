import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, expect, request } from "@playwright/test";

const core = JSON.parse(readFileSync(".local/core-evaluation.json", "utf8")),
  graph = JSON.parse(readFileSync(".local/graph-evaluation.json", "utf8")),
  quality = JSON.parse(readFileSync(".local/quality-evaluation.json", "utf8"));
const team = JSON.parse(readFileSync(".local/content-accounts.json", "utf8")),
  account = team.accounts.find((a) => a.role === "writer");
const origin = "http://localhost:3010",
  out = "docs/evaluation/core/graph-15";
mkdirSync(out, { recursive: true });
const api = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  }),
  browser = await chromium.launch();
const report = {
  date: new Date().toISOString(),
  classification:
    "13·14단계에 공식 계정과 실제 모델로 검증한 가상 개발 자료. 그래프 자체는 모델을 호출하지 않음.",
  views: [],
  datasets: [],
  businessReview: null,
};
try {
  expect(
    (
      await api.post("/api/auth/sign-in/email", {
        data: { email: account.email, password: account.password },
      })
    ).status(),
  ).toBe(200);
  for (const [name, domainId] of [
    ["indirect", graph.domainId],
    ["quality", quality.domainId],
  ]) {
    const url = `/api/workspaces/${core.workspaceId}/graph?domainId=${domainId}`;
    const start = performance.now(),
      r = await api.get(url),
      data = await r.json();
    expect(r.status()).toBe(200);
    report.datasets.push({
      name,
      data,
      apiMs: performance.now() - start,
      responseBytes: Buffer.byteLength(JSON.stringify(data)),
    });
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
          storageState: await api.storageState(),
          baseURL: origin,
          viewport: { width, height: 1000 },
        }),
        page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const start = performance.now();
      await page.goto(`/w/${core.workspaceId}/graph?domainId=${domainId}`);
      const status = page
        .getByRole("status")
        .filter({ hasText: `${data.nodes.length}개 중` });
      await expect(status).toBeVisible();
      const readyMs = performance.now() - start,
        summary = await status.innerText();
      const first = page
        .getByRole("group", { name: "위키 목록", exact: true })
        .getByRole("button")
        .first();
      await first.click();
      const detail = page.getByRole("complementary", {
        name: "선택한 위키 상세",
      });
      await expect(
        detail.getByRole("link", { name: "선택한 게시 본문" }),
      ).toBeVisible();
      const links = [];
      for (const a of await detail.getByRole("link").all()) {
        const href = await a.getAttribute("href");
        if (href && !href.includes("/issues")) {
          const response = await api.get(href);
          links.push({ href, status: response.status() });
          expect(response.status()).toBe(200);
        }
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${out}/${name}-${width}.png`,
        fullPage: true,
      });
      await detail.screenshot({ path: `${out}/${name}-detail-${width}.png` });
      if (width === 390) {
        await page
          .getByRole("button", { name: "그래프로 보기", exact: true })
          .click();
        await expect(page.locator("svg.knowledge-canvas")).toBeVisible();
        await page
          .getByRole("button", { name: "목록으로 보기", exact: true })
          .click();
        await expect(page.locator("svg.knowledge-canvas")).toBeHidden();
      }
      await page
        .getByRole("button", { name: "새로 확인", exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: "계산 재사용" }),
      ).toBeVisible();
      report.views.push({
        name,
        width,
        readyMs,
        summary,
        links,
        overflow,
        errors,
        cacheValidated: true,
      });
      await context.close();
    }
  }
  writeFileSync(`${out}/result.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      views: report.views.map(
        ({ name, width, readyMs, summary, overflow, errors }) => ({
          name,
          width,
          readyMs,
          summary,
          overflow,
          errors,
        }),
      ),
      datasets: report.datasets.map((d) => ({
        name: d.name,
        nodes: d.data.nodes.length,
        apiMs: d.apiMs,
        responseBytes: d.responseBytes,
      })),
    }),
  );
} finally {
  await api.dispose();
  await browser.close();
}
