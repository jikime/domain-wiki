import { type APIRequestContext, expect, test } from "@playwright/test";

type Fixture = { workspaceId: string; domainId: string };
const markdown = `# 운영 지침

**관제 담당자**는 적용 대상을 확인합니다.

| 상황 | 주기 |
| --- | --- |
| 정상 | 30초 |
| 시험 | 90초 |

> 통신 단절 중에는 자동 갱신을 하지 않습니다.

1. 공개 원문 확인
2. 조건 비교

- [x] 원문 확인
- [ ] 검토 요청

\`\`\`text
status = "검토 필요"
\`\`\`

[공개 원문](/w/sample/sources/sample)

각주 확인[^조건]

[^조건]: 시험 구간은 별도 기준을 따릅니다.

<script>window.editorXss = 1</script>
![표본](https://no-request.invalid/pixel)`;

export function registerMilkdownTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("Milkdown 위키 편집기", () => {
    const base = `/api/workspaces/${f.workspaceId}`;
    const root = `/w/${f.workspaceId}`;
    test.beforeEach(async ({ page }) => {
      await page
        .context()
        .addCookies((await clients.writer.storageState()).cookies);
    });
    test("서식·실행 취소와 한글 조합 뒤 바로 저장한 마지막 입력을 보존한다", async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${root}/wiki/new`);
      const body = page.getByRole("textbox", {
        name: "마크다운 본문",
        exact: true,
      });
      await expect(body).toHaveAttribute("contenteditable", "true");
      await expect(
        page.getByText("작성 내용을 이 탭에 임시 보관하고 있습니다."),
      ).toHaveCount(0);
      await page.getByLabel("위키 제목").fill("Milkdown 직접 작성");
      await body.fill("관제 절차");
      await body.press("ControlOrMeta+a");
      await page.getByRole("button", { name: "굵게", exact: true }).click();
      await expect(body.locator("strong")).toHaveText("관제 절차");
      await page
        .getByRole("button", { name: "실행 취소", exact: true })
        .click();
      await expect(body.locator("strong")).toHaveCount(0);
      await page
        .getByRole("button", { name: "다시 실행", exact: true })
        .click();
      await expect(body.locator("strong")).toHaveText("관제 절차");
      await page.getByRole("combobox", { name: "문단 서식" }).click();
      await page.getByRole("option", { name: "제목 2", exact: true }).click();
      await expect(body.locator("h2")).toHaveText("관제 절차");
      await expect(body).toBeFocused();
      await body.press("ArrowRight");
      await expect
        .poll(() => page.evaluate(() => getSelection()?.isCollapsed))
        .toBe(true);
      await body.press("Enter");
      await expect(body.locator("p")).toHaveCount(1);
      await page.getByRole("button", { name: "굵게", exact: true }).click();
      await body.dispatchEvent("compositionstart", { data: "" });
      await page.keyboard.insertText("한글 조합 입력을 보존합니다.");
      await body.dispatchEvent("compositionend", {
        data: "한글 조합 입력을 보존합니다.",
      });
      await page.keyboard.insertText(" 마지막 글자 끝");
      const saved = page.waitForResponse(
        (response) =>
          response.url().endsWith(`${base}/wiki`) &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "초안 저장", exact: true })
        .click();
      const response = await saved;
      expect(response.status()).toBe(201);
      const result = await response.json();
      await expect(page).toHaveURL(
        new RegExp(`/wiki/${result.pageId}\\?version=`),
      );
      const details = await (
        await clients.writer.get(`${base}/wiki/${result.pageId}`)
      ).json();
      expect(details.version.body).toContain("## **관제 절차**");
      expect(details.version.body).toContain("한글 조합 입력을 보존합니다.");
      expect(details.version.body).toContain("마지막 글자 끝");
      expect(
        await page.evaluate(() =>
          Object.keys(sessionStorage).filter((key) =>
            key.includes(":wiki:new:"),
          ),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
    });
    test("기존 표·코드·각주·부정문을 전환만으로 바꾸지 않고 제목만 수정해도 본문을 보존한다", async ({
      page,
    }) => {
      const seeded = await clients.writer.post(`${base}/wiki`, {
        data: {
          title: "Milkdown 기존 원문",
          body: markdown,
          domainId: f.domainId,
          projectId: null,
          parentVersionId: null,
          basePublishedVersionId: null,
          chunkIds: [],
        },
      });
      expect(seeded.status()).toBe(201);
      const { pageId } = await seeded.json();
      const external: string[] = [],
        errors: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("no-request.invalid"))
          external.push(request.url());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("https://no-request.invalid/pixel", (route) =>
        route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
            "base64",
          ),
        }),
      );
      await page.goto(`${root}/wiki/${pageId}/edit`);
      const body = page.getByRole("textbox", {
        name: "마크다운 본문",
        exact: true,
      });
      await expect(body.locator("h1")).toHaveText("운영 지침");
      await expect(body.locator("table")).toContainText("90초");
      await expect(body.locator("pre")).toContainText('status = "검토 필요"');
      await expect(body).toContainText("자동 갱신을 하지 않습니다.");
      await page.getByLabel("위키 제목").fill("Milkdown 제목만 수정");
      const navigationDialogs: string[] = [];
      page.on("dialog", async (dialog) => {
        navigationDialogs.push(dialog.type());
        await dialog.dismiss();
      });
      await body.getByRole("link", { name: "공개 원문", exact: true }).click();
      expect(navigationDialogs).toEqual([]);
      await expect(page).toHaveURL(`${root}/wiki/${pageId}/edit`);
      await page.getByRole("button", { name: "마크다운", exact: true }).click();
      await expect(body).toHaveValue(markdown);
      await page.getByRole("button", { name: "미리보기", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "본문 미리보기" }),
      ).toContainText("시험 구간은 별도 기준을 따릅니다.");
      await page
        .getByRole("button", { name: "서식 편집", exact: true })
        .click();
      await expect(body.locator("h1")).toHaveText("운영 지침");
      expect(
        await page.evaluate(
          () => (window as unknown as Record<string, unknown>).editorXss,
        ),
      ).toBeUndefined();
      await page.getByLabel("위키 제목").fill("Milkdown 제목만 수정");
      await page
        .getByRole("button", { name: "초안 저장", exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`/wiki/${pageId}\\?version=`));
      const details = await (
        await clients.writer.get(`${base}/wiki/${pageId}`)
      ).json();
      expect(details.version.body).toBe(markdown);
      expect(details.version.number).toBe(2);
      expect(external.length).toBeGreaterThan(0);
      expect(
        external.every((url) => url === "https://no-request.invalid/pixel"),
      ).toBe(true);
      expect(errors).toEqual([]);
    });
    test("모바일에서 표의 행·열과 할 일 상태·링크를 키보드와 공식 도구로 편집한다", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${root}/wiki/new`);
      const body = page.getByRole("textbox", {
        name: "마크다운 본문",
        exact: true,
      });
      await expect(body).toHaveAttribute("contenteditable", "true");
      await body.click();
      await page.getByRole("button", { name: "표 삽입", exact: true }).click();
      const rows = body.locator("table tr");
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThanOrEqual(3);
      await page.keyboard.insertText("상황");
      await page.keyboard.press("Tab");
      await page.keyboard.insertText("주기");
      await page.getByRole("button", { name: "행 추가", exact: true }).click();
      await expect(rows).toHaveCount(rowCount + 1);
      await page.getByRole("button", { name: "열 추가", exact: true }).click();
      await expect(rows.first().locator("th")).toHaveCount(4);
      await page.getByRole("button", { name: "열 삭제", exact: true }).click();
      await expect(rows.first().locator("th")).toHaveCount(3);
      await page
        .getByRole("button", { name: "표 아래로", exact: true })
        .click();
      await page.keyboard.insertText("공개 원문 확인");
      await page
        .getByRole("button", { name: "할 일 목록", exact: true })
        .click();
      const done = page.getByRole("checkbox", {
        name: "현재 할 일 완료",
        exact: true,
      });
      await done.focus();
      await page.keyboard.press("Space");
      await expect(done).toBeChecked();
      await page
        .getByRole("button", { name: "링크 삽입", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "링크 삽입" });
      await dialog.getByLabel("표시 문구").fill("공식 안내");
      await dialog.getByLabel("링크 주소").fill("javascript:alert(1)");
      await dialog.getByRole("button", { name: "링크 적용" }).click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      await dialog.getByLabel("링크 주소").fill("https://example.com/guide");
      await dialog.getByRole("button", { name: "링크 적용" }).click();
      await expect(dialog).toBeHidden();
      await expect(
        body.getByRole("link", { name: "공식 안내" }),
      ).toHaveAttribute("href", "https://example.com/guide");
      await page.getByRole("button", { name: "마크다운", exact: true }).click();
      await expect(body).toHaveValue(/\[x\] 공개/);
      await expect(body).toHaveValue(
        /\[공식 안내\]\(https:\/\/example.com\/guide\)/,
      );
      await page
        .getByRole("button", { name: "서식 편집", exact: true })
        .click();
      await expect(body.locator("table")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .locator(".editor-toolbar")
          .evaluate((node) => getComputedStyle(node).flexDirection),
      ).toBe("row");
      expect(
        await page
          .locator(".editor-toolbar")
          .evaluate((node) => node.getBoundingClientRect().height),
      ).toBeLessThan(180);
      await page
        .locator(".markdown-editor-field")
        .screenshot({ path: "test-results/milkdown-mobile.png" });
    });
    test("저장 실패·새로고침 뒤 서식 초안을 복원하고 초과 입력과 버리기를 처리한다", async ({
      page,
    }) => {
      await page.goto(`${root}/wiki/new`);
      const body = page.getByRole("textbox", {
        name: "마크다운 본문",
        exact: true,
      });
      await expect(body).toHaveAttribute("contenteditable", "true");
      await page.getByLabel("위키 제목").fill("Milkdown 복원 시험");
      await body.fill("저장할 마지막 문장입니다.");
      await body.press("ControlOrMeta+a");
      await page.getByRole("button", { name: "굵게", exact: true }).click();
      await page.route(
        `**${base}/wiki`,
        (route) =>
          route.fulfill({ status: 500, json: { error: "저장 실패 표본" } }),
        { times: 1 },
      );
      await page
        .getByRole("button", { name: "초안 저장", exact: true })
        .click();
      await expect(
        page.getByRole("alert").filter({ hasText: "저장 실패 표본" }),
      ).toBeVisible();
      await expect(body.locator("strong")).toHaveText(
        "저장할 마지막 문장입니다.",
      );
      page.once("dialog", (dialog) => dialog.accept());
      await page.reload();
      await expect(
        page.getByText("이 탭에 남아 있던 임시 초안을 복원했습니다."),
      ).toBeVisible();
      await expect(body.locator("strong")).toHaveText(
        "저장할 마지막 문장입니다.",
      );
      await body.fill("가".repeat(40001));
      await expect(
        page.getByRole("button", { name: "초안 저장", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByText("본문이 저장 한도를 넘었습니다. 내용을 줄여 주세요."),
      ).toBeVisible();
      await expect(body).toHaveText("가".repeat(40001));
      page.once("dialog", (dialog) => dialog.accept());
      await page.reload();
      await expect(body).toHaveText("가".repeat(40001));
      await expect(
        page.getByRole("button", { name: "초안 저장", exact: true }),
      ).toBeDisabled();
      await page.getByRole("button", { name: "임시 초안 버리기" }).click();
      await expect(body).toHaveText("");
      await expect(page.getByLabel("위키 제목")).toHaveValue("");
      await expect(
        page.getByText("작성 내용을 이 탭에 임시 보관하고 있습니다."),
      ).toHaveCount(0);
    });
  });
}
