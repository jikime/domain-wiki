import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";

type Fixture = {
  workspaceId: string;
  outsiderWorkspaceId: string;
  domainId: string;
  outsiderDomainId: string;
  accounts: { id: string; role: string; email: string; password: string }[];
};
export function registerChatTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("3단계 대화와 검색 계약", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const base = `/api/workspaces/${f.workspaceId}`;
    const root = `/w/${f.workspaceId}`;
    const source = randomUUID(),
      version = randomUUID(),
      chunk = randomUUID(),
      wiki = randomUUID(),
      wikiVersion = randomUUID();
    let id = "",
      runId = "";
    const scope = {
      domainId: f.domainId,
      projectId: null,
      sourceId: source,
      wikiId: null,
    };
    const events = (text: string) =>
      text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => JSON.parse(l.slice(5)));
    const ask = (prompt: string, requestId = randomUUID(), conversation = id) =>
      clients.reader.post(`${base}/conversations/${conversation}/stream`, {
        data: { prompt, requestId },
      });
    test.beforeAll(async () => {
      const author = f.accounts.find((a) => a.role === "writer")?.id;
      await pool.query(
        "INSERT INTO source(id,workspace_id,domain_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,'채팅 계약 표본 관제','guideline',$4,$5,$5,1)",
        [source, f.workspaceId, f.domainId, author, version],
      );
      await pool.query(
        "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'chat-fixture.md','text/markdown',$4,$4,10,$5,'published','completed')",
        [version, f.workspaceId, source, randomUUID(), author],
      );
      await pool.query(
        "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,0,'관제 화면은 30초마다 갱신합니다. 모든 화면에 일괄 적용하지 않습니다. 재연결 상태를 확인합니다.',$4)",
        [
          chunk,
          f.workspaceId,
          version,
          { kind: "lines", startLine: 1, endLine: 3, heading: "계약 표본" },
        ],
      );
      await pool.query(
        "INSERT INTO wiki_page(id,workspace_id,domain_id,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,$5,$5,1)",
        [wiki, f.workspaceId, f.domainId, author, wikiVersion],
      );
      await pool.query(
        "INSERT INTO wiki_version(id,workspace_id,page_id,number,title,body,author_id,state) VALUES($1,$2,$3,1,'관제 갱신 절차','관제 화면은 30초마다 갱신합니다. 모든 화면에 일괄 적용하지 않습니다.',$4,'approved')",
        [wikiVersion, f.workspaceId, wiki, author],
      );
      await pool.query(
        "INSERT INTO wiki_evidence(workspace_id,version_id,chunk_id) VALUES($1,$2,$3)",
        [f.workspaceId, wikiVersion, chunk],
      );
    });
    test.afterAll(async () => {
      await pool.end();
    });
    test("본인 대화 저장·범위 검증과 관리자 포함 타인 조회 차단", async () => {
      const r = await clients.reader.post(`${base}/conversations`, {
        data: { scope },
      });
      expect(r.status()).toBe(201);
      id = (await r.json()).id;
      for (const role of ["writer", "admin", "outsider"]) {
        expect(
          (await clients[role].get(`${base}/conversations/${id}`)).status(),
        ).toBe(404);
        expect(
          (
            await clients[role].post(`${base}/conversations/${id}/stream`, {
              data: { requestId: randomUUID(), prompt: "관제" },
            })
          ).status(),
        ).toBe(404);
      }
      expect(
        (
          await clients.reader.post(`${base}/conversations`, {
            data: { scope: { ...scope, domainId: f.outsiderDomainId } },
          })
        ).status(),
      ).toBe(404);
      expect((await clients.reader.get(`${base}/conversations`)).status()).toBe(
        200,
      );
      expect(
        (await (await clients.reader.get(`${base}/conversations/${id}`)).json())
          .conversation.scope,
      ).toEqual(scope);
    });
    test("pgvector에 공개 자료 색인 후 결합 검색·SSE 분할·정상 인용·중복 요청을 검증", async () => {
      const index = spawnSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "scripts/index-content.ts",
        ],
        { env: process.env, encoding: "utf8" },
      );
      expect(index.status, index.stderr).toBe(0);
      const requestId = randomUUID();
      const response = await ask("관제 갱신 주기는?", requestId);
      expect(response.status()).toBe(200);
      const stream = events(await response.text());
      expect(stream.find((e) => e.type === "sources").mode).toBe("hybrid");
      const done = stream.find((e) => e.type === "done");
      expect(done).toBeTruthy();
      expect(done.runs.at(-1).state).toBe("completed");
      expect(
        done.runs
          .at(-1)
          .messages.find((m: { role: string }) => m.role === "assistant").body,
      ).toContain("30초");
      expect(
        done.runs.at(-1).citations.some((c: { used: boolean }) => c.used),
      ).toBe(true);
      runId = done.runs.at(-1).id;
      const countBefore = Number(
        (
          await pool.query(
            "SELECT count(*) FROM chat_run WHERE conversation_id=$1",
            [id],
          )
        ).rows[0].count,
      );
      const duplicate = events(
        await (await ask("관제 갱신 주기는?", requestId)).text(),
      );
      expect(duplicate[0].replay).toBe(true);
      expect(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM chat_run WHERE conversation_id=$1",
              [id],
            )
          ).rows[0].count,
        ),
      ).toBe(countBefore);
      expect((await ask("변경된 질문", requestId)).status()).toBe(409);
    });
    test("후속 질문은 현재 근거를 다시 검색하고 피드백만 검토함에 전달", async () => {
      const response = events(await (await ask("후속 재연결 조건은?")).text());
      expect(response.find((e) => e.type === "done").runs.at(-1).state).toBe(
        "completed",
      );
      const stats = await (
        await clients.reader.get("http://127.0.0.1:3102/stats")
      ).json();
      expect(
        stats.calls.at(-1).filter((m: { role: string }) => m.role === "user"),
      ).toHaveLength(2);
      expect(
        (
          await clients.reader.post(`${base}/conversations/${id}`, {
            data: {
              runId,
              rating: "incorrect",
              note: "표본 적용 범위를 확인해주세요.",
            },
          })
        ).status(),
      ).toBe(200);
      const review = await (
        await clients.reviewer.get(`${base}/reviews`)
      ).json();
      expect(review.feedback[0].note).toContain("적용 범위");
      expect(JSON.stringify(review.feedback)).not.toContain("30초");
      expect(JSON.stringify(review.feedback)).not.toContain("관제 갱신 주기는");
    });
    test("잘못된 인용·모델 오류·완료 전 연결 단절은 성공 답변으로 저장하지 않는다", async () => {
      for (const prompt of [
        "관제 잘못된인용",
        "관제 모델오류",
        "관제 강제단절",
      ]) {
        const stream = events(await (await ask(prompt)).text());
        expect(stream.some((e) => e.type === "error")).toBe(true);
        const detail = await (
          await clients.reader.get(`${base}/conversations/${id}`)
        ).json();
        expect(detail.runs.at(-1).state).toBe("failed");
        expect(
          detail.runs
            .at(-1)
            .messages.find((m: { role: string }) => m.role === "assistant")
            .body,
        ).not.toContain("30초");
      }
    });
    test("진행 중 중지·동시 질문·범위 변경·클라이언트 단절을 검증", async () => {
      const pending = ask("관제 지연 응답");
      await expect
        .poll(async () =>
          Number(
            (
              await pool.query(
                "SELECT count(*) FROM chat_run WHERE conversation_id=$1 AND state='running'",
                [id],
              )
            ).rows[0].count,
          ),
        )
        .toBe(1);
      const running = (
        await pool.query(
          "SELECT id FROM chat_run WHERE conversation_id=$1 AND state='running'",
          [id],
        )
      ).rows[0].id;
      expect((await ask("관제 두 번째 질문")).status()).toBe(409);
      expect(
        (
          await clients.reader.patch(`${base}/conversations/${id}`, {
            data: { title: "범위 변경", scope },
          })
        ).status(),
      ).toBe(409);
      expect(
        (
          await clients.reader.post(`${base}/conversations/${id}`, {
            data: { action: "cancel", runId: running },
          })
        ).status(),
      ).toBe(200);
      await pending;
      expect(
        (await pool.query("SELECT state FROM chat_run WHERE id=$1", [running]))
          .rows[0].state,
      ).toBe("canceled");
      const cookies = (await clients.reader.storageState()).cookies
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
      const abort = new AbortController();
      const response = await fetch(
        `http://localhost:3101${base}/conversations/${id}/stream`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3101",
            Cookie: cookies,
          },
          body: JSON.stringify({
            requestId: randomUUID(),
            prompt: "관제 지연 단절",
          }),
          signal: abort.signal,
        },
      );
      await response.body?.getReader().read();
      abort.abort();
      await expect
        .poll(async () =>
          Number(
            (
              await pool.query(
                "SELECT count(*) FROM chat_run WHERE conversation_id=$1 AND state='running'",
                [id],
              )
            ).rows[0].count,
          ),
        )
        .toBe(0);
      expect(
        (
          await pool.query(
            "SELECT state FROM chat_run WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 1",
            [id],
          )
        ).rows[0].state,
      ).toBe("interrupted");
    });
    test("브라우저에서 질문·출처 선택·새로고침·모바일 근거 패널을 확인", async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: await clients.reader.storageState(),
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await page.goto(`${root}/chat?conversation=${id}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const input = page.getByLabel("업무 질문", { exact: true });
        await input.fill("관제 갱신 조건은?");
        await page.getByRole("button", { name: "질문 보내기" }).click();
        await expect(page.locator(".chat-turn").last()).toContainText("30초");
        await expect(input).toBeEnabled();
        await page.reload();
        const last = page.locator(".chat-turn").last();
        await expect(last).toContainText("30초");
        const references = page.getByRole("complementary", {
          name: "답변의 원문 근거",
        });
        await expect(references).toHaveCount(0);
        const citation = last.getByRole("button", { name: /^출처 E1:/ });
        await citation.click();
        await expect(references).toBeVisible();
        // Original title weighting ranks the matching wiki above the source.
        const href = `${root}/wiki/${wiki}?version=${wikiVersion}`;
        await expect(references.getByRole("link").first()).toHaveAttribute(
          "href",
          href,
        );
        await expect(references.locator('[data-citation="E1"]')).toBeFocused();
        await page.screenshot({
          path: "test-results/hince-chat-citations-1440.png",
        });
        await page.keyboard.press("Escape");
        await expect(references).toHaveCount(0);
        await expect(citation).toBeFocused();
        await last.getByRole("button", { name: /^참고 자료/ }).click();
        await references
          .getByRole("link", { name: "해당 원문 열기" })
          .first()
          .click();
        await expect(page.getByRole("heading", { level: 1 })).toContainText(
          /관제/,
        );
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${root}/chat?conversation=${id}`);
        await expect(page.locator(".chat-turn").last()).toContainText("30초");
        const geometry = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - innerWidth,
          bottom: document
            .querySelector(".chat-composer")
            ?.getBoundingClientRect().bottom,
        }));
        expect(geometry.overflow).toBeLessThanOrEqual(0);
        expect(geometry.bottom).toBeLessThanOrEqual(844);
        await page.screenshot({
          path: "test-results/stage-03-chat-mobile.png",
        });
        const mobileCitation = page
          .locator(".chat-turn")
          .last()
          .getByRole("button", { name: /^출처 E1:/ });
        await mobileCitation.click();
        const sheet = page.getByRole("dialog", { name: "답변의 원문 근거" });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole("link").first()).toHaveAttribute(
          "href",
          href,
        );
        await page.screenshot({
          path: "test-results/chat-ux-reference-390.png",
          animations: "disabled",
        });
        await page.keyboard.press("Escape");
        await expect(sheet).toBeHidden();
        await expect(mobileCitation).toBeFocused();
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
    test("답변 의견은 저장 후 접히고 재열기·새로고침·본인 내역·검토함에 반영된다", async ({
      browser,
    }) => {
      test.setTimeout(60_000);
      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 390, height: 844 },
      ]) {
        const response = await clients.reader.post(`${base}/conversations`, {
          data: { title: "답변 의견 화면 확인", scope },
        });
        expect(response.status()).toBe(201);
        const conversationId = (await response.json()).id;
        const feedbackRunId = randomUUID();
        const endpoint = `${base}/conversations/${conversationId}`;
        const context = await browser.newContext({
          storageState: await clients.reader.storageState(),
          viewport,
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        try {
          await pool.query(
            "INSERT INTO chat_run(id,workspace_id,conversation_id,request_id,prompt,scope,state) VALUES($1,$2,$3,$4,'개인 질문 표본',$5,'completed')",
            [feedbackRunId, f.workspaceId, conversationId, randomUUID(), scope],
          );
          await pool.query(
            "INSERT INTO chat_message(workspace_id,run_id,role,body) VALUES($1,$2,'assistant','개인 답변 표본')",
            [f.workspaceId, feedbackRunId],
          );
          await page.goto(`${root}/chat?conversation=${conversationId}`);
          const feedback = page.locator(".chat-feedback");
          const toggle = feedback.locator("summary");
          const note = feedback.getByLabel("확인할 내용");
          const rating = feedback.getByRole("combobox", { name: "답변 평가" });
          const send = feedback.getByRole("button", { name: "의견 보내기" });
          const text = `조건 설명이 도움이 됐습니다. ${viewport.width}`;
          await toggle.click();
          await rating.click();
          await page.getByRole("option", { name: "도움이 되었어요" }).click();
          await note.fill(`  ${text}  `);
          await page.route(`**${endpoint}`, async (route) => {
            if (route.request().method() !== "POST") return route.continue();
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "잠시 후 다시 보내주세요." }),
            });
          });
          await send.click();
          await expect(feedback.getByRole("alert")).toContainText(
            "다시 보내주세요",
          );
          await expect(feedback).toHaveJSProperty("open", true);
          await expect(note).toHaveValue(`  ${text}  `);
          await expect(send).toBeEnabled();
          await page.unroute(`**${endpoint}`);
          await send.click();
          await expect(feedback).toHaveJSProperty("open", false);
          await expect(note).toBeHidden();
          await expect(toggle).toBeFocused();
          const link = page.getByRole("link", { name: "내 의견 확인 →" });
          await expect(link).toBeVisible();
          await expect(link).toHaveAttribute(
            "href",
            `${root}/issues#answer-feedback`,
          );
          await toggle.click();
          await expect(note).toHaveValue(text);
          await expect(rating).toContainText("도움이 되었어요");
          await page.reload();
          await expect(feedback).toHaveJSProperty("open", false);
          await toggle.click();
          await expect(note).toHaveValue(text);
          await expect(rating).toContainText("도움이 되었어요");
          const updated = `${text} 적용 범위도 확인해주세요.`;
          await note.fill(updated);
          await rating.click();
          await page
            .getByRole("option", { name: "내용이나 근거 수정이 필요해요" })
            .click();
          await send.click();
          await expect(feedback).toHaveJSProperty("open", false);
          await expect(feedback.getByRole("alert")).toHaveCount(0);
          const saved = await pool.query(
            "SELECT rating,note,state FROM chat_feedback WHERE run_id=$1",
            [feedbackRunId],
          );
          expect(saved.rows).toEqual([
            { rating: "incorrect", note: updated, state: "open" },
          ]);
          await link.click();
          await expect(page).toHaveURL(/\/issues#answer-feedback$/);
          const ownItem = page
            .locator("#answer-feedback .decision-row")
            .filter({ hasText: updated });
          await expect(ownItem).toContainText("수정 확인 요청 · 접수");
          const review = await (
            await clients.reviewer.get(`${base}/reviews`)
          ).json();
          expect(
            review.feedback.some(
              (item: { note: string }) => item.note === updated,
            ),
          ).toBe(true);
          expect(JSON.stringify(review.feedback)).not.toContain(
            "개인 질문 표본",
          );
          expect(JSON.stringify(review.feedback)).not.toContain(
            "개인 답변 표본",
          );
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          ).toBe(true);
          expect(errors).toEqual([]);
        } finally {
          await context.close();
          expect((await clients.reader.delete(endpoint)).status()).toBe(200);
        }
      }
    });
    test("새 대화에서 첫 질문 자동 저장·한글 조합·줄바꿈·대화 검색을 확인", async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: await clients.reader.storageState(),
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage();
      const posts: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "POST" && r.url().includes("/conversations"))
          posts.push(r.url());
      });
      try {
        await page.goto(
          `${root}/chat?domainId=${f.domainId}&sourceId=${source}`,
        );
        await expect(
          page.getByRole("heading", { name: "팀의 지식에 질문하세요" }),
        ).toBeVisible();
        await expect(page.locator(".chat-document-scope")).toContainText(
          "채팅 계약 표본 관제",
        );
        const input = page.getByLabel("업무 질문", { exact: true });
        await input.fill("관제");
        await input.dispatchEvent("compositionstart", { data: "제" });
        await input.dispatchEvent("keydown", {
          key: "Enter",
          code: "Enter",
          isComposing: true,
          keyCode: 229,
        });
        await input.dispatchEvent("compositionend", { data: "제" });
        await input.dispatchEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 229,
        });
        await expect(input).toHaveValue("관제");
        expect(posts).toEqual([]);
        await input.press("End");
        await input.press("Shift+Enter");
        await input.pressSequentially("갱신 주기는?");
        await expect(input).toHaveValue("관제\n갱신 주기는?");
        expect(posts).toEqual([]);
        const response = page.waitForResponse(
          (r) => r.url().endsWith("/stream") && r.request().method() === "POST",
        );
        await input.press("Enter");
        expect((await response).status()).toBe(200);
        await expect(page.locator(".chat-turn").last()).toContainText("30초");
        await expect(input).toBeEnabled();
        await expect(page.locator(".chat-question")).toHaveCount(1);
        expect(
          posts.filter((url) => url.endsWith("/conversations")),
        ).toHaveLength(1);
        expect(posts.filter((url) => url.endsWith("/stream"))).toHaveLength(1);
        const createdId = new URL(page.url()).searchParams.get("conversation");
        const saved = await (
          await clients.reader.get(`${base}/conversations/${createdId}`)
        ).json();
        expect(saved.runs).toHaveLength(1);
        expect(saved.runs[0].scope).toEqual(scope);
        await page.screenshot({
          path: "test-results/chat-ux-conversation-1440.png",
        });
        await page
          .getByRole("button", { name: "새 대화", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "팀의 지식에 질문하세요" }),
        ).toBeVisible();
        await expect(input).toHaveValue("");
        const search = page.getByRole("searchbox", { name: "최근 대화 검색" });
        await search.fill("검색 결과에 없는 문장");
        await expect(page.getByText("검색 결과가 없습니다.")).toBeVisible();
        await search.fill("관제");
        await expect(
          page
            .getByRole("navigation", { name: "최근 대화 목록" })
            .getByRole("link")
            .first(),
        ).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole("button", { name: "내 대화 열기" }).click();
        const sheet = page.getByRole("dialog", {
          name: "내 대화",
          exact: true,
        });
        await expect(sheet).toBeVisible();
        await sheet.getByRole("searchbox").fill("검색 결과에 없는 문장");
        await expect(sheet).toContainText("검색 결과가 없습니다.");
        await page.keyboard.press("Escape");
        await expect(sheet).toBeHidden();
        await expect(
          page.getByRole("button", { name: "내 대화 열기" }),
        ).toBeFocused();
      } finally {
        await context.close();
      }
    });
    test("질문 범위 자동 저장·프로젝트 적용·저장 실패 복구를 확인", async ({
      browser,
    }) => {
      const created = await clients.reader.post(`${base}/conversations`, {
        data: { scope, title: "질문 범위 검증" },
      });
      const conversationId = (await created.json()).id;
      const projectId = randomUUID();
      await pool.query(
        "INSERT INTO project(id,workspace_id,domain_id,name,client_name) VALUES($1,$2,$3,'채팅 범위 검증 프로젝트','시험')",
        [projectId, f.workspaceId, f.domainId],
      );
      const endpoint = `${base}/conversations/${conversationId}`;
      const context = await browser.newContext({
        storageState: await clients.reader.storageState(),
      });
      const page = await context.newPage();
      try {
        await page.goto(`${root}/chat?conversation=${conversationId}`);
        await page
          .getByRole("combobox", { name: "프로젝트", exact: true })
          .click();
        const saved = page.waitForResponse(
          (r) => r.url().endsWith(endpoint) && r.request().method() === "PATCH",
        );
        await page
          .getByRole("option", { name: "채팅 범위 검증 프로젝트", exact: true })
          .click();
        expect((await saved).status()).toBe(200);
        await expect(
          page.getByRole("combobox", { name: "프로젝트", exact: true }),
        ).toBeEnabled();
        await expect(page.locator(".chat-document-scope")).toHaveCount(0);
        expect(
          (await (await clients.reader.get(endpoint)).json()).conversation
            .scope,
        ).toEqual({ ...scope, projectId, sourceId: null });
        await page.reload();
        await expect(
          page.getByRole("combobox", { name: "프로젝트", exact: true }),
        ).toContainText("채팅 범위 검증 프로젝트");
        await page.route(`**${endpoint}`, async (route) => {
          if (route.request().method() === "PATCH")
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "시험용 저장 실패" }),
            });
          else await route.continue();
        });
        await page.getByRole("combobox", { name: "질문할 도메인" }).click();
        await page
          .getByRole("option", { name: "모든 도메인", exact: true })
          .click();
        await expect(
          page.getByRole("alert").filter({ hasText: "시험용 저장 실패" }),
        ).toBeVisible();
        await expect(
          page.getByRole("combobox", { name: "질문할 도메인" }),
        ).toContainText("시험 도메인");
        await expect(
          page.getByRole("combobox", { name: "프로젝트", exact: true }),
        ).toContainText("채팅 범위 검증 프로젝트");
        await page.unroute(`**${endpoint}`);
        await page
          .getByRole("combobox", { name: "프로젝트", exact: true })
          .click();
        const reset = page.waitForResponse(
          (r) => r.url().endsWith(endpoint) && r.request().method() === "PATCH",
        );
        await page
          .getByRole("option", { name: "프로젝트 전체", exact: true })
          .click();
        expect((await reset).status()).toBe(200);
        const input = page.getByLabel("업무 질문", { exact: true });
        await input.fill("관제 갱신 조건은?");
        await expect(
          page.getByRole("button", { name: "질문 보내기" }),
        ).toBeEnabled();
        await input.press("Enter");
        await expect(page.locator(".chat-turn").last()).toContainText("30초");
        await expect(input).toBeEnabled();
        const actual = await (await clients.reader.get(endpoint)).json();
        expect(actual.runs.at(-1).scope).toEqual({
          ...scope,
          sourceId: null,
          projectId: null,
        });
      } finally {
        await context.close();
        await pool.query("DELETE FROM project WHERE id=$1", [projectId]);
      }
    });
    test("답변 스트리밍 중 과거 스크롤·최신 답변 이동·생성 중지를 확인", async ({
      browser,
    }) => {
      const created = await clients.reader.post(`${base}/conversations`, {
        data: { scope, title: "긴 대화 스크롤 검증" },
      });
      const conversationId = (await created.json()).id;
      const previousRun = randomUUID();
      await pool.query(
        "INSERT INTO chat_run(id,workspace_id,conversation_id,request_id,prompt,scope,state) VALUES($1,$2,$3,$4,'지난 업무 질문',$5,'completed')",
        [previousRun, f.workspaceId, conversationId, randomUUID(), scope],
      );
      await pool.query(
        "INSERT INTO chat_message(workspace_id,run_id,role,body) VALUES($1,$2,'assistant',$3)",
        [
          f.workspaceId,
          previousRun,
          "이전 업무 기록을 확인합니다. 조건과 예외를 함께 살펴봅니다.\n\n".repeat(
            24,
          ),
        ],
      );
      const context = await browser.newContext({
        storageState: await clients.reader.storageState(),
        viewport: { width: 1440, height: 800 },
      });
      const page = await context.newPage();
      try {
        await page.goto(`${root}/chat?conversation=${conversationId}`);
        const input = page.getByLabel("업무 질문", { exact: true });
        await input.fill("관제 지연 갱신 조건은?");
        await input.press("Enter");
        const pending = page.locator(".chat-pending .wiki-markdown");
        await expect(pending).toContainText("개발 표본");
        const transcript = page.getByRole("region", { name: "대화 내용" });
        await transcript.evaluate((el) => {
          el.scrollTop = 0;
        });
        await expect(
          page.getByRole("button", { name: "최신 답변으로" }),
        ).toBeVisible();
        await expect(pending).toContainText("30초");
        expect(await transcript.evaluate((el) => el.scrollTop)).toBeLessThan(5);
        await page.getByRole("button", { name: "최신 답변으로" }).click();
        await expect
          .poll(() =>
            transcript.evaluate(
              (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
            ),
          )
          .toBeLessThan(80);
        await page
          .getByRole("button", { name: "답변 중지", exact: true })
          .click();
        await expect(input).toBeEnabled();
        await expect(page.locator(".chat-turn").last()).toContainText("중지됨");
        await expect(
          page.getByRole("button", { name: "다시 질문", exact: true }).last(),
        ).toBeVisible();
        await page.setViewportSize({ width: 390, height: 500 });
        expect(
          await page
            .locator(".chat-composer")
            .evaluate((el) => el.getBoundingClientRect().bottom),
        ).toBeLessThanOrEqual(500);
      } finally {
        await context.close();
      }
    });
    test("근거 부족·의미 검색 장애·모델 연결 권한을 분명히 처리한다", async () => {
      const emptyDomain = randomUUID();
      await pool.query(
        "INSERT INTO domain(id,workspace_id,name,purpose) VALUES($1,$2,$3,'시험')",
        [emptyDomain, f.workspaceId, `비어 있는 도메인 ${emptyDomain}`],
      );
      const created = await clients.reader.post(`${base}/conversations`, {
        data: { scope: { domainId: emptyDomain } },
      });
      const emptyId = (await created.json()).id;
      const before = await (
        await clients.reader.get("http://127.0.0.1:3102/stats")
      ).json();
      const stream = events(
        await (await ask("없는 업무 근거", randomUUID(), emptyId)).text(),
      );
      const run = stream.find((e) => e.type === "done").runs.at(-1);
      expect(run.state).toBe("completed");
      expect(run.citations).toHaveLength(0);
      expect(
        run.messages.find((m: { role: string }) => m.role === "assistant").body,
      ).toContain("근거를 찾지 못했습니다");
      const after = await (
        await clients.reader.get("http://127.0.0.1:3102/stats")
      ).json();
      expect(after.calls.length).toBe(before.calls.length);
      const fallback = events(await (await ask("관제 임베딩오류")).text());
      expect(fallback.find((e) => e.type === "sources")).toMatchObject({
        mode: "keyword",
      });
      expect(fallback.find((e) => e.type === "sources").notice).toContain(
        "연결하지 못해",
      );
      expect(fallback.find((e) => e.type === "done").runs.at(-1).state).toBe(
        "completed",
      );
      expect(
        (
          await clients.reader.post(`${base}/model`, {
            data: { action: "test" },
          })
        ).status(),
      ).toBe(403);
      expect(
        (
          await clients.admin.post(`${base}/model`, {
            data: { action: "test" },
          })
        ).status(),
      ).toBe(200);
    });
    test("직원 권한이 철회되면 진행 중 답변과 다음 요청을 중지한다", async () => {
      const pending = ask("관제 지연 권한 변경");
      await expect
        .poll(async () =>
          Number(
            (
              await pool.query(
                "SELECT count(*) FROM chat_citation c JOIN chat_run r ON r.id=c.run_id WHERE r.conversation_id=$1 AND r.state='running'",
                [id],
              )
            ).rows[0].count,
          ),
        )
        .toBeGreaterThan(0);
      const owner = f.accounts.find((a) => a.role === "reader")?.id;
      try {
        await pool.query(
          "UPDATE membership SET is_active=false WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, owner],
        );
        await pending;
        expect(
          (await clients.reader.get(`${base}/conversations/${id}`)).status(),
        ).toBe(404);
        expect(
          (
            await pool.query(
              "SELECT state FROM chat_run WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 1",
              [id],
            )
          ).rows[0].state,
        ).not.toBe("completed");
      } finally {
        await pool.query(
          "UPDATE membership SET is_active=true WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, owner],
        );
      }
    });
    test("근거 철회는 과거 응답·후속 문맥·진행 중 출력에서 재검사한다", async () => {
      const pending = ask("관제 지연 철회 검증");
      await expect
        .poll(async () =>
          Number(
            (
              await pool.query(
                "SELECT count(*) FROM chat_citation c JOIN chat_run r ON r.id=c.run_id WHERE r.conversation_id=$1 AND r.state='running'",
                [id],
              )
            ).rows[0].count,
          ),
        )
        .toBeGreaterThan(0);
      await pool.query(
        "UPDATE source SET published_version_id=NULL WHERE id=$1",
        [source],
      );
      await pending;
      const detail = await (
        await clients.reader.get(`${base}/conversations/${id}`)
      ).json();
      expect(detail.runs[0].state).toBe("restricted");
      expect(detail.runs[0].citations).toHaveLength(0);
      expect(
        detail.runs[0].messages.find(
          (m: { role: string }) => m.role === "assistant",
        ).body,
      ).not.toContain("30초");
      expect((await ask("관제 후속 질문")).status()).toBe(404);
      const broad = {
        domainId: f.domainId,
        projectId: null,
        sourceId: null,
        wikiId: null,
      };
      expect(
        (
          await clients.reader.patch(`${base}/conversations/${id}`, {
            data: { title: "변경된 범위", scope: broad },
          })
        ).status(),
      ).toBe(200);
      await pool.query(
        "UPDATE source SET published_version_id=$2 WHERE id=$1",
        [source, version],
      );
    });
  });
}
