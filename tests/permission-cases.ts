import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";

type Fixture = {
  workspaceId: string;
  domainId: string;
  outsiderWorkspaceId: string;
  accounts: { id: string; role: string; email: string }[];
};
export function registerPermissionTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("관리자·복수 업무 권한", () => {
    const base = `/api/workspaces/${f.workspaceId}`,
      root = `/w/${f.workspaceId}`;
    const reader = f.accounts.find((a) => a.role === "reader"),
      admin = f.accounts.find((a) => a.role === "admin");
    if (!reader || !admin) throw new Error("계정 없음");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    let worker: ChildProcess | undefined;
    let publishedSource = "";
    const extracted = async (sourceId: string, versionId: string) =>
      expect
        .poll(
          async () =>
            (
              await (
                await clients.admin.get(
                  `${base}/sources/${sourceId}?version=${versionId}`,
                )
              ).json()
            ).version.processing,
          { timeout: 15000 },
        )
        .toBe("completed");
    const permission = (roles: string[], isAdmin = false) =>
      clients.admin.patch(`${base}/members/${reader.id}`, {
        data: { roles, isAdmin, isActive: true },
      });
    test.afterAll(async () => {
      await permission(["reader"]);
      if (worker && worker.exitCode === null) {
        const exited = new Promise<void>((resolve) =>
          worker?.once("exit", () => resolve()),
        );
        worker.kill("SIGTERM");
        await exited;
      }
      await pool.end();
    });
    test("체크 항목을 여러 개 선택해 저장·재조회하고 관리자 해제 시 지정 권한을 복원한다", async ({
      page,
    }) => {
      await page
        .context()
        .addCookies((await clients.admin.storageState()).cookies);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${root}/admin#members`);
      const details = page.locator("details.setting-detail").filter({
        has: page.locator("summary").filter({ hasText: reader.email }),
      });
      await details.locator(":scope > summary").click();
      const writing = details.getByRole("checkbox", {
          name: "작성 · 자료 등록과 위키 작성",
        }),
        review = details.getByRole("checkbox", {
          name: "검토 · 원문과 변경안 검토·승인",
        }),
        adminBox = details.getByRole("checkbox", { name: "관리자 권한 부여" });
      await writing.check();
      await review.focus();
      await page.keyboard.press("Space");
      await expect(writing).toBeChecked();
      await expect(review).toBeChecked();
      let heldRefresh = false;
      let releaseRefresh = () => {};
      const refreshGate = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      await page.route(
        (url) =>
          url.pathname === `${root}/admin` && url.searchParams.has("_rsc"),
        async (route) => {
          if (!heldRefresh) {
            heldRefresh = true;
            await refreshGate;
          }
          await route.continue();
        },
      );
      await details.getByRole("button", { name: "저장", exact: true }).click();
      try {
        await expect.poll(() => heldRefresh).toBe(true);
        await expect(details.locator("form").first()).toHaveAttribute(
          "aria-busy",
          "true",
        );
        await expect(adminBox).toBeDisabled();
      } finally {
        releaseRefresh();
      }
      await expect(details.locator("form").first()).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await expect(details.getByRole("status")).toHaveText("저장했습니다.");
      let members = await (await clients.admin.get(`${base}/members`)).json();
      expect(
        members.find((m: { id: string }) => m.id === reader.id),
      ).toMatchObject({
        role: "reviewer",
        roles: ["reader", "writer", "reviewer"],
        isAdmin: false,
      });
      await review.uncheck();
      await writing.uncheck();
      await adminBox.check();
      await expect(review).toBeChecked();
      await expect(writing).toBeChecked();
      await expect(review).toBeDisabled();
      await details.getByRole("button", { name: "저장", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await (await clients.admin.get(`${base}/members`)).json()).find(
              (m: { id: string }) => m.id === reader.id,
            ).isAdmin,
        )
        .toBe(true);
      await page.reload();
      await details.locator(":scope > summary").click();
      await expect(review).toBeChecked();
      await expect(writing).toBeChecked();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        scrollTo({ top: 0, behavior: "instant" });
      });
      await page.screenshot({
        path: "test-results/admin-permissions-mobile.png",
        fullPage: true,
      });
      await adminBox.uncheck();
      await expect(writing).not.toBeChecked();
      await expect(review).not.toBeChecked();
      await details.getByRole("button", { name: "저장", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await (await clients.admin.get(`${base}/members`)).json()).find(
              (m: { id: string }) => m.id === reader.id,
            ).isAdmin,
        )
        .toBe(false);
      members = await (await clients.admin.get(`${base}/members`)).json();
      expect(
        members.find((m: { id: string }) => m.id === reader.id).roles,
      ).toEqual(["reader"]);
    });
    test("기존 이용 역할의 관리자도 작성·검토·AI 작업을 실행하고 다른 직원 자료를 승인한다", async () => {
      const row = (
        await pool.query(
          "SELECT role,is_admin FROM membership WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, admin.id],
        )
      ).rows[0];
      expect(row).toEqual({ role: "reader", is_admin: true });
      worker = spawn(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", "src/worker/index.ts"],
        { env: process.env, stdio: "ignore" },
      );
      const record = {
        title: "관리자 권한 표본",
        domainId: f.domainId,
        projectId: null,
        rawNote: "관제 화면은 30초마다 갱신합니다.",
        situation: "관제 화면 확인",
        reasoning: "30초 조건 확인",
        result: "원문 대조",
        followUp: "",
        chunkIds: [],
      };
      const a = await clients.admin.post(`${base}/records`, { data: record });
      expect(a.status()).toBe(201);
      const own = await a.json();
      publishedSource = own.sourceId;
      await extracted(own.sourceId, own.versionId);
      expect(
        (
          await clients.admin.post(
            `${base}/source-versions/${own.versionId}/action`,
            { data: { action: "approve" } },
          )
        ).status(),
      ).toBe(409);
      expect(
        (
          await clients.reviewer.post(
            `${base}/source-versions/${own.versionId}/action`,
            { data: { action: "approve" } },
          )
        ).status(),
      ).toBe(200);
      const another = await (
        await clients.writer.post(`${base}/records`, {
          data: { ...record, title: "다른 작성자의 표본" },
        })
      ).json();
      await extracted(another.sourceId, another.versionId);
      expect(
        (
          await clients.admin.post(
            `${base}/source-versions/${another.versionId}/action`,
            { data: { action: "approve" } },
          )
        ).status(),
      ).toBe(200);
      const r = await clients.admin.post(`${base}/ai-tasks`, {
        data: {
          requestId: randomUUID(),
          sourceId: own.sourceId,
          kind: "analysis",
        },
      });
      expect(r.status()).toBe(201);
      const task = await r.json();
      await expect
        .poll(
          async () =>
            (
              await (
                await clients.admin.get(`${base}/ai-tasks/${task.id}`)
              ).json()
            ).state,
          { timeout: 20000 },
        )
        .toBe("completed");
      expect((await clients.admin.get(`${base}/review-desk`)).status()).toBe(
        200,
      );
    });
    test("여러 업무 권한과 관리자 부여·회수를 기존 세션과 담당자 선택에 즉시 적용한다", async () => {
      for (const bad of [
        [],
        ["reader", "writer", "writer"],
        ["root"],
        ["reader", "writer", "reviewer", "reader"],
      ])
        expect((await permission(bad)).status()).toBe(400);
      expect(
        (
          await clients.reader.patch(`${base}/members/${admin.id}`, {
            data: { roles: ["reviewer"], isAdmin: true, isActive: true },
          })
        ).status(),
      ).toBe(403);
      expect(
        (await permission(["reader", "writer", "reviewer"])).status(),
      ).toBe(200);
      expect((await clients.reader.get(`${base}/review-desk`)).status()).toBe(
        200,
      );
      expect((await permission(["reader"])).status()).toBe(200);
      expect((await clients.reader.get(`${base}/review-desk`)).status()).toBe(
        403,
      );
      expect((await permission(["reader"], true)).status()).toBe(200);
      const desk = await (
        await clients.reviewer.get(`${base}/review-desk`)
      ).json();
      expect(
        desk.reviewers.some((r: { id: string }) => r.id === reader.id),
      ).toBe(true);
      expect((await clients.reader.get(`${base}/review-desk`)).status()).toBe(
        200,
      );
      expect(
        (
          await clients.reader.get(`/api/workspaces/${f.outsiderWorkspaceId}`)
        ).status(),
      ).toBe(404);
      await pool.query(
        "UPDATE source SET title='관리자 지연 권한 검증' WHERE id=$1",
        [publishedSource],
      );
      const created = await clients.reader.post(`${base}/ai-tasks`, {
        data: {
          requestId: randomUUID(),
          sourceId: publishedSource,
          kind: "analysis",
        },
      });
      expect(created.status()).toBe(201);
      const task = await created.json();
      await expect
        .poll(
          async () =>
            Number(
              (
                await pool.query(
                  "SELECT count(*) FROM generation WHERE task_id=$1 AND state='running'",
                  [task.id],
                )
              ).rows[0].count,
            ),
          { timeout: 15000 },
        )
        .toBe(1);
      expect((await permission(["reader"])).status()).toBe(200);
      await expect
        .poll(
          async () =>
            (
              await pool.query("SELECT state FROM ai_task WHERE id=$1", [
                task.id,
              ])
            ).rows[0].state,
          { timeout: 15000 },
        )
        .toBe("failed");
      expect(
        (await pool.query("SELECT result FROM ai_task WHERE id=$1", [task.id]))
          .rows[0].result,
      ).toBeNull();
      expect((await clients.reader.get(`${base}/review-desk`)).status()).toBe(
        403,
      );
    });
  });
}
