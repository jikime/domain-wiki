import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";
import {
  referenceGraphQuota,
  referenceKeywordScore,
  referenceKeywordSql,
} from "../src/lib/reference-search";
import { wikiLinksFromMarkdown } from "../src/lib/wiki-links";
import { buildWikiReferenceIndex } from "../src/lib/wiki-reference-index";

type Fixture = {
  workspaceId: string;
  accounts: { id: string; role: string }[];
};
export function registerOriginalDocumentTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("원본 기능 복원 — 문서 표시와 검색", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const domainId = randomUUID(),
      target = randomUUID(),
      targetVersion = randomUUID();
    const base = `/api/workspaces/${f.workspaceId}`,
      root = `/w/${f.workspaceId}`;
    const body = [
      "---",
      "title: 원본 문서 형식",
      "type: methodology",
      "aliases: [형식 표본]",
      "status: reviewed",
      "---",
      "",
      "# 문서 표시",
      "",
      "[[검수 별칭|검수 안내 열기]]",
      "",
      "수식 $x^2 + y^2 = z^2$",
      "",
      "$$",
      "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
      "$$",
      "",
      "```mermaid",
      "flowchart LR",
      "  A[자료 등록] --> B[검토] --> C[게시]",
      "```",
      "",
      "![시험 이미지](/parity-image.png)",
      "",
      "```text",
      "[[코드 안 링크]]",
      "```",
      "",
      "<script>window.parityXss = true</script>",
      "[실행 금지](javascript:alert(1))",
    ].join("\n");
    let pageId = "";
    test.beforeAll(async () => {
      const author = f.accounts.find((a) => a.role === "writer")?.id;
      await pool.query(
        "INSERT INTO domain(id,workspace_id,name,purpose,purpose_markdown,schema_markdown) VALUES($1,$2,'원본 문서 표본','문서 형식 확인','# Purpose\n검수 방법을 기록한다.','# Page Types\n- methodology → wiki/methodologies/')",
        [domainId, f.workspaceId],
      );
      await pool.query(
        "INSERT INTO wiki_page(id,workspace_id,domain_id,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,$5,$5,1)",
        [target, f.workspaceId, domainId, author, targetVersion],
      );
      await pool.query(
        "INSERT INTO wiki_version(id,workspace_id,page_id,number,title,body,author_id,state,metadata) VALUES($1,$2,$3,1,'검수 기준','공개된 검수 안내입니다.',$4,'approved',$5)",
        [
          targetVersion,
          f.workspaceId,
          target,
          author,
          {
            type: "concept",
            aliases: ["검수 별칭"],
            links: [],
            path: "wiki/concepts/acceptance.md",
          },
        ],
      );
      const created = await clients.writer.post(`${base}/wiki`, {
        data: {
          title: "제목",
          body,
          domainId,
          projectId: null,
          parentVersionId: null,
          basePublishedVersionId: null,
          chunkIds: [],
        },
      });
      expect(created.status()).toBe(201);
      pageId = (await created.json()).pageId;
    });
    test.afterAll(async () => {
      await pool.end();
    });
    test("파일명·문구·토큰 가중치와 그래프 배분을 원본 값으로 계산한다", async () => {
      const fixtures = [
        {
          title: "검수",
          filename: "검수.md",
          content: "검수 검수",
          query: "검수",
          groups: [["검수"]],
        },
        {
          title: "참고",
          filename: "note.md",
          content: "검수 ".repeat(15),
          query: "검수",
          groups: [["검수"]],
        },
        {
          title: "a_b",
          filename: "a_b.md",
          content: "a_b a_b",
          query: "a_b",
          groups: [["a_b"]],
        },
        {
          title: "없음",
          filename: "plain.md",
          content: "",
          query: "",
          groups: [],
        },
      ];
      for (const input of fixtures) {
        const expression = referenceKeywordSql({
          title: "$1::text",
          filename: "$2::text",
          content: "$3::text",
          phrase: "$4::text",
          groups: "$5",
        });
        const actual = await pool.query(`SELECT ${expression} AS score`, [
          input.title,
          input.filename,
          input.content,
          input.query,
          JSON.stringify(input.groups),
        ]);
        expect(Number(actual.rows[0].score)).toBe(referenceKeywordScore(input));
      }
      expect(referenceKeywordScore(fixtures[0])).toBe(296);
      expect([0, 10, 20].map((hits) => referenceGraphQuota(20, hits))).toEqual([
        6, 5, 3,
      ]);
      const index = buildWikiReferenceIndex([
        {
          id: target,
          title: "검수 기준",
          metadata: {
            aliases: ["검수 별칭"],
            path: "wiki/concepts/acceptance.md",
          },
        },
      ]);
      expect(
        wikiLinksFromMarkdown(
          "[[검수 별칭]] [[concepts/acceptance]] `[[제외]]`",
          f.workspaceId,
          index,
        ),
      ).toEqual([target]);
    });
    for (const width of [1440, 390])
      test(`${width}px에서 수식·다이어그램·이미지·별칭 링크와 확대를 표시한다`, async ({
        browser,
      }) => {
        const context = await browser.newContext({
          storageState: await clients.writer.storageState(),
          viewport: { width, height: 960 },
        });
        try {
          const page = await context.newPage(),
            errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.route("**/parity-image.png", (route) =>
            route.fulfill({
              contentType: "image/png",
              body: Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6woAAAAASUVORK5CYII=",
                "base64",
              ),
            }),
          );
          await page.goto(`${root}/wiki/${pageId}`);
          const rendered = page.locator(".wiki-markdown").first();
          await expect(rendered.locator(".katex")).toHaveCount(2);
          await rendered.locator(".markdown-diagram").scrollIntoViewIfNeeded();
          await expect(rendered.locator(".mermaid-svg svg")).toBeVisible();
          await expect(
            rendered.getByRole("link", { name: "검수 안내 열기" }),
          ).toHaveAttribute("href", `${root}/wiki/${target}`);
          await expect(rendered.locator("pre")).toContainText(
            "[[코드 안 링크]]",
          );
          await expect(rendered.locator("script")).toHaveCount(0);
          expect(
            await page.evaluate(
              () => (window as unknown as Record<string, unknown>).parityXss,
            ),
          ).toBeUndefined();
          await rendered
            .getByRole("button", { name: "다이어그램 확대" })
            .click();
          await expect(
            page.getByRole("dialog").locator(".markdown-diagram-expanded svg"),
          ).toBeVisible();
          await page
            .getByRole("dialog")
            .getByRole("button", { name: "확대", exact: true })
            .click();
          await expect(page.getByRole("dialog")).toContainText("125%");
          await page.keyboard.press("Escape");
          await rendered
            .getByRole("button", { name: "시험 이미지 확대" })
            .click();
          await expect
            .poll(() =>
              page
                .getByRole("dialog")
                .locator("img")
                .evaluate((img: HTMLImageElement) => img.naturalWidth),
            )
            .toBe(1);
          await page.keyboard.press("Escape");
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
          ).toBe(false);
          expect(errors).toEqual([]);
          await expect(page.getByRole("dialog")).toHaveCount(0);
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: `.local/parity-document-${width}.png`,
            fullPage: true,
          });
        } finally {
          await context.close();
        }
      });
    test("본문과 사용자 문서 속성을 편집·저장·재조회 후에도 그대로 유지한다", async ({
      page,
    }) => {
      await page
        .context()
        .addCookies((await clients.writer.storageState()).cookies);
      await page.goto(`${root}/wiki/${pageId}/edit`);
      await expect(
        page.getByRole("textbox", { name: "마크다운 본문", exact: true }),
      ).toHaveValue(body);
      await expect(
        page.getByRole("combobox", { name: "위키 유형" }),
      ).toContainText("방법론");
      await page.getByRole("button", { name: "미리보기", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "본문 미리보기" }).locator(".katex"),
      ).toHaveCount(2);
      await page
        .getByRole("button", { name: "초안 저장", exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`/wiki/${pageId}\\?version=`));
      const detail = await (
        await clients.writer.get(`${base}/wiki/${pageId}`)
      ).json();
      expect(detail.version.body).toBe(body);
      expect(detail.version.metadata).toMatchObject({
        type: "methodology",
        aliases: ["형식 표본"],
        frontmatter: { status: "reviewed" },
      });
    });
    test("잘못된 다이어그램은 오류와 원문 코드를 함께 표시한다", async ({
      page,
    }) => {
      const created = await clients.writer.post(`${base}/wiki`, {
        data: {
          title: "오류 다이어그램",
          body: "```mermaid\ninvalid-diagram-kind x y\n```",
          domainId,
          projectId: null,
          parentVersionId: null,
          basePublishedVersionId: null,
          chunkIds: [],
        },
      });
      expect(created.status()).toBe(201);
      await page
        .context()
        .addCookies((await clients.writer.storageState()).cookies);
      await page.goto(`${root}/wiki/${(await created.json()).pageId}`);
      await expect(
        page.getByText("다이어그램 문법을 확인해 주세요."),
      ).toBeVisible();
      await page.getByText("다이어그램 코드 보기").click();
      await expect(page.locator(".markdown-diagram pre")).toContainText(
        "invalid-diagram-kind",
      );
    });
  });
}
