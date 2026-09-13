import { createHash, randomUUID } from "node:crypto";
import {
  type APIRequestContext,
  expect,
  request,
  test,
} from "@playwright/test";
import { Pool } from "pg";

type Fixture = {
  workspaceId: string;
  outsiderWorkspaceId: string;
  domainId: string;
  outsiderDomainId: string;
  accounts: { id: string; email: string; password: string; role: string }[];
};
export function registerAuthoringAccountTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("작성 보호·계정·사용량", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const origin = "http://localhost:3101",
      base = `/api/workspaces/${f.workspaceId}`,
      root = `/w/${f.workspaceId}`;
    const admin = f.accounts.find((a) => a.role === "admin");
    const writer = f.accounts.find((a) => a.role === "writer");
    if (!admin || !writer) throw new Error("시험 계정이 없습니다.");
    const source = randomUUID(),
      version = randomUUID(),
      chunk = randomUUID();
    const email = `recovery-${randomUUID()}@test.invalid`,
      password = "AccountCheckOriginal123!",
      changedPassword = "AccountCheckChanged123!",
      recoveredPassword = "AccountCheckRecovered123!";
    let memberId = "";
    let owner: APIRequestContext, other: APIRequestContext;
    const issue = (overrides = {}) =>
      clients.admin.post(`${base}/password-recovery`, {
        data: {
          userId: memberId,
          adminPassword: admin.password,
          confirmed: true,
          ...overrides,
        },
      });
    const tokenOf = (url: string) =>
      new URLSearchParams(new URL(url).hash.slice(1)).get("token") ?? "";
    const reset = (token: string, newPassword = recoveredPassword) =>
      clients.admin.post("/api/account/recovery", {
        data: { token, newPassword },
      });
    async function login(secret: string) {
      const client = await request.newContext({
        baseURL: origin,
        extraHTTPHeaders: { Origin: origin },
      });
      expect(
        (
          await client.post("/api/auth/sign-in/email", {
            data: { email, password: secret },
          })
        ).status(),
      ).toBe(200);
      return client;
    }
    test.beforeAll(async () => {
      await pool.query(
        "INSERT INTO source(id,workspace_id,domain_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,'초안 복원 원문','project',$4,$5,$5,1)",
        [source, f.workspaceId, f.domainId, writer.id, version],
      );
      await pool.query(
        "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'draft.md','text/markdown',$4,$4,20,$5,'published','completed')",
        [version, f.workspaceId, source, randomUUID(), writer.id],
      );
      await pool.query(
        "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,0,'초안 복원 원문: 관제 화면은 30초마다 갱신합니다.',$4)",
        [
          chunk,
          f.workspaceId,
          version,
          { kind: "lines", startLine: 1, endLine: 1 },
        ],
      );
      const created = await clients.admin.post(`${base}/members`, {
        data: {
          name: "계정 복구 시험 직원",
          email,
          password,
          role: "writer",
          isAdmin: false,
        },
      });
      expect(created.status()).toBe(201);
      memberId = (await created.json()).id;
      owner = await login(password);
      other = await login(password);
    });
    test.afterAll(async () => {
      await owner?.dispose();
      await other?.dispose();
      if (memberId) {
        await pool.query("DELETE FROM operations_event WHERE actor_id=$1", [
          memberId,
        ]);
        await pool.query("DELETE FROM app_user WHERE id=$1", [memberId]);
      }
      await pool.end();
    });
    test("네 작성 화면에서 이탈 취소·복원·새로고침·뒤로 가기·초안 버리기를 확인한다", async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: await clients.writer.storageState(),
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        const forms = [
          { route: "/wiki/new", label: "위키 제목", body: "마크다운 본문" },
          { route: "/records", label: "기록 제목", body: "작성 당시 메모" },
          {
            route: "/proposals/new",
            label: "변경 묶음 제목",
            body: "위키 제목",
          },
          {
            route: `/tools/rfp/new?sourceId=${source}`,
            label: "보고서 제목",
            body: "항목 1 의미·적용 범위",
          },
        ];
        for (const [index, form] of forms.entries()) {
          await page.goto(origin + root + form.route);
          if (index === 0)
            await page
              .getByRole("button", { name: "마크다운", exact: true })
              .click();
          const initial = await page
            .getByLabel(form.label, { exact: true })
            .inputValue();
          await page
            .getByLabel(form.label, { exact: true })
            .fill(`복원할 초안 ${index}`);
          await page
            .getByLabel(form.body, { exact: true })
            .fill("여러 줄 작성\n다음 줄도 보존합니다.");
          await expect(
            page.getByText("작성 내용을 이 탭에 임시 보관하고 있습니다."),
          ).toBeVisible();
          page.once("dialog", (d) => d.dismiss());
          await page
            .locator(".desktop-nav")
            .getByRole("link", { name: "홈", exact: true })
            .click();
          await expect(
            page.getByLabel(form.label, { exact: true }),
          ).toHaveValue(`복원할 초안 ${index}`);
          page.once("dialog", (d) => d.accept());
          await page
            .locator(".desktop-nav")
            .getByRole("link", { name: "홈", exact: true })
            .click();
          await expect(page).toHaveURL(origin + root);
          await page.goBack();
          await expect(
            page.getByLabel(form.label, { exact: true }),
          ).toHaveValue(`복원할 초안 ${index}`);
          if (index === 0)
            await page
              .getByRole("button", { name: "마크다운", exact: true })
              .click();
          await expect(page.getByLabel(form.body, { exact: true })).toHaveValue(
            index === 2
              ? "여러 줄 작성 다음 줄도 보존합니다."
              : "여러 줄 작성\n다음 줄도 보존합니다.",
          );
          page.once("dialog", (d) => d.accept());
          await page.reload();
          await expect(
            page.getByText("이 탭에 남아 있던 임시 초안을 복원했습니다."),
          ).toBeVisible();
          await expect(
            page.getByLabel(form.label, { exact: true }),
          ).toHaveValue(`복원할 초안 ${index}`);
          await page.getByRole("button", { name: "임시 초안 버리기" }).click();
          await expect(
            page.getByLabel(form.label, { exact: true }),
          ).toHaveValue(initial);
        }
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
    test("기록 근거 선택을 복원하고 저장 실패 시 보존하며 성공 후 임시 초안을 지운다", async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: await clients.writer.storageState(),
      });
      const page = await context.newPage();
      try {
        await page.goto(`${origin + root}/records`);
        await page
          .getByRole("combobox", { name: "도메인", exact: true })
          .click();
        await page
          .getByRole("option", { name: "시험 도메인", exact: true })
          .click();
        for (const [label, value] of [
          ["기록 제목", "실패 후 저장할 기록"],
          ["작성 당시 메모", "원래 메모"],
          ["상황", "상황 설명"],
          ["판단과 이유", "판단 이유"],
          ["결과", "확인한 결과"],
          ["추가 확인할 내용", "후속 확인"],
        ])
          await page.getByLabel(label, { exact: true }).fill(value);
        await page
          .getByText("연결할 공개 원문 선택 (선택 사항)", { exact: true })
          .click();
        await page.getByLabel("원문 검색어").fill("초안 복원 원문");
        await page
          .getByRole("button", { name: "원문 찾기", exact: true })
          .click();
        await page.getByRole("checkbox", { name: /초안 복원 원문/ }).check();
        page.once("dialog", (d) => d.accept());
        await page.reload();
        await page
          .getByText("연결할 공개 원문 선택 (선택 사항)", { exact: true })
          .click();
        await expect(
          page.getByRole("checkbox", { name: /초안 복원 원문/ }),
        ).toBeChecked();
        await page.route(`**${base}/records`, (route) =>
          route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "시험 저장 실패" }),
          }),
        );
        const save = page.getByRole("button", {
          name: "실무 기록 저장",
          exact: true,
        });
        await save.click();
        await expect(
          page.getByRole("alert").filter({ hasText: "시험 저장 실패" }),
        ).toBeVisible();
        page.once("dialog", (d) => d.accept());
        await page.reload();
        await expect(page.getByLabel("기록 제목", { exact: true })).toHaveValue(
          "실패 후 저장할 기록",
        );
        await page.unroute(`**${base}/records`);
        await save.click();
        await expect(page).toHaveURL(/\/sources\//);
        expect(
          await page.evaluate(() =>
            Object.keys(sessionStorage).filter((k) =>
              k.startsWith("wiki-draft:"),
            ),
          ),
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });
    test("만료·다른 계정의 초안을 복원하지 않고 근거 조회는 현재 공개 범위를 지킨다", async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: await clients.writer.storageState(),
      });
      const page = await context.newPage();
      try {
        await page.goto(`${origin + root}/wiki/new`);
        await page.getByLabel("위키 제목", { exact: true }).fill("만료될 초안");
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                Object.keys(sessionStorage).filter((k) =>
                  k.startsWith("wiki-draft:"),
                ).length,
            ),
          )
          .toBe(1);
        page.once("dialog", (d) => d.accept());
        await page.goto(origin + root);
        await page.evaluate(() => {
          for (const key of Object.keys(sessionStorage))
            if (key.startsWith("wiki-draft:")) {
              const value = JSON.parse(sessionStorage.getItem(key) ?? "{}");
              value.updatedAt = Date.now() - 86400001;
              sessionStorage.setItem(key, JSON.stringify(value));
            }
        });
        await page.goto(`${origin + root}/wiki/new`);
        await expect(page.getByLabel("위키 제목", { exact: true })).toHaveValue(
          "",
        );
        await page
          .getByLabel("위키 제목", { exact: true })
          .fill("다른 계정에 보이면 안 되는 초안");
        page.once("dialog", (d) => d.accept());
        await page.goto(origin + root);
        await context.clearCookies();
        await context.addCookies(
          (await clients.reviewer.storageState()).cookies,
        );
        await page.goto(`${origin + root}/wiki/new`);
        await expect(page.getByLabel("위키 제목", { exact: true })).toHaveValue(
          "",
        );
        const query = `?domainId=${f.domainId}&ids=${chunk}`;
        expect(
          (
            await (
              await clients.writer.get(`${base}/draft-evidence${query}`)
            ).json()
          )[0].id,
        ).toBe(chunk);
        expect(
          (await clients.reader.get(`${base}/draft-evidence${query}`)).status(),
        ).toBe(403);
        expect(
          (
            await clients.outsider.get(`${base}/draft-evidence${query}`)
          ).status(),
        ).toBe(404);
        await pool.query(
          "UPDATE source SET published_version_id=NULL WHERE id=$1",
          [source],
        );
        expect(
          await (
            await clients.writer.get(`${base}/draft-evidence${query}`)
          ).json(),
        ).toEqual([]);
        await pool.query(
          "UPDATE source SET published_version_id=$2 WHERE id=$1",
          [source, version],
        );
      } finally {
        await context.close();
      }
    });
    test("본인 비밀번호 변경은 확인 입력과 현재 비밀번호를 검사하고 다른 세션·복구 링크를 취소한다", async ({
      browser,
    }) => {
      const link = await issue();
      expect(link.status()).toBe(201);
      const token = tokenOf((await link.json()).url);
      const context = await browser.newContext({
        storageState: await owner.storageState(),
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      try {
        await page.goto(`${origin + root}/account`);
        await page
          .getByLabel("현재 비밀번호", { exact: true })
          .fill("WrongPassword123!");
        await page
          .getByLabel("새 비밀번호", { exact: true })
          .fill(changedPassword);
        await page
          .getByLabel("새 비밀번호 확인", { exact: true })
          .fill(password);
        await page
          .getByRole("button", { name: "비밀번호 변경", exact: true })
          .click();
        await expect(
          page.getByText("새 비밀번호를 두 칸에 동일하게 입력해 주세요."),
        ).toBeVisible();
        await page
          .getByLabel("새 비밀번호 확인", { exact: true })
          .fill(changedPassword);
        await page
          .getByRole("button", { name: "비밀번호 변경", exact: true })
          .click();
        await expect(
          page.getByText("현재 비밀번호와 새 비밀번호의 길이를 확인해 주세요."),
        ).toBeVisible();
        await page.getByLabel("현재 비밀번호", { exact: true }).fill(password);
        await page
          .getByRole("button", { name: "비밀번호 변경", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "다른 기기의 로그인은 해제했습니다.",
        );
        expect((await other.get(base)).status()).toBe(401);
        expect((await reset(token)).status()).toBe(400);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: "test-results/02-account-mobile.png",
          fullPage: true,
        });
        await owner.dispose();
        owner = await request.newContext({
          baseURL: origin,
          storageState: await context.storageState(),
          extraHTTPHeaders: { Origin: origin },
        });
        expect((await owner.get(base)).status()).toBe(200);
      } finally {
        await context.close();
      }
    });
    test("관리자 복구는 권한·만료·재발급·일회 사용과 기존 로그인 해제를 검증한다", async ({
      browser,
    }) => {
      expect((await issue({ confirmed: false })).status()).toBe(400);
      expect(
        (await issue({ adminPassword: "WrongPassword123!" })).status(),
      ).toBe(403);
      expect(
        (
          await clients.writer.post(`${base}/password-recovery`, {
            data: {
              userId: memberId,
              adminPassword: admin.password,
              confirmed: true,
            },
          })
        ).status(),
      ).toBe(403);
      expect(
        (
          await issue({
            userId: f.accounts.find((a) => a.role === "outsider")?.id,
          })
        ).status(),
      ).toBe(404);
      const first = tokenOf((await (await issue()).json()).url),
        second = tokenOf((await (await issue()).json()).url);
      expect((await reset(first)).status()).toBe(400);
      await pool.query(
        "UPDATE password_recovery SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
        [createHash("sha256").update(second).digest("hex")],
      );
      expect((await reset(second)).status()).toBe(400);
      const restricted = tokenOf((await (await issue()).json()).url);
      await pool.query(
        "INSERT INTO membership(workspace_id,user_id,role,is_admin) VALUES($1,$2,'reader',false)",
        [f.outsiderWorkspaceId, memberId],
      );
      expect((await issue()).status()).toBe(403);
      expect((await reset(restricted)).status()).toBe(403);
      await pool.query(
        "DELETE FROM membership WHERE workspace_id=$1 AND user_id=$2",
        [f.outsiderWorkspaceId, memberId],
      );
      const context = await browser.newContext({
        storageState: await clients.admin.storageState(),
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      try {
        await page.goto(`${origin + root}/admin`);
        const details = page
          .locator("details")
          .filter({ has: page.locator("summary").filter({ hasText: email }) });
        await details.locator("summary").click();
        await details
          .getByRole("checkbox", { name: "직원의 본인 여부를 확인했습니다" })
          .check();
        await details.getByLabel("관리자 본인 비밀번호").fill(admin.password);
        await details
          .getByRole("button", { name: "일회용 복구 링크 발급" })
          .click();
        await expect(details.getByLabel("발급한 복구 링크")).toBeVisible();
        const url = await details.getByLabel("발급한 복구 링크").inputValue(),
          token = tokenOf(url);
        expect(
          (
            await pool.query(
              "SELECT token_hash FROM password_recovery WHERE user_id=$1 AND used_at IS NULL",
              [memberId],
            )
          ).rows,
        ).toEqual([
          { token_hash: createHash("sha256").update(token).digest("hex") },
        ]);
        await page.goto(url);
        await expect(page).toHaveURL(`${origin}/reset-password`);
        await page
          .getByLabel("새 비밀번호", { exact: true })
          .fill(recoveredPassword);
        await page
          .getByLabel("새 비밀번호 확인", { exact: true })
          .fill(recoveredPassword);
        await page
          .getByRole("button", { name: "비밀번호 변경", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "새 비밀번호로 로그인해 주세요.",
        );
        expect((await reset(token)).status()).toBe(400);
        expect((await owner.get(base)).status()).toBe(401);
        await other.dispose();
        other = await login(recoveredPassword);
        expect((await other.get(base)).status()).toBe(200);
        await page.screenshot({
          path: "test-results/02-recovery-mobile.png",
          fullPage: true,
        });
      } finally {
        await context.close();
      }
      for (let i = 0; i < 4; i++)
        expect(
          (await issue({ adminPassword: "WrongPassword123!" })).status(),
        ).toBe(403);
      expect((await issue()).status()).toBe(429);
    });
    test("스트리밍 최종 사용량과 임베딩 토큰을 분리해서 운영 화면에 기록한다", async () => {
      const created = await clients.reader.post(`${base}/conversations`, {
        data: {
          scope: {
            domainId: f.domainId,
            projectId: null,
            sourceId: source,
            wikiId: null,
          },
        },
      });
      expect(created.status()).toBe(201);
      const conversation = (await created.json()).id;
      const stream = await clients.reader.post(
        `${base}/conversations/${conversation}/stream`,
        {
          data: {
            requestId: randomUUID(),
            prompt: "초안 복원 원문의 관제 갱신 주기는?",
          },
        },
      );
      expect(stream.status()).toBe(200);
      expect(await stream.text()).toContain('"type":"done"');
      expect(
        (
          await pool.query(
            "SELECT input_tokens,output_tokens FROM chat_run WHERE conversation_id=$1",
            [conversation],
          )
        ).rows[0],
      ).toEqual({ input_tokens: 120, output_tokens: 40 });
      const stats = await (
        await clients.admin.get("http://127.0.0.1:3102/stats")
      ).json();
      expect(stats.usageRequests.at(-1)).toBe(true);
      const embedding = await pool.query(
        "SELECT input_tokens,state FROM embedding_usage WHERE workspace_id=$1 AND purpose='query' ORDER BY created_at DESC LIMIT 1",
        [f.workspaceId],
      );
      expect(embedding.rows[0].input_tokens).toBeGreaterThan(0);
      expect(embedding.rows[0].state).toBe("completed");
      const operations = await (
        await clients.admin.get(`${base}/operations`)
      ).json();
      expect(
        operations.embedding.some(
          (r: { purpose: string; input: string }) =>
            r.purpose === "query" && Number(r.input) > 0,
        ),
      ).toBe(true);
    });
  });
}
