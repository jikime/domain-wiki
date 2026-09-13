import { randomUUID } from "node:crypto";
import {
  type APIRequestContext,
  expect,
  type Locator,
  test,
} from "@playwright/test";
import { Pool } from "pg";
import { buildSelectionPrompt } from "../src/lib/reference/selection-prompt";
import type { SelectionInput } from "../src/lib/selection-assistance";

type Fixture = {
  workspaceId: string;
  accounts: { id: string; role: string }[];
};
const events = async (
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
) =>
  (await response.text())
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
async function selectText(input: Locator, text: string) {
  await input.focus();
  await input.evaluate((element: HTMLTextAreaElement, selected) => {
    const start = element.value.indexOf(selected);
    element.setSelectionRange(start, start);
  }, text);
  for (const _ of text) await input.press("Shift+ArrowRight");
}
export function registerOriginalSelectionTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("원본 기능 복원 — 선택 문장 AI", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const domainId = randomUUID(),
      pageId = randomUUID(),
      versionId = randomUUID(),
      sourceId = randomUUID(),
      sourceVersionId = randomUUID(),
      chunkId = randomUUID();
    const base = `/api/workspaces/${f.workspaceId}`,
      root = `/w/${f.workspaceId}`;
    const body =
      "# 검수 안내\n\n검수 기록은 사흘 동안 보관합니다.\n\n비공개 개인정보를 별도로 기록하지 않습니다.";
    const author = f.accounts.find((a) => a.role === "writer")?.id;
    let completedTurn: { id: string; question: string; answer: string };
    const input = (
      instruction = "검수 기록 보관 조건을 설명해 주세요.",
    ): SelectionInput => ({
      action: "generate",
      requestId: randomUUID(),
      intent: "ask",
      instruction,
      scope: {
        domainId,
        projectId: null,
        pageId,
        versionId,
        latestVersionId: null,
      },
      selection: {
        start: body.indexOf("검수 기록"),
        end:
          body.indexOf("검수 기록") +
          "검수 기록은 사흘 동안 보관합니다.".length,
        selectedText: "검수 기록은 사흘 동안 보관합니다.",
        sourceMapped: true,
      },
      history: [],
    });
    const newDraft = async (content = body) => {
      const response = await clients.writer.post(`${base}/wiki`, {
        data: {
          title: "선택 문장 편집",
          body: content,
          domainId,
          projectId: null,
          parentVersionId: null,
          basePublishedVersionId: null,
          chunkIds: [],
        },
      });
      expect(response.status()).toBe(201);
      return response.json();
    };
    test.beforeAll(async () => {
      await pool.query(
        "INSERT INTO domain(id,workspace_id,name,purpose) VALUES($1,$2,'선택 문장 표본','원본 선택 동작 검증')",
        [domainId, f.workspaceId],
      );
      await pool.query(
        "INSERT INTO source(id,workspace_id,domain_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,'보관 규정','guideline',$4,$5,$5,1)",
        [sourceId, f.workspaceId, domainId, author, sourceVersionId],
      );
      await pool.query(
        "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'retention.md','text/markdown',$4,$4,100,$5,'published','completed')",
        [sourceVersionId, f.workspaceId, sourceId, randomUUID(), author],
      );
      await pool.query(
        "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,0,'검수 기록은 72시간 보관합니다.',$4)",
        [
          chunkId,
          f.workspaceId,
          sourceVersionId,
          { kind: "lines", startLine: 1, endLine: 1 },
        ],
      );
      await pool.query(
        "INSERT INTO wiki_page(id,workspace_id,domain_id,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,$5,$5,1)",
        [pageId, f.workspaceId, domainId, author, versionId],
      );
      await pool.query(
        "INSERT INTO wiki_version(id,workspace_id,page_id,number,title,body,author_id,state,metadata) VALUES($1,$2,$3,1,'검수 기록 보관',$4,$5,'approved',$6)",
        [
          versionId,
          f.workspaceId,
          pageId,
          body,
          author,
          {
            type: "concept",
            aliases: [],
            links: [],
            path: "wiki/concepts/retention.md",
          },
        ],
      );
      await pool.query(
        "INSERT INTO wiki_evidence(workspace_id,version_id,chunk_id) VALUES($1,$2,$3)",
        [f.workspaceId, versionId, chunkId],
      );
    });
    test.afterAll(async () => {
      await pool.end();
    });
    test("원본 프롬프트와 앞뒤 1200자, 공개 위키 출처·후속 질문·사용량을 유지한다", async () => {
      const prompt = buildSelectionPrompt(
        "edit",
        "wiki/concepts/retention.md",
        "줄여 주세요",
        {
          prefix: "앞".repeat(1300),
          selectedText: "선택",
          suffix: "뒤".repeat(1300),
          sourceMapped: true,
        },
        [],
      );
      expect(prompt).toContain(
        "Return only the replacement text without explanation or an outer Markdown fence.",
      );
      expect(prompt).toContain("앞".repeat(1200));
      expect(prompt).not.toContain("앞".repeat(1201));
      expect(prompt).toContain("뒤".repeat(1200));
      expect(prompt).not.toContain("뒤".repeat(1201));
      const data = input();
      const response = await clients.reader.post(
        `${base}/selection-assistance`,
        { data },
      );
      expect(response.status()).toBe(200);
      const records = await events(response);
      expect(
        records.find((event) => event.type === "references").references,
      ).toMatchObject([
        {
          key: "1",
          title: "검수 기록 보관",
          href: `${root}/wiki/${pageId}?version=${versionId}`,
        },
      ]);
      const answer = records
        .filter((event) => event.type === "token")
        .map((event) => event.text)
        .join("");
      expect(answer).toContain("72시간");
      expect(
        records.find((event) => event.type === "done").linkDestinations,
      ).toEqual({
        "#concepts%2Fretention": `${root}/wiki/${pageId}`,
      });
      completedTurn = {
        id: records.find((event) => event.type === "done").id,
        question: data.instruction,
        answer,
      };
      const row = (
        await pool.query(
          "SELECT state,result,input_tokens,output_tokens FROM generation WHERE id=$1",
          [completedTurn.id],
        )
      ).rows[0];
      expect(row).toMatchObject({
        state: "completed",
        input_tokens: 120,
        output_tokens: 40,
      });
      expect(JSON.stringify(row.result)).not.toContain("검수 기록");
      expect(JSON.stringify(row.result)).not.toContain(answer);
      const follow = await clients.reader.post(`${base}/selection-assistance`, {
        data: {
          ...input("후속으로 보관 기간을 다시 설명해 주세요."),
          history: [completedTurn],
        },
      });
      expect(follow.status()).toBe(200);
      expect(await follow.text()).toContain("앞선 질문");
      const stats = await (
        await clients.reader.get("http://127.0.0.1:3102/stats")
      ).json();
      expect(stats.temperatures.at(-1)).toBe(0.4);
      const call = stats.calls.at(-1);
      expect(call[0].content).toBe(completedTurn.question);
      expect(call[1].content).toBe(answer);
      expect(call.at(-1).content).toContain("File: wiki/concepts/retention.md");
      expect(
        (
          await clients.reader.post(`${base}/selection-assistance`, { data })
        ).status(),
      ).toBe(409);
      expect(
        (
          await clients.reader.post(`${base}/selection-assistance`, {
            data: {
              ...input(),
              history: [{ ...completedTurn, answer: "바뀐 답변" }],
            },
          })
        ).status(),
      ).toBe(409);
    });
    test("독자 수정·다른 공간·비공개 초안·잘못된 선택 위치를 차단한다", async () => {
      const data = {
        ...input(),
        intent: "edit",
        body,
        scope: { ...input().scope, latestVersionId: versionId },
      };
      expect(
        (
          await clients.reader.post(`${base}/selection-assistance`, { data })
        ).status(),
      ).toBe(403);
      expect(
        (
          await clients.outsider.post(`${base}/selection-assistance`, {
            data: input(),
          })
        ).status(),
      ).toBe(404);
      const draft = await newDraft();
      expect(
        (
          await clients.reader.post(`${base}/selection-assistance`, {
            data: {
              ...input(),
              scope: {
                ...input().scope,
                pageId: draft.pageId,
                versionId: draft.versionId,
              },
            },
          })
        ).status(),
      ).toBe(404);
      expect(
        (
          await clients.writer.post(`${base}/selection-assistance`, {
            data: { ...data, selection: { ...data.selection, start: 0 } },
          })
        ).status(),
      ).toBe(409);
      expect(
        (
          await clients.writer.post(`${base}/selection-assistance`, {
            data: {
              ...data,
              selection: { ...data.selection, sourceMapped: false },
            },
          })
        ).status(),
      ).toBe(400);
      const ambiguous = await clients.reader.post(
        `${base}/selection-assistance`,
        {
          data: {
            ...input(),
            selection: { ...input().selection, sourceMapped: false },
          },
        },
      );
      expect(ambiguous.status()).toBe(200);
      expect(await ambiguous.text()).toContain('"type":"done"');
    });
    test("390px에서 수정안·단어 차이를 검토하고 선택 범위만 바꾼 초안을 저장한다", async ({
      page,
    }) => {
      const draft = await newDraft();
      await page
        .context()
        .addCookies((await clients.writer.storageState()).cookies);
      await page.setViewportSize({ width: 390, height: 960 });
      await page.goto(`${root}/wiki/${draft.pageId}/edit`);
      await page.getByRole("button", { name: "마크다운", exact: true }).click();
      const editor = page.getByRole("textbox", {
        name: "마크다운 본문",
        exact: true,
      });
      await selectText(editor, "검수 기록은 사흘 동안 보관합니다.");
      const panel = page.getByRole("region", { name: "선택 문장 AI 도우미" });
      await panel
        .getByRole("textbox", { name: "선택 문장에 요청할 내용" })
        .fill("보관 시간을 숫자로 고쳐 주세요.");
      await panel.getByRole("button", { name: "수정안 만들기" }).click();
      await expect(
        panel.getByRole("textbox", { name: "검토할 수정안" }),
      ).toHaveValue("검수 기록은 72시간 보관합니다.");
      await expect(panel.locator(".selection-diff ins")).toContainText("72");
      await expect(panel.getByRole("button", { name: "질문하기" })).toHaveCount(
        0,
      );
      const before = await (
        await clients.writer.get(`${base}/wiki/${draft.pageId}`)
      ).json();
      expect(before.version.body).toBe(body);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        window.getSelection()?.removeAllRanges();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: ".local/parity-selection-390.png",
        fullPage: true,
      });
      await panel
        .getByRole("textbox", { name: "검토할 수정안" })
        .fill("검수 기록은 72시간 동안 보관합니다.");
      await panel
        .getByRole("button", { name: "편집 중인 본문에 적용" })
        .click();
      const changed = body.replace("사흘", "72시간");
      await expect(editor).toHaveValue(changed);
      await page
        .getByRole("button", { name: "초안 저장", exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/wiki/${draft.pageId}\\?version=`),
      );
      const saved = await (
        await clients.writer.get(`${base}/wiki/${draft.pageId}`)
      ).json();
      expect(saved.version.body).toBe(changed);
      expect(saved.version.state).toBe("draft");
      expect(saved.page.publishedVersionId).toBeNull();
    });
    test("미리보기의 반복 문장도 선택한 블록으로 연결하고 로컬 변경 뒤 적용을 막는다", async ({
      page,
    }) => {
      const content =
        "---\r\ntitle: 반복 문장\r\n---\r\n\r\n같은 문장입니다.\r\n\r\n같은 문장입니다.";
      const draft = await newDraft(content);
      await page
        .context()
        .addCookies((await clients.writer.storageState()).cookies);
      await page.goto(`${root}/wiki/${draft.pageId}/edit`);
      await page.getByRole("button", { name: "미리보기", exact: true }).click();
      const preview = page.getByRole("region", { name: "본문 미리보기" });
      const para = preview.locator(".wiki-markdown p").last();
      await para.evaluate((element) => {
        const text = element.firstChild;
        if (!text) throw new Error("선택할 문장이 없습니다.");
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, element.textContent?.length ?? 0);
        const selected = window.getSelection();
        selected?.removeAllRanges();
        selected?.addRange(range);
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
      const panel = page.getByRole("region", { name: "선택 문장 AI 도우미" });
      await panel
        .getByRole("textbox", { name: "선택 문장에 요청할 내용" })
        .fill("문장을 고쳐 주세요.");
      await panel.getByRole("button", { name: "수정안 만들기" }).click();
      await expect(
        panel.getByRole("button", { name: "편집 중인 본문에 적용" }),
      ).toBeEnabled();
      await panel
        .getByRole("button", { name: "편집 중인 본문에 적용" })
        .click();
      await expect(panel).toHaveCount(0);
      await page.getByRole("button", { name: "마크다운", exact: true }).click();
      const editor = page.getByRole("textbox", {
        name: "마크다운 본문",
        exact: true,
      });
      await expect(editor).toHaveValue(
        "---\ntitle: 반복 문장\n---\n\n같은 문장입니다.\n\n검수 기록은 72시간 보관합니다.",
      );
      await selectText(editor, "같은 문장입니다.");
      await panel
        .getByRole("textbox", { name: "선택 문장에 요청할 내용" })
        .fill("이 문장도 고쳐 주세요.");
      await panel.getByRole("button", { name: "수정안 만들기" }).click();
      await expect(
        panel.getByRole("button", { name: "편집 중인 본문에 적용" }),
      ).toBeEnabled();
      await editor.fill("사용자가 새로 작성한 본문입니다.");
      await expect(panel).toContainText(
        "선택한 뒤 본문이나 범위가 바뀌었습니다.",
      );
      await expect(
        panel.getByRole("button", { name: "편집 중인 본문에 적용" }),
      ).toBeDisabled();
    });
    test("읽기 화면에서 출처와 후속 질문을 표시하고 생성 중지 후 부분 답변을 지운다", async ({
      page,
    }) => {
      await page
        .context()
        .addCookies((await clients.reader.storageState()).cookies);
      await page.goto(`${root}/wiki/${pageId}`);
      const para = page
        .getByRole("region", { name: "선택하여 질문할 본문" })
        .locator("p")
        .first();
      await para.evaluate((element) => {
        const text = element.firstChild;
        if (!text) throw new Error("선택할 문장이 없습니다.");
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, element.textContent?.length ?? 0);
        const selected = window.getSelection();
        selected?.removeAllRanges();
        selected?.addRange(range);
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
      const panel = page.getByRole("region", { name: "선택 문장 AI 도우미" });
      await panel
        .getByRole("textbox", { name: "선택 문장에 요청할 내용" })
        .fill("검수 기록을 설명해 주세요.");
      await panel.getByRole("button", { name: "질문하기" }).click();
      await expect(
        panel.getByRole("textbox", { name: "이어서 질문" }),
      ).toBeEnabled();
      await expect(
        panel.getByRole("link", { name: "보관 기준 문서" }),
      ).toHaveAttribute("href", `${root}/wiki/${pageId}`);
      await panel
        .getByRole("button", { name: "출처 1: 검수 기록 보관" })
        .click();
      await expect(
        panel.getByRole("complementary", { name: "선택 문장 답변 출처" }),
      ).toContainText("검수 기록");
      await panel
        .getByRole("textbox", { name: "이어서 질문" })
        .fill("후속 지연 설명을 해 주세요.");
      await panel.getByRole("button", { name: "질문하기" }).click();
      await expect(panel.locator(".wiki-markdown").last()).toContainText(
        "앞선 질문",
        { timeout: 8000 },
      );
      await panel.getByRole("button", { name: "생성 중지" }).click();
      await expect(panel).not.toContainText("앞선 질문");
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT state FROM generation WHERE workspace_id=$1 AND kind='selection-ask' ORDER BY created_at DESC LIMIT 1",
                [f.workspaceId],
              )
            ).rows[0].state,
        )
        .toBe("failed");
      await expect(
        panel.getByRole("button", { name: "수정안 만들기" }),
      ).toHaveCount(0);
    });
    test("생성 도중 다른 버전이 저장되면 중지하고 적용 확인도 거절한다", async () => {
      const draft = await newDraft();
      const data: SelectionInput = {
        ...input("지연 수정 요청"),
        intent: "edit",
        body,
        scope: {
          domainId,
          projectId: null,
          pageId: draft.pageId,
          versionId: draft.versionId,
          latestVersionId: draft.versionId,
        },
      };
      const pending = clients.writer.post(`${base}/selection-assistance`, {
        data,
      });
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM generation WHERE request_id=$1 AND state='running'",
                [data.requestId],
              )
            ).rows[0].n,
        )
        .toBe(1);
      const saved = await clients.writer.post(`${base}/wiki/${draft.pageId}`, {
        data: {
          title: "다른 버전",
          body: "새 문서 본문",
          domainId,
          projectId: null,
          parentVersionId: draft.versionId,
          basePublishedVersionId: null,
          chunkIds: [],
        },
      });
      expect(saved.status()).toBe(201);
      const records = await events(await pending);
      expect(records.some((event) => event.type === "done")).toBe(false);
      expect(records.find((event) => event.type === "error").error).toContain(
        "새 버전",
      );
      expect(
        (
          await clients.writer.post(`${base}/selection-assistance`, {
            data: { ...data, action: "validate", requestId: randomUUID() },
          })
        ).status(),
      ).toBe(409);
    });
    test("수정 생성 중 작성 권한이 사라지면 중지한다", async () => {
      const draft = await newDraft();
      const data: SelectionInput = {
        ...input("지연 수정 권한 시험"),
        intent: "edit",
        body,
        scope: {
          domainId,
          projectId: null,
          pageId: draft.pageId,
          versionId: draft.versionId,
          latestVersionId: draft.versionId,
        },
      };
      const pending = clients.writer.post(`${base}/selection-assistance`, {
        data,
      });
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM generation WHERE request_id=$1 AND state='running'",
                [data.requestId],
              )
            ).rows[0].n,
        )
        .toBe(1);
      try {
        await pool.query(
          "UPDATE membership SET role='reader' WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, author],
        );
        const records = await events(await pending);
        expect(records.some((event) => event.type === "done")).toBe(false);
        expect(records.find((event) => event.type === "error").error).toContain(
          "작성 직원 권한",
        );
      } finally {
        await pool.query(
          "UPDATE membership SET role='writer' WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, author],
        );
      }
    });
    test("공개 근거가 철회되면 진행 중 답변·저장된 대화의 후속 질문을 차단한다", async () => {
      const authorQuestion = input();
      const authorResponse = await clients.writer.post(
        `${base}/selection-assistance`,
        { data: authorQuestion },
      );
      const authorEvents = await events(authorResponse);
      const authorTurn = {
        id: authorEvents.find((e) => e.type === "done").id,
        question: authorQuestion.instruction,
        answer: authorEvents
          .filter((e) => e.type === "token")
          .map((e) => e.text)
          .join(""),
      };
      const data = input("지연 답변 요청");
      const pending = clients.reader.post(`${base}/selection-assistance`, {
        data,
      });
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM generation WHERE request_id=$1 AND state='running'",
                [data.requestId],
              )
            ).rows[0].n,
        )
        .toBe(1);
      await pool.query(
        "UPDATE source SET published_version_id=NULL WHERE id=$1",
        [sourceId],
      );
      const records = await events(await pending);
      expect(records.some((event) => event.type === "done")).toBe(false);
      expect(records.some((event) => event.type === "error")).toBe(true);
      const reader = await clients.reader.post(`${base}/selection-assistance`, {
        data: { ...input(), history: [completedTurn] },
      });
      expect(reader.status()).toBe(404);
      expect(
        (
          await clients.writer.post(`${base}/selection-assistance`, {
            data: { ...input(), history: [authorTurn] },
          })
        ).status(),
      ).toBe(409);
      // The author can still read their historical wiki, but cannot reuse a revoked citation.
      const authorAsk = await clients.writer.post(
        `${base}/selection-assistance`,
        { data: input() },
      );
      expect(authorAsk.status()).toBe(200);
      expect(
        (await events(authorAsk)).find((event) => event.type === "references")
          .references,
      ).toEqual([]);
    });
  });
}
