import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";

type Fixture = {
  workspaceId: string;
  outsiderWorkspaceId: string;
  domainId: string;
  outsiderDomainId: string;
  accounts: { id: string; email: string; password: string; role: string }[];
};
export function registerAiTaskTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("9단계 AI 작업 기반", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const base = `/api/workspaces/${f.workspaceId}`,
      root = `/w/${f.workspaceId}`;
    const writer = f.accounts.find((a) => a.role === "writer");
    if (!writer) throw new Error("작성 계정 없음");
    let worker: ChildProcess | undefined;
    const sample = () => ({
      source: randomUUID(),
      version: randomUUID(),
      chunk: randomUUID(),
    });
    const normal = sample(),
      slow = sample(),
      bad = sample();
    let first = "";
    const info = async (id: string) => {
      const r = await clients.writer.get(`${base}/ai-tasks/${id}`);
      expect(r.status()).toBe(200);
      return r.json();
    };
    const waitState = async (id: string, state: string) => {
      await expect
        .poll(async () => (await info(id)).state, {
          timeout: 30000,
          intervals: [200, 400, 800],
        })
        .toBe(state);
      return info(id);
    };
    const create = async (
      sourceId = normal.source,
      requestId = randomUUID(),
    ) => {
      const r = await clients.writer.post(`${base}/ai-tasks`, {
        data: { sourceId, requestId },
      });
      expect(r.status()).toBe(201);
      return r.json();
    };
    const action = (id: string, action: string) =>
      clients.writer.patch(`${base}/ai-tasks/${id}`, { data: { action } });
    async function startWorker(overrides: Record<string, string> = {}) {
      worker = spawn(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", "src/worker/index.ts"],
        {
          env: { ...process.env, ...overrides },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      worker.stdout?.on("data", (c) => {
        output += c;
      });
      worker.stderr?.on("data", (c) => {
        output += c;
      });
      await expect
        .poll(() => output, { timeout: 15000 })
        .toContain("문서 처리 작업자가 준비되었습니다.");
    }
    async function stopWorker(force = false) {
      if (!worker || worker.exitCode !== null || worker.signalCode !== null)
        return;
      const exit = new Promise<void>((resolve) =>
        worker?.once("exit", () => resolve()),
      );
      worker.kill(force ? "SIGKILL" : "SIGTERM");
      await exit;
      worker = undefined;
    }
    async function called(id: string) {
      await expect
        .poll(
          async () =>
            Number(
              (
                await pool.query(
                  "SELECT count(*) FROM generation WHERE task_id=$1 AND state='running'",
                  [id],
                )
              ).rows[0].count,
            ),
          { timeout: 20000 },
        )
        .toBe(1);
    }
    test.beforeAll(async () => {
      for (const [sample, title] of [
        [normal, "AI 작업 표본"],
        [slow, "AI 지연 표본"],
        [bad, "AI 거짓근거 표본"],
      ] as const) {
        await pool.query(
          "INSERT INTO source(id,workspace_id,domain_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,'reference',$5,$6,$6,1)",
          [
            sample.source,
            f.workspaceId,
            f.domainId,
            title,
            writer.id,
            sample.version,
          ],
        );
        await pool.query(
          "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'task.md','text/markdown',$4,$4,60,$5,'published','completed')",
          [
            sample.version,
            f.workspaceId,
            sample.source,
            randomUUID(),
            writer.id,
          ],
        );
        await pool.query(
          "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,0,'관제 화면은 30초마다 갱신합니다. 모든 화면에 일괄 적용하지 않습니다.',$4)",
          [
            sample.chunk,
            f.workspaceId,
            sample.version,
            { kind: "lines", startLine: 1, endLine: 2 },
          ],
        );
      }
    });
    test.afterAll(async () => {
      await stopWorker();
      await pool.query(
        "UPDATE membership SET is_active=true WHERE workspace_id=$1 AND user_id=$2",
        [f.workspaceId, writer.id],
      );
      await pool.end();
    });
    test("용도별 모델 연결·입력 상한을 보여 주고 관리자만 점검한다", async ({
      page,
    }) => {
      expect(
        (
          await clients.reader.post(`${base}/model`, {
            data: { action: "test" },
          })
        ).status(),
      ).toBe(403);
      const connection = await clients.admin.post(`${base}/model`, {
        data: { action: "test" },
      });
      expect(connection.status()).toBe(200);
      expect((await connection.json()).knowledge).toContain("응답 수신 확인");
      const stats = await (await fetch("http://127.0.0.1:3102/stats")).json();
      expect(stats.models.slice(-2)).toEqual(["test-model", "test-knowledge"]);
      await page
        .context()
        .addCookies((await clients.admin.storageState()).cookies);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${root}/admin#model`);
      await expect(
        page.getByText("지식 생성 입력 상한", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("48,000자", { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
    test("같은 요청을 동시에 등록해도 하나만 남고 웹을 닫아도 대기한다", async ({
      browser,
    }) => {
      const req = randomUUID();
      const replies = await Promise.all(
        Array.from({ length: 8 }, () => create(normal.source, req)),
      );
      first = replies[0].id;
      expect(new Set(replies.map((r) => r.id)).size).toBe(1);
      expect(
        (
          await clients.writer.post(`${base}/ai-tasks`, {
            data: { requestId: req, sourceId: slow.source },
          })
        ).status(),
      ).toBe(409);
      for (const role of ["reader"])
        expect(
          (
            await clients[role].post(`${base}/ai-tasks`, {
              data: { requestId: randomUUID(), sourceId: normal.source },
            })
          ).status(),
        ).toBe(403);
      expect(
        (await clients.outsider.get(`${base}/ai-tasks/${first}`)).status(),
      ).toBe(404);
      const context = await browser.newContext({
        storageState: await clients.writer.storageState(),
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      await page.goto(`${root}/ai-tasks/${first}`);
      await expect(
        page.getByRole("heading", { name: "문서 요약", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("배정 대기", { exact: true })).toBeVisible();
      await context.close();
      expect((await info(first)).state).toBe("waiting");
      await startWorker();
    });
    test("작업자가 요약·문단 범위·근거·호출 사용량을 영속 저장한다", async ({
      page,
    }) => {
      const done = await waitState(first, "completed");
      expect(done.steps.map((s: { state: string }) => s.state)).toEqual([
        "completed",
        "completed",
      ]);
      expect(done.result.coverage).toEqual({
        totalChunks: 1,
        processedChunks: 1,
        excluded: [],
      });
      expect(done.result.claims[0].chunkId).toBe(normal.chunk);
      expect(done.usage).toEqual([
        {
          inputTokens: 120,
          outputTokens: 40,
          state: "completed",
          model: "test-knowledge",
        },
      ]);
      expect(
        (await clients.reviewer.get(`${base}/ai-tasks/${first}`)).status(),
      ).toBe(200);
      expect(
        (await clients.reader.get(`${base}/ai-tasks/${first}`)).status(),
      ).toBe(403);
      await page
        .context()
        .addCookies((await clients.writer.storageState()).cookies);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${root}/ai-tasks/${first}`);
      await expect(
        page.getByRole("link", { name: "원문 구절 확인" }),
      ).toHaveAttribute("href", new RegExp(normal.chunk));
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "test-results/09-ai-task-mobile.png",
        fullPage: true,
      });
      await pool.query(
        "UPDATE source SET published_version_id=NULL WHERE id=$1",
        [normal.source],
      );
      expect((await info(first)).result).toBeNull();
      await pool.query(
        "UPDATE source SET published_version_id=$2 WHERE id=$1",
        [normal.source, normal.version],
      );
    });
    test("진행 중 취소는 늦게 도착한 결과를 차단하고 재시도한다", async ({
      page,
    }) => {
      const task = await create(slow.source);
      await called(task.id);
      await page
        .context()
        .addCookies((await clients.writer.storageState()).cookies);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${root}/ai-tasks/${task.id}`);
      await page
        .getByRole("button", { name: "AI 작업 취소", exact: true })
        .click();
      await waitState(task.id, "canceled");
      await expect
        .poll(async () =>
          (await info(task.id)).usage.every(
            (u: { state: string }) => u.state === "failed",
          ),
        )
        .toBe(true);
      expect((await info(task.id)).result).toBeNull();
      await page
        .getByRole("button", { name: "완료한 단계부터 재시도", exact: true })
        .click();
      const done = await waitState(task.id, "completed");
      expect(done.steps[0].state).toBe("completed");
      expect(
        done.usage.filter((u: { state: string }) => u.state === "completed"),
      ).toHaveLength(1);
    });
    test("작업자를 강제 종료하면 임대 만료 후 중단 단계부터 복구한다", async () => {
      test.setTimeout(60000);
      const task = await create(slow.source);
      await called(task.id);
      await stopWorker(true);
      expect((await info(task.id)).state).toBe("running");
      await startWorker();
      const done = await waitState(task.id, "completed");
      expect(done.recoveries).toBe(1);
      expect(done.steps[0].state).toBe("completed");
      expect(done.steps[1].attempts).toBe(2);
      expect(done.usage.map((u: { state: string }) => u.state).sort()).toEqual([
        "completed",
        "failed",
      ]);
    });
    test("결과 저장 직후 중단된 완료 단계는 모델을 다시 호출하지 않는다", async () => {
      await stopWorker();
      const before = (await info(first)).usage.length;
      await pool.query(
        "UPDATE ai_task SET state='running',lease_token=$2,heartbeat_at=now()-interval '1 minute',result=NULL WHERE id=$1",
        [first, randomUUID()],
      );
      await startWorker();
      const done = await waitState(first, "completed");
      expect(done.usage).toHaveLength(before);
      expect(done.steps[1].attempts).toBe(1);
      expect(done.result.claims).toHaveLength(1);
    });
    test("실행 도중 원문 철회·계정 비활성은 후속 결과와 재시도를 막는다", async () => {
      const revoked = await create(slow.source);
      await called(revoked.id);
      await pool.query(
        "UPDATE source SET published_version_id=NULL WHERE id=$1",
        [slow.source],
      );
      await waitState(revoked.id, "failed");
      expect((await action(revoked.id, "retry")).status()).toBe(409);
      expect((await info(revoked.id)).result).toBeNull();
      await pool.query(
        "UPDATE source SET published_version_id=$2 WHERE id=$1",
        [slow.source, slow.version],
      );
      const inactive = await create(slow.source);
      await called(inactive.id);
      await pool.query(
        "UPDATE membership SET is_active=false WHERE workspace_id=$1 AND user_id=$2",
        [f.workspaceId, writer.id],
      );
      await expect
        .poll(
          async () =>
            (
              await pool.query("SELECT state FROM ai_task WHERE id=$1", [
                inactive.id,
              ])
            ).rows[0].state,
          { timeout: 15000 },
        )
        .toBe("failed");
      expect(
        (await clients.writer.get(`${base}/ai-tasks/${inactive.id}`)).status(),
      ).toBe(404);
      await pool.query(
        "UPDATE membership SET is_active=true WHERE workspace_id=$1 AND user_id=$2",
        [f.workspaceId, writer.id],
      );
    });
    test("잘못된 원문 인용은 실패로 저장하고 사용량은 유지한다", async () => {
      const task = await create(bad.source);
      const failed = await waitState(task.id, "failed");
      expect(failed.result).toBeNull();
      expect(failed.errorMessage).toContain("원문 ID 또는 인용");
      expect(failed.usage[0]).toMatchObject({
        inputTokens: 120,
        outputTokens: 40,
        state: "failed",
      });
    });
    test("진행 중인 문서 작업도 팀의 대화·생성 동시 실행 한도를 공유한다", async () => {
      const old = (
        await pool.query(
          "SELECT concurrency FROM operations_policy WHERE workspace_id=$1",
          [f.workspaceId],
        )
      ).rows[0];
      await pool.query(
        "INSERT INTO operations_policy(workspace_id,concurrency) VALUES($1,1) ON CONFLICT(workspace_id) DO UPDATE SET concurrency=1",
        [f.workspaceId],
      );
      try {
        const task = await create(slow.source);
        await called(task.id);
        const r = await clients.writer.post(`${base}/generations`, {
          data: {
            action: "memo",
            requestId: randomUUID(),
            rawNote: "동시 실행 한도 확인",
          },
        });
        expect(r.status()).toBe(429);
        await waitState(task.id, "completed");
      } finally {
        if (old)
          await pool.query(
            "UPDATE operations_policy SET concurrency=$2 WHERE workspace_id=$1",
            [f.workspaceId, old.concurrency],
          );
        else
          await pool.query(
            "DELETE FROM operations_policy WHERE workspace_id=$1",
            [f.workspaceId],
          );
      }
    });
    test("도메인 규칙이 바뀐 대기 작업은 이전 기준으로 호출하지 않는다", async () => {
      await stopWorker();
      const task = await create();
      const old = (
        await pool.query("SELECT purpose FROM domain WHERE id=$1", [f.domainId])
      ).rows[0].purpose;
      try {
        await pool.query("UPDATE domain SET purpose=$2 WHERE id=$1", [
          f.domainId,
          `${old} 변경된 처리 기준`,
        ]);
        await startWorker();
        const failed = await waitState(task.id, "failed");
        expect(failed.errorMessage).toContain("도메인 기준");
        expect(failed.usage).toHaveLength(0);
        expect((await action(task.id, "retry")).status()).toBe(409);
      } finally {
        await pool.query("UPDATE domain SET purpose=$2 WHERE id=$1", [
          f.domainId,
          old,
        ]);
      }
    });
    test("모델 미설정 대기를 설정 후 재개하며 3분 정리가 장기 작업을 건드리지 않는다", async () => {
      test.setTimeout(60000);
      await stopWorker();
      const noModel = {
        AI_BASE_URL: "",
        AI_MODEL: "",
        AI_API_KEY: "",
        AI_CHAT_BASE_URL: "",
        AI_CHAT_MODEL: "",
        AI_CHAT_API_KEY: "",
        AI_KNOWLEDGE_BASE_URL: "",
        AI_KNOWLEDGE_MODEL: "",
        AI_KNOWLEDGE_API_KEY: "",
        OPENAI_API_KEY: "",
      };
      const cookies = (await clients.writer.storageState()).cookies
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
      const code = `import {createAiTask} from './src/server/services/ai-tasks.ts';import {getPool} from './src/server/db/index.ts';const task=await createAiTask(new Headers({cookie:process.env.TASK_TEST_COOKIE}),process.env.TASK_TEST_WORKSPACE,{sourceId:process.env.TASK_TEST_SOURCE,requestId:process.env.TASK_TEST_REQUEST});console.log(task.id);await getPool().end();`;
      const id = execFileSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          code,
        ],
        {
          env: {
            ...process.env,
            ...noModel,
            TASK_TEST_COOKIE: cookies,
            TASK_TEST_WORKSPACE: f.workspaceId,
            TASK_TEST_SOURCE: normal.source,
            TASK_TEST_REQUEST: randomUUID(),
          },
          encoding: "utf8",
        },
      ).trim();
      expect((await info(id)).state).toBe("waiting");
      expect((await info(id)).model).toBeNull();
      await startWorker(noModel);
      await expect
        .poll(async () => (await info(id)).errorMessage)
        .toContain("모델 설정 대기");
      expect((await info(id)).usage).toHaveLength(0);
      await stopWorker();
      await startWorker();
      await waitState(id, "completed");
      const slowTask = await create(slow.source);
      await called(slowTask.id);
      await pool.query(
        "UPDATE generation SET created_at=now()-interval '4 minutes' WHERE task_id=$1",
        [slowTask.id],
      );
      const done = await waitState(slowTask.id, "completed");
      expect(done.usage[0].state).toBe("completed");
    });
  });
}
