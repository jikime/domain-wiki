import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";
import {
  domainKnowledgeRules,
  emptyPurposeGuide,
  purposeFields,
} from "../src/lib/domain-purpose";

type Fixture = {
  workspaceId: string;
  outsiderWorkspaceId: string;
  accounts: { id: string; role: string }[];
};
export function registerDomainPurposeTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("도메인 Purpose", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const base = `/api/workspaces/${f.workspaceId}`;
    const guide = {
      keyQuestions: "어떤 화면에 30초 갱신을 적용하나요?",
      scopeIncluded: "개발용 관제 화면의 갱신 조건",
      scopeExcluded: "일반 화면. 원문의 예외는 계속 확인합니다.",
      workingAssumptions: "잠정 가정: 반복 문의를 줄일 수 있을지 확인합니다.",
      successCriteria: "원문 위치로 갱신 조건과 예외를 설명할 수 있습니다.",
    };
    const value = {
      name: `Purpose 표본 ${randomUUID().slice(0, 8)}`,
      purpose: "위키의 방향과 원문 사실을 구분합니다.",
      terms: [],
      recordTemplate: "사실\n조건\n확인할 내용",
    };
    let domainId = "";
    let worker: ChildProcess | undefined;
    const normal = {
      source: randomUUID(),
      version: randomUUID(),
      chunk: randomUUID(),
    };
    const slow = {
      source: randomUUID(),
      version: randomUUID(),
      chunk: randomUUID(),
    };
    const stats = async () =>
      (await (await fetch("http://127.0.0.1:3102/stats")).json()).calls as {
        role: string;
        content: string;
      }[][];
    const save = (purposeGuide: typeof guide) =>
      clients.admin.patch(`${base}/domains/${domainId}`, {
        data: { ...value, purposeGuide },
      });
    const current = async () =>
      (await (await clients.reader.get(base)).json()).domains.find(
        (d: { id: string }) => d.id === domainId,
      );
    const taskInfo = async (id: string) =>
      (await clients.writer.get(`${base}/ai-tasks/${id}`)).json();
    async function startWorker() {
      worker = spawn(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", "src/worker/index.ts"],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
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
    async function stopWorker() {
      if (!worker || worker.exitCode !== null || worker.signalCode !== null)
        return;
      const done = new Promise<void>((resolve) =>
        worker?.once("exit", () => resolve()),
      );
      worker.kill("SIGTERM");
      await done;
      worker = undefined;
    }
    async function create(kind: "analysis" | "summary" = "analysis") {
      const response = await clients.writer.post(`${base}/ai-tasks`, {
        data: { sourceId: normal.source, requestId: randomUUID(), kind },
      });
      expect(response.status()).toBe(201);
      return response.json();
    }
    test.beforeAll(async () => {
      const response = await clients.admin.post(`${base}/domains`, {
        data: value,
      });
      expect(response.status()).toBe(201);
      domainId = (await response.json()).id;
      const writer = f.accounts.find((a) => a.role === "writer");
      for (const [item, title] of [
        [normal, "Purpose 원문"],
        [slow, "Purpose 지연 원문"],
      ] as const) {
        await pool.query(
          "INSERT INTO source(id,workspace_id,domain_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,'reference',$5,$6,$6,1)",
          [
            item.source,
            f.workspaceId,
            domainId,
            title,
            writer?.id,
            item.version,
          ],
        );
        await pool.query(
          "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'purpose.md','text/markdown',$4,$4,60,$5,'published','completed')",
          [item.version, f.workspaceId, item.source, randomUUID(), writer?.id],
        );
        await pool.query(
          "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,0,'관제 화면은 30초마다 갱신합니다. 일반 화면에 일괄 적용하지 않습니다.',$4)",
          [
            item.chunk,
            f.workspaceId,
            item.version,
            { kind: "lines", startLine: 1, endLine: 2 },
          ],
        );
      }
    });
    test.afterAll(async () => {
      await stopWorker();
      await pool.end();
    });
    test("기존 목적과 분석 기준을 보존하고 관리자만 질문·범위·가정을 저장한다", async () => {
      expect((await current()).purposeGuide).toEqual(emptyPurposeGuide);
      const oldRules = {
        name: value.name,
        purpose: value.purpose,
        terms: value.terms,
        recordTemplate: value.recordTemplate,
      };
      expect(
        domainKnowledgeRules({ ...value, purposeGuide: emptyPurposeGuide }),
      ).toEqual(oldRules);
      expect((await save(guide)).status()).toBe(200);
      expect((await current()).purposeGuide).toEqual(guide);
      const legacy = await clients.admin.patch(`${base}/domains/${domainId}`, {
        data: value,
      });
      expect(legacy.status()).toBe(200);
      expect((await current()).purposeGuide).toEqual(guide);
      for (const role of ["reader", "writer", "reviewer"])
        expect(
          (
            await clients[role].patch(`${base}/domains/${domainId}`, {
              data: { ...value, purposeGuide: emptyPurposeGuide },
            })
          ).status(),
        ).toBe(403);
      expect(
        (
          await clients.outsider.patch(`${base}/domains/${domainId}`, {
            data: { ...value, purposeGuide: guide },
          })
        ).status(),
      ).toBe(404);
      for (const invalid of [
        { ...guide, keyQuestions: "가".repeat(2001) },
        { ...guide, untrusted: "추가 입력" },
        { keyQuestions: "일부 키만 입력" },
      ])
        expect(
          (
            await clients.admin.patch(`${base}/domains/${domainId}`, {
              data: { ...value, purposeGuide: invalid },
            })
          ).status(),
        ).toBe(400);
      expect((await current()).purpose).toBe(value.purpose);
      expect((await current()).purposeGuide).toEqual(guide);
    });
    test("모바일 관리 폼에서 선택 항목을 저장·복원하고 비우면 이전 목적만 유지한다", async ({
      page,
    }) => {
      await page
        .context()
        .addCookies((await clients.admin.storageState()).cookies);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/w/${f.workspaceId}/admin`);
      const details = page
        .locator("details.setting-detail")
        .filter({ has: page.locator(`input[id="${domainId}-name"]`) })
        .first();
      await details.locator(":scope > summary").click();
      const form = details.locator("form").first();
      await form
        .getByText("목적의 질문·범위·판단 기준 (선택)", { exact: true })
        .click();
      for (const field of purposeFields)
        await expect(form.getByLabel(field.label, { exact: true })).toHaveValue(
          guide[field.key],
        );
      await form
        .getByLabel("핵심 질문", { exact: true })
        .fill("마지막 예외까지 확인할 수 있나요?");
      await form.getByRole("button", { name: "저장", exact: true }).click();
      await expect(form.getByRole("status")).toHaveText("저장했습니다.");
      await page.reload();
      await details.locator(":scope > summary").click();
      await form
        .getByText("목적의 질문·범위·판단 기준 (선택)", { exact: true })
        .click();
      await expect(form.getByLabel("핵심 질문", { exact: true })).toHaveValue(
        "마지막 예외까지 확인할 수 있나요?",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      for (const field of purposeFields)
        await form.getByLabel(field.label, { exact: true }).fill("");
      await form.getByRole("button", { name: "저장", exact: true }).click();
      await expect(form.getByRole("status")).toHaveText("저장했습니다.");
      expect((await current()).purposeGuide).toEqual(emptyPurposeGuide);
      expect((await current()).purpose).toBe(value.purpose);
      expect((await save(guide)).status()).toBe(200);
    });
    test("요약·전체 분석·위키 생성에 같은 목적을 전달하고 사실 근거와 구분한다", async () => {
      await startWorker();
      for (const kind of ["summary", "analysis"] as const) {
        const task = await create(kind);
        await expect
          .poll(async () => (await taskInfo(task.id)).state, { timeout: 30000 })
          .toBe("completed");
        const stored = await pool.query(
          "SELECT rules_hash FROM ai_task WHERE id=$1",
          [task.id],
        );
        expect(stored.rows[0].rules_hash).toBe(
          createHash("sha256")
            .update(
              JSON.stringify(
                domainKnowledgeRules({ ...value, purposeGuide: guide }),
              ),
            )
            .digest("hex"),
        );
      }
      const generated = await clients.writer.post(`${base}/generations`, {
        data: {
          action: "source",
          sourceId: normal.source,
          requestId: randomUUID(),
        },
      });
      expect(generated.status()).toBe(201);
      const calls = (await stats()).filter((call) =>
        call.at(-1)?.content.includes('"sourceTitle":"Purpose 원문"'),
      );
      expect(calls).toHaveLength(3);
      for (const call of calls) {
        const payload = JSON.parse(call.at(-1)?.content ?? "{}");
        expect(payload.domain.purpose).toBe(value.purpose);
        expect(payload.domain.purposeGuide).toEqual(guide);
        expect(call[0].content).toContain("사실");
        expect(call[0].content).toContain("잠정");
        expect(call[0].content).toContain("예외");
      }
      const batch = (await generated.json()).batchId;
      const detail = await (
        await clients.writer.get(`${base}/proposals/${batch}`)
      ).json();
      expect(detail.batch.items[0].chunkIds).toEqual([normal.chunk]);
      expect(detail.batch.items[0].body).not.toContain(
        guide.workingAssumptions,
      );
    });
    test("질문·범위 변경은 대기 분석과 생성 중 저장을 차단하고 긴 기준을 몰래 잘라 쓰지 않는다", async () => {
      test.setTimeout(60000);
      await stopWorker();
      const pending = await create();
      const before = (await stats()).length;
      expect(
        (
          await save({ ...guide, keyQuestions: "적용 대상 변경 확인" })
        ).status(),
      ).toBe(200);
      await startWorker();
      await expect
        .poll(async () => (await taskInfo(pending.id)).state, {
          timeout: 30000,
        })
        .toBe("failed");
      expect((await taskInfo(pending.id)).errorMessage).toContain(
        "도메인 기준",
      );
      expect((await stats()).length).toBe(before);
      expect((await save(guide)).status()).toBe(200);
      const requestId = randomUUID();
      const generation = clients.writer.post(`${base}/generations`, {
        data: { action: "source", sourceId: slow.source, requestId },
      });
      await expect
        .poll(async () =>
          (await stats()).some((call) =>
            call.at(-1)?.content.includes('"sourceTitle":"Purpose 지연 원문"'),
          ),
        )
        .toBe(true);
      expect(
        (await save({ ...guide, scopeExcluded: "일반 화면·새 사업" })).status(),
      ).toBe(200);
      expect((await generation).status()).toBe(409);
      const rows = await pool.query(
        "SELECT state,batch_id FROM generation WHERE workspace_id=$1 AND request_id=$2",
        [f.workspaceId, requestId],
      );
      expect(rows.rows[0]).toEqual({ state: "failed", batch_id: null });
      const large = await clients.admin.patch(`${base}/domains/${domainId}`, {
        data: {
          ...value,
          purposeGuide: guide,
          terms: Array.from({ length: 100 }, (_, i) => ({
            term: `용어${i}`,
            definition: "context ".repeat(60),
          })),
        },
      });
      expect(large.status()).toBe(200);
      const count = (await stats()).length;
      const oversize = await create();
      await expect
        .poll(async () => (await taskInfo(oversize.id)).state, {
          timeout: 30000,
        })
        .toBe("failed");
      expect((await stats()).length).toBe(count);
      expect((await taskInfo(oversize.id)).errorMessage).toContain("입력 공간");
      expect((await save(guide)).status()).toBe(200);
    });
  });
}
