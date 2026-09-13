import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";

type Fixture = {
  workspaceId: string;
  outsiderWorkspaceId: string;
  domainId: string;
  accounts: { id: string; role: string }[];
};
export function registerActivityNavigationTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("내 활동·후속 행동", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const origin = "http://localhost:3101",
      base = `/api/workspaces/${f.workspaceId}`,
      root = `/w/${f.workspaceId}`;
    const writer = f.accounts.find((a) => a.role === "writer")?.id,
      reader = f.accounts.find((a) => a.role === "reader")?.id,
      reviewer = f.accounts.find((a) => a.role === "reviewer")?.id;
    if (!writer || !reader || !reviewer)
      throw new Error("시험 계정이 없습니다.");
    const source = randomUUID(),
      sourceVersion = randomUUID(),
      chunk = randomUUID(),
      pendingSource = randomUUID(),
      pendingVersion = randomUUID(),
      privateSource = randomUUID(),
      privateVersion = randomUUID();
    const pageId = randomUUID(),
      wikiVersion = randomUUID(),
      conversation = randomUUID(),
      run = randomUUID(),
      laterRun = randomUUID(),
      feedback = randomUUID();
    const scope = {
      domainId: f.domainId,
      projectId: null,
      sourceId: source,
      wikiId: null,
    };
    test.beforeAll(async () => {
      for (const [s, v, title, author, published] of [
        [source, sourceVersion, "활동 연결 공개 원문", writer, true],
        [pendingSource, pendingVersion, "작성중 탐색 원본", writer, false],
        [
          privateSource,
          privateVersion,
          "다른 직원의 비공개 자료",
          reviewer,
          false,
        ],
      ] as const) {
        await pool.query(
          "INSERT INTO source(id,workspace_id,domain_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,'guideline',$5,$6,$7,1)",
          [
            s,
            f.workspaceId,
            f.domainId,
            title,
            author,
            v,
            published ? v : null,
          ],
        );
        await pool.query(
          "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'activity.md','text/markdown',$4,$4,30,$5,$6,'completed')",
          [
            v,
            f.workspaceId,
            s,
            randomUUID(),
            author,
            published ? "published" : "pending",
          ],
        );
      }
      await pool.query(
        "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,0,'관제 화면은 30초마다 갱신합니다.',$4)",
        [
          chunk,
          f.workspaceId,
          sourceVersion,
          { kind: "lines", startLine: 1, endLine: 1 },
        ],
      );
      await pool.query(
        "INSERT INTO wiki_page(id,workspace_id,domain_id,created_by,latest_version_id,version_count) VALUES($1,$2,$3,$4,$5,1)",
        [pageId, f.workspaceId, f.domainId, writer, wikiVersion],
      );
      await pool.query(
        "INSERT INTO wiki_version(id,workspace_id,page_id,number,author_id,title,body,state) VALUES($1,$2,$3,1,$4,'작성중 탐색 위키','관리 검색에서만 보이는 개인 초안 본문','draft')",
        [wikiVersion, f.workspaceId, pageId, writer],
      );
      await pool.query(
        "INSERT INTO conversation(id,workspace_id,owner_id,title,scope) VALUES($1,$2,$3,'제목 변경 전 대화',$4)",
        [conversation, f.workspaceId, reader, scope],
      );
      for (const [id, prompt, body, age] of [
        [
          run,
          "원래 답변 질문",
          "본인에게만 보이는 원래 답변입니다. [E1]",
          "1 minute",
        ],
        [
          laterRun,
          "이후 질문",
          Array.from(
            { length: 40 },
            (_, i) => `이후 답변 문단 ${i + 1}입니다.`,
          ).join("\n\n"),
          "0 seconds",
        ],
      ]) {
        await pool.query(
          "INSERT INTO chat_run(id,workspace_id,conversation_id,request_id,prompt,scope,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'completed',now()-$7::interval)",
          [id, f.workspaceId, conversation, randomUUID(), prompt, scope, age],
        );
        await pool.query(
          "INSERT INTO chat_message(workspace_id,run_id,role,body) VALUES($1,$2,'assistant',$3)",
          [f.workspaceId, id, body],
        );
      }
      await pool.query(
        "INSERT INTO chat_citation(workspace_id,run_id,key,snapshot,used) VALUES($1,$2,'E1',$3,true)",
        [
          f.workspaceId,
          run,
          {
            key: "E1",
            kind: "source",
            id: source,
            versionId: sourceVersion,
            chunkId: chunk,
            title: "활동 연결 공개 원문",
            text: "관제 화면은 30초마다 갱신합니다.",
            category: "guideline",
            href: `${root}/sources/${source}?version=${sourceVersion}#chunk-${chunk}`,
            locator: { kind: "lines", startLine: 1, endLine: 1 },
          },
        ],
      );
      await pool.query(
        "INSERT INTO chat_feedback(id,workspace_id,run_id,author_id,rating,note) VALUES($1,$2,$3,$4,'needs-review','원래 답변 의견의 처리 연결 확인')",
        [feedback, f.workspaceId, run, reader],
      );
      await pool.query(
        "INSERT INTO review_assignment(workspace_id,kind,target_id,assignee_id) VALUES($1,'feedback',$2,$3)",
        [f.workspaceId, feedback, reviewer],
      );
    });
    test.afterAll(async () => {
      await pool.end();
    });
    test("내 담당 필터는 오래된 다른 요청 500건 뒤의 담당 항목도 찾는다", async () => {
      await pool.query(
        "INSERT INTO content_issue(workspace_id,author_id,kind,target_id,title,note,created_at) SELECT $1,$2,'source',$3,'다른 대기 신고 '||i,'담당 필터 경계 표본',now()-interval '2 days' FROM generate_series(1,501)i",
        [f.workspaceId, reader, source],
      );
      await pool.query(
        "INSERT INTO review_assignment(workspace_id,kind,target_id,assignee_id) VALUES($1,'source',$2,$3)",
        [f.workspaceId, pendingVersion, reviewer],
      );
      const all = await (
        await clients.reviewer.get(`${base}/review-desk`)
      ).json();
      expect(
        all.targets.some((t: { id: string }) => t.id === pendingVersion),
      ).toBe(false);
      const mine = await (
        await clients.reviewer.get(`${base}/review-desk?filter=mine`)
      ).json();
      expect(
        mine.targets.some((t: { id: string }) => t.id === pendingVersion),
      ).toBe(true);
      expect(
        mine.targets.every(
          (t: { assignee_id: string }) => t.assignee_id === reviewer,
        ),
      ).toBe(true);
    });
    test("처리 결과를 본인에게만 페이징하고 확인한 뒤 새 결과는 다시 미확인으로 남긴다", async () => {
      const before = await (
        await clients.writer.get(`${base}/activity-summary`)
      ).json();
      await pool.query(
        "INSERT INTO review_decision(workspace_id,source_version_id,actor_id,action,note,created_at) SELECT $1,$2,$3,'approve','검토 알림 '||i,now()-i*interval '1 second' FROM generate_series(1,70)i",
        [f.workspaceId, sourceVersion, reviewer],
      );
      const all = await (
        await clients.writer.get(`${base}/activity?page=1&pageSize=200`)
      ).json();
      expect(all.unread).toBe(before.unread + 70);
      expect(
        all.notifications.items.filter(
          (n: { target_id: string }) => n.target_id === source,
        ),
      ).toHaveLength(70);
      const first = await (
        await clients.writer.get(`${base}/activity?page=1`)
      ).json();
      expect(first.notifications.items).toHaveLength(30);
      expect(first.notifications.totalPages).toBeGreaterThanOrEqual(3);
      const keys = all.notifications.items
        .filter((n: { target_id: string }) => n.target_id === source)
        .map((n: { key: string }) => n.key);
      expect(
        (
          await clients.reader.post(`${base}/activity`, {
            data: { keys: [keys[0]] },
          })
        ).status(),
      ).toBe(404);
      expect(
        (
          await clients.admin.post(`${base}/activity`, {
            data: { keys: [keys[0]] },
          })
        ).status(),
      ).toBe(404);
      expect((await clients.outsider.get(`${base}/activity`)).status()).toBe(
        404,
      );
      expect(
        (
          await clients.writer.post(`${base}/activity`, { data: { keys } })
        ).status(),
      ).toBe(201);
      expect(
        (await (await clients.writer.get(`${base}/activity-summary`)).json())
          .unread,
      ).toBe(before.unread);
      expect(
        (
          await clients.writer.post(`${base}/activity`, { data: { keys } })
        ).status(),
      ).toBe(201);
      await pool.query(
        "INSERT INTO review_decision(workspace_id,source_version_id,actor_id,action,note) VALUES($1,$2,$3,'reject','새 검토 결과를 다시 확인해 주세요.')",
        [f.workspaceId, sourceVersion, reviewer],
      );
      expect(
        (await (await clients.writer.get(`${base}/activity-summary`)).json())
          .unread,
      ).toBe(before.unread + 1);
      const others = await (
        await clients.reader.get(`${base}/activity?pageSize=200`)
      ).json();
      expect(JSON.stringify(others)).not.toContain("검토 알림");
      expect(
        (await clients.writer.get(`${base}/activity?page=0`)).status(),
      ).toBe(400);
    });
    test("계정 메뉴·내 활동에서 미확인 결과를 확인하고 모바일 프로젝트로 이동한다", async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: await clients.writer.storageState(),
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await page.goto(origin + root);
        await page.getByRole("button", { name: /내 계정 메뉴/ }).click();
        const dialog = page.getByRole("dialog", { name: "내 계정 메뉴" });
        await dialog.getByRole("link", { name: /내 활동/ }).click();
        await expect(page).toHaveURL(`${origin + root}/activity`);
        const item = page
          .locator(".activity-result")
          .filter({ hasText: "새 검토 결과를 다시 확인해 주세요." });
        await expect(item.getByText("새 처리 결과")).toBeVisible();
        await item.getByRole("button", { name: "확인했습니다" }).click();
        await expect(item.getByText("새 처리 결과")).toHaveCount(0);
        await expect(
          page.getByRole("link", { name: "내 자료 전체 →" }),
        ).toHaveAttribute("href", `${root}/sources?mode=manage&mine=true`);
        await page.setViewportSize({ width: 390, height: 844 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: "test-results/03-activity-mobile.png",
          fullPage: true,
        });
        await page.getByRole("button", { name: "전체 메뉴 열기" }).click();
        const menu = page.getByRole("dialog", { name: "우리 업무 위키" });
        await menu
          .getByRole("link", { name: "프로젝트 →", exact: true })
          .click();
        await expect(page).toHaveURL(`${origin + root}/projects`);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
    test("원래 답변 링크는 본인만 열고 대화 제목·출처 포함 복사·복사 불가 안내를 확인한다", async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: await clients.reader.storageState(),
        permissions: ["clipboard-read", "clipboard-write"],
      });
      const page = await context.newPage();
      try {
        await page.goto(`${origin + root}/issues`);
        await page
          .locator(`#feedback-${feedback}`)
          .getByRole("link", { name: "의견을 남긴 원래 답변 →" })
          .click();
        await expect(page).toHaveURL(
          `${origin + root}/chat?conversation=${conversation}#run-${run}`,
        );
        const answer = page.locator(`#run-${run}`);
        await expect(answer).toBeFocused();
        expect(
          await answer.evaluate((el) => {
            const outer = el.closest(".chat-history")?.getBoundingClientRect();
            const box = el.getBoundingClientRect();
            return (
              !!outer && box.top >= outer.top - 2 && box.top < outer.bottom
            );
          }),
        ).toBe(true);
        await answer
          .getByRole("button", { name: "답변 복사", exact: true })
          .click();
        await expect(
          answer.getByRole("button", { name: "복사했습니다" }),
        ).toBeVisible();
        const copied = await page.evaluate(() =>
          navigator.clipboard.readText(),
        );
        expect(copied).toContain("본인에게만 보이는 원래 답변");
        expect(copied).toContain(sourceVersion);
        expect(copied).toContain("참고 자료");
        await page
          .getByRole("button", { name: "대화 관리", exact: true })
          .click();
        await page
          .getByLabel("대화 제목", { exact: true })
          .fill("바꾼 개인 대화 제목");
        await page.getByRole("button", { name: "대화 제목 저장" }).click();
        await expect(page.getByText("대화 제목을 변경했습니다.")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("heading", { name: "바꾼 개인 대화 제목" }),
        ).toBeVisible();
        await page.reload();
        await expect(
          page.getByRole("heading", { name: "바꾼 개인 대화 제목" }),
        ).toBeVisible();
        expect(
          (
            await clients.admin.get(`${base}/conversations/${conversation}`)
          ).status(),
        ).toBe(404);
        await page.evaluate(() => {
          navigator.clipboard.writeText = async () => {
            throw new Error("denied");
          };
        });
        await answer
          .getByRole("button", { name: "답변 복사", exact: true })
          .click();
        await expect(answer.getByLabel("복사할 답변과 출처")).toContainText(
          "본인에게만 보이는 원래 답변",
        );
        await pool.query(
          "UPDATE source SET published_version_id=NULL WHERE id=$1",
          [source],
        );
        await answer
          .getByRole("button", { name: "답변 복사", exact: true })
          .click();
        await expect(
          answer.getByText(
            "현재 확인할 수 있는 완료 답변만 복사할 수 있습니다.",
          ),
        ).toBeVisible();
        await expect(answer.getByLabel("복사할 답변과 출처")).toHaveCount(0);
        await pool.query(
          "UPDATE source SET published_version_id=$2 WHERE id=$1",
          [source, sourceVersion],
        );
      } finally {
        await context.close();
      }
    });
    test("검토함의 처리하기는 해당 의견으로 연결되며 검토자에게 개인 대화를 노출하지 않는다", async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: await clients.reviewer.storageState(),
      });
      const page = await context.newPage();
      try {
        const d = await (
          await clients.reviewer.get(
            `${base}/review-desk?kind=feedback&targetId=${feedback}`,
          )
        ).json();
        expect(d.targets).toHaveLength(1);
        expect(d.targets[0].id).toBe(feedback);
        expect(JSON.stringify(d)).not.toContain(conversation);
        expect(JSON.stringify(d)).not.toContain("본인에게만 보이는 원래 답변");
        await page.goto(`${origin + root}/reviews`);
        await page
          .locator(".decision-row")
          .filter({ hasText: "원래 답변 의견의 처리 연결 확인" })
          .getByRole("link", { name: "처리하기 →" })
          .click();
        await expect(
          page.locator(`#review-feedback-${feedback}`),
        ).toBeVisible();
        await expect(page.getByRole("article")).toHaveCount(1);
        expect(
          (
            await (
              await clients.reviewer.get(`${base}/activity-summary`)
            ).json()
          ).reviews.assigned,
        ).toBeGreaterThan(0);
        expect(
          (
            await clients.reviewer.post(`${base}/review-desk`, {
              data: {
                kind: "feedback",
                targetId: feedback,
                action: "resolve",
                note: "개인 대화 없이 의견 처리 연결을 확인했습니다.",
              },
            })
          ).status(),
        ).toBe(201);
        await page.reload();
        await expect(
          page.locator(`#review-feedback-${feedback}`),
        ).toContainText("처리 완료");
        const own = await (await clients.reader.get(`${base}/activity`)).json();
        expect(
          own.notifications.items.some(
            (n: { target_id: string; kind: string; unread: boolean }) =>
              n.target_id === feedback && n.kind === "feedback" && n.unread,
          ),
        ).toBe(true);
      } finally {
        await context.close();
      }
    });
    test("자료·위키 관리 검색에서 본인 초안·대기 상태를 찾고 공개 검색과 도메인 전환을 구분한다", async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: await clients.writer.storageState(),
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      try {
        for (const [path, q, status, label, target] of [
          [
            "sources",
            "작성중 탐색 원본",
            "pending",
            "공개 검토 대기",
            pendingSource,
          ],
          ["wiki", "작성중 탐색 위키", "draft", "작성 초안", pageId],
        ]) {
          await page.goto(`${origin}${root}/${path}`);
          await page.getByRole("combobox", { name: "검색 범위" }).click();
          await page
            .getByRole("option", { name: "작성·검토 목록", exact: true })
            .click();
          await page.getByLabel("검색어", { exact: true }).fill(q);
          await page.getByRole("combobox", { name: "처리 상태" }).click();
          await page.getByRole("option", { name: label, exact: true }).click();
          await page
            .getByRole("checkbox", { name: "내가 작성한 항목만" })
            .check();
          await page.getByRole("button", { name: "검색", exact: true }).click();
          await expect(
            page.locator(".content-list-row").filter({ hasText: q }),
          ).toBeVisible();
          expect(new URL(page.url()).searchParams.get("mode")).toBe("manage");
          expect(new URL(page.url()).searchParams.get("status")).toBe(status);
          await page
            .getByRole("navigation", { name: "자료 도메인 분류" })
            .getByRole("link", { name: "시험 도메인", exact: true })
            .click();
          expect(new URL(page.url()).searchParams.get("mine")).toBe("true");
          await expect(
            page.locator(".content-list-row").filter({ hasText: q }),
          ).toBeVisible();
          expect(
            (
              await (
                await clients.reader.get(
                  `${base}/${path}?page=1&q=${encodeURIComponent(q)}`,
                )
              ).json()
            ).items,
          ).toEqual([]);
          const found = await (
            await clients.writer.get(
              `${base}/${path}?page=1&status=${status}&mine=true&q=${encodeURIComponent(q)}`,
            )
          ).json();
          expect(
            found.items.some(
              (i: { id?: string; pageId?: string }) =>
                (i.id ?? i.pageId) === target,
            ),
          ).toBe(true);
          await page.screenshot({
            path: `test-results/03-manage-${path}-mobile.png`,
            fullPage: true,
          });
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page.getByRole("combobox", { name: "검색 범위" }).click();
          await page
            .getByRole("option", { name: "공개 지식 검색", exact: true })
            .click();
          await page.getByRole("button", { name: "검색", exact: true }).click();
          await expect(page).toHaveURL(
            (url) => url.searchParams.get("mode") !== "manage",
          );
          await expect(
            page.locator(`.result-row a[href*="/${path}/${target}"]`),
          ).toHaveCount(0);
          await expect(
            page.locator(".result-row").filter({ hasText: q }),
          ).toHaveCount(0);
          const publicResults = await (
            await clients.writer.get(
              `${base}/search?q=${encodeURIComponent(q)}&kind=${path === "wiki" ? "wiki" : "source"}`,
            )
          ).json();
          expect(
            publicResults.some((item: { id: string }) => item.id === target),
          ).toBe(false);
        }
        const privateList = await (
          await clients.writer.get(
            `${base}/sources?page=1&q=${encodeURIComponent("다른 직원의 비공개 자료")}`,
          )
        ).json();
        expect(privateList.items).toEqual([]);
      } finally {
        await context.close();
      }
    });
  });
}
