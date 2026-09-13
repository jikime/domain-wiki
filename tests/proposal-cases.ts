import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";

type Fixture = {
  workspaceId: string;
  outsiderWorkspaceId: string;
  domainId: string;
  outsiderDomainId: string;
  accounts: { id: string; email: string; password: string; role: string }[];
};
export function registerProposalTests(
  fixture: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("4단계 실무 기록과 변경 묶음", () => {
    test.describe.configure({ mode: "serial" });
    const base = `/api/workspaces/${fixture.workspaceId}`;
    const root = `/w/${fixture.workspaceId}`;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    let worker: ChildProcess;
    let sourceId: string;
    let versionId: string;
    let chunkId: string;
    let generatedBatch: string;
    let firstPage: string;
    let firstVersion: string;
    let secondPage: string;
    let secondVersion: string;
    const record = {
      title: "관제 갱신 실무 경험",
      domainId: fixture.domainId,
      projectId: null,
      rawNote:
        "개발 표본입니다. 갱신 기준은 30초입니다. 모든 화면에 일괄 적용하지 않습니다.",
      situation: "관제 화면 갱신 지연을 확인했습니다.",
      reasoning: "30초 조건과 부정문을 확인했습니다.",
      result: "모든 화면에 일괄 적용하지 않았습니다.",
      followUp: "실제 고객 조건 확인 필요",
      chunkIds: [],
    };
    const info = async (
      id = sourceId,
      v = versionId,
      client = clients.writer,
    ) => {
      const response = await client.get(`${base}/sources/${id}?version=${v}`);
      expect(response.status()).toBe(200);
      return response.json();
    };
    const action = (
      kind: string,
      id: string,
      action: string,
      client = clients.reviewer,
      note = "",
    ) =>
      client.post(`${base}/${kind}/${id}/action`, { data: { action, note } });
    async function waitSource(id: string, v: string) {
      await expect
        .poll(async () => (await info(id, v)).version.processing, {
          timeout: 30000,
        })
        .toBe("completed");
    }
    const item = (title: string, extra = {}) => ({
      kind: "new",
      pageId: null,
      parentVersionId: null,
      basePublishedVersionId: null,
      title,
      body: "개발 표본의 갱신은 30초입니다. 모든 화면에 일괄 적용하지 않습니다.",
      reason: "작성자 진술과 원문 조건을 확인합니다.",
      chunkIds: [chunkId],
      mergedPages: [],
      ...extra,
    });
    const batch = (items: unknown[], title = "개발 변경 묶음") => ({
      title,
      domainId: fixture.domainId,
      projectId: null,
      items,
    });
    const generate = (data: unknown, client = clients.writer) =>
      client.post(`${base}/generations`, { data });
    async function sampleSource(marker: string) {
      const response = await clients.writer.post(`${base}/sources`, {
        multipart: {
          title: marker,
          category: "reference",
          domainId: fixture.domainId,
          projectId: "",
          file: {
            name: "sample.md",
            mimeType: "text/markdown",
            buffer: Buffer.from(
              `# ${marker}\n개발 갱신 표본. 30초마다 갱신하고 모든 화면에 적용하지 않습니다.`,
            ),
          },
        },
      });
      expect(response.status()).toBe(201);
      const result = await response.json();
      await waitSource(result.sourceId, result.versionId);
      expect(
        (await action("source-versions", result.versionId, "approve")).status(),
      ).toBe(200);
      return result;
    }
    test.beforeAll(async () => {
      for (const account of fixture.accounts) {
        const current = await clients[account.role].get(
          "/api/auth/get-session",
        );
        if ((await current.json())?.user) continue;
        expect(
          (
            await clients[account.role].post("/api/auth/sign-in/email", {
              data: { email: account.email, password: account.password },
            })
          ).status(),
        ).toBe(200);
      }
      worker = spawn(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", "src/worker/index.ts"],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      worker.stdout?.on("data", (chunk) => {
        output += chunk;
      });
      worker.stderr?.on("data", () => {});
      await expect
        .poll(() => output, { timeout: 15000 })
        .toContain("문서 처리 작업자가 준비되었습니다.");
    });
    test.afterAll(async () => {
      if (worker && worker.exitCode === null && worker.signalCode === null) {
        const stopped = new Promise<void>((resolve) =>
          worker.once("exit", () => resolve()),
        );
        worker.kill("SIGTERM");
        await stopped;
      }
      await pool.end();
    });

    test("실무 기록을 진술·원본·불변 버전으로 보관하고 검토 후 공개한다", async () => {
      expect(
        (
          await clients.reader.post(`${base}/records`, { data: record })
        ).status(),
      ).toBe(403);
      expect(
        (
          await clients.writer.post(`${base}/records`, {
            data: { ...record, domainId: fixture.outsiderDomainId },
          })
        ).status(),
      ).toBe(404);
      const response = await clients.writer.post(`${base}/records`, {
        data: record,
      });
      expect(response.status()).toBe(201);
      const saved = await response.json();
      sourceId = saved.sourceId;
      versionId = saved.versionId;
      expect(
        (await clients.reader.get(`${base}/sources/${sourceId}`)).status(),
      ).toBe(404);
      await waitSource(sourceId, versionId);
      const detail = await info();
      expect(detail.version.testimony.rawNote).toBe(record.rawNote);
      expect(detail.source.category).toBe("testimony");
      chunkId = detail.chunks[0].id;
      const download = await clients.writer.get(
        `${base}/source-versions/${versionId}/file`,
      );
      expect(await download.text()).toContain(record.reasoning);
      expect(
        (await action("source-versions", versionId, "approve")).status(),
      ).toBe(200);
      const search = await clients.reader.get(
        `${base}/search?q=관제&kind=source`,
      );
      expect(
        (await search.json()).some(
          (r: { id: string; category: string }) =>
            r.id === sourceId && r.category === "testimony",
        ),
      ).toBe(true);
      expect((await clients.outsider.get(`${base}/records`)).status()).toBe(
        404,
      );
    });
    test("기록 개정은 이전 진술을 보존하며 새 버전의 공개를 다시 검토한다", async () => {
      const oldId = versionId;
      const response = await clients.writer.post(
        `${base}/records/${sourceId}`,
        {
          data: {
            ...record,
            result:
              "재확인 후 30초 조건을 적용했습니다. 모든 화면에 일괄 적용하지 않았습니다.",
          },
        },
      );
      expect(response.status()).toBe(201);
      versionId = (await response.json()).versionId;
      expect(versionId).not.toBe(oldId);
      await waitSource(sourceId, versionId);
      expect((await info(sourceId, oldId)).version.testimony.result).toBe(
        record.result,
      );
      expect(
        (
          await clients.reader.get(
            `${base}/sources/${sourceId}?version=${versionId}`,
          )
        ).status(),
      ).toBe(404);
      expect(
        (await action("source-versions", versionId, "approve")).status(),
      ).toBe(200);
      chunkId = (await info()).chunks[0].id;
      expect(
        (
          await clients.reader.get(
            `${base}/sources/${sourceId}?version=${oldId}`,
          )
        ).status(),
      ).toBe(404);
    });
    test("메모 정리는 원본을 자동 생성하지 않으며 소유권·실패 상태를 지킨다", async () => {
      const before = await pool.query(
        "SELECT count(*)::int n FROM source WHERE workspace_id=$1",
        [fixture.workspaceId],
      );
      const requestId = randomUUID();
      const command = { action: "memo", requestId, rawNote: record.rawNote };
      expect((await generate(command, clients.reader)).status()).toBe(403);
      const response = await generate(command);
      expect(response.status()).toBe(201);
      const result = await response.json();
      expect(result.result.result).toContain("일괄 적용하지");
      expect((await generate(command)).status()).toBe(201);
      expect((await (await generate(command)).json()).id).toBe(result.id);
      expect(
        (await generate({ ...command, rawNote: "다른 메모" })).status(),
      ).toBe(409);
      expect(
        (
          await clients.reviewer.get(`${base}/generations/${result.id}`)
        ).status(),
      ).toBe(404);
      const failed = await generate({
        action: "memo",
        requestId: randomUUID(),
        rawNote: "모델오류",
      });
      expect(failed.status()).toBe(502);
      const after = await pool.query(
        "SELECT count(*)::int n FROM source WHERE workspace_id=$1",
        [fixture.workspaceId],
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
      expect(
        (
          await pool.query(
            "SELECT state FROM generation WHERE workspace_id=$1 AND state='failed'",
            [fixture.workspaceId],
          )
        ).rowCount,
      ).toBeGreaterThan(0);
    });
    test("원문 AI 제안은 근거 ID를 검증하고 게시본을 바꾸지 않는다", async () => {
      const requestId = randomUUID();
      const command = { action: "source", requestId, sourceId };
      const response = await generate(command);
      expect(response.status()).toBe(201);
      const result = await response.json();
      generatedBatch = result.batchId;
      const detail = await (
        await clients.writer.get(`${base}/proposals/${generatedBatch}`)
      ).json();
      expect(detail.batch.state).toBe("draft");
      expect(detail.batch.items[0].body).toContain("일괄 적용하지");
      expect(detail.batch.origin).toBe("source");
      expect((await generate(command)).status()).toBe(201);
      expect((await (await generate(command)).json()).batchId).toBe(
        generatedBatch,
      );
      expect(
        (
          await clients.reader.get(`${base}/proposals/${generatedBatch}`)
        ).status(),
      ).toBe(403);
      expect(
        (
          await clients.outsider.get(`${base}/proposals/${generatedBatch}`)
        ).status(),
      ).toBe(404);
      expect((await clients.writer.get(`${base}/wiki`)).status()).toBe(200);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM wiki_page p JOIN wiki_version v ON v.id=p.published_version_id WHERE p.workspace_id=$1 AND v.title=$2",
            [fixture.workspaceId, "개발 표본 갱신 제안"],
          )
        ).rows[0].n,
      ).toBe(0);
      const invalid = await sampleSource("거짓근거");
      expect(
        (
          await generate({
            action: "source",
            requestId: randomUUID(),
            sourceId: invalid.sourceId,
          })
        ).status(),
      ).toBe(502);
      const file = await sampleSource("파일블록");
      const parsed = await generate({
        action: "source",
        requestId: randomUUID(),
        sourceId: file.sourceId,
      });
      expect(parsed.status()).toBe(201);
      const parsedBatch = (await parsed.json()).batchId;
      const parsedBody = (
        await (
          await clients.writer.get(`${base}/proposals/${parsedBatch}`)
        ).json()
      ).batch.items[0].body;
      expect(parsedBody).not.toContain("---FILE:");
      for (const marker of ["위험경로", "미완성블록"]) {
        const bad = await sampleSource(marker);
        expect(
          (
            await generate({
              action: "source",
              requestId: randomUUID(),
              sourceId: bad.sourceId,
            })
          ).status(),
        ).toBe(502);
      }
    });
    test("변경 묶음의 자기 승인과 직접 변조를 거부하고 두 위키를 함께 게시한다", async () => {
      const own = await clients.reviewer.post(`${base}/proposals`, {
        data: batch([item("자기 승인 금지")]),
      });
      expect(own.status()).toBe(201);
      const ownId = (await own.json()).id;
      expect((await action("proposals", ownId, "submit")).status()).toBe(200);
      expect((await action("proposals", ownId, "approve")).status()).toBe(409);
      const response = await clients.writer.post(`${base}/proposals`, {
        data: batch([item("개발 갱신 조건"), item("개발 갱신 예외")]),
      });
      expect(response.status()).toBe(201);
      const id = (await response.json()).id;
      expect(
        (
          await clients.writer.patch(`${base}/proposals/${id}`, {
            data: { title: "검토 중 변조" },
          })
        ).status(),
      ).toBe(404);
      expect(
        (await action("proposals", id, "submit", clients.writer)).status(),
      ).toBe(200);
      const queue = await (
        await clients.reviewer.get(`${base}/reviews`)
      ).json();
      expect(queue.batches.some((b: { id: string }) => b.id === id)).toBe(true);
      const approved = await action("proposals", id, "approve");
      expect(approved.status()).toBe(200);
      const results = (await approved.json()).results;
      expect(results).toHaveLength(2);
      firstPage = results[0].pageId;
      firstVersion = results[0].versionId;
      secondPage = results[1].pageId;
      secondVersion = results[1].versionId;
      for (const r of results)
        expect(
          (await clients.reader.get(`${base}/wiki/${r.pageId}`)).status(),
        ).toBe(200);
      expect((await action("proposals", id, "approve")).status()).toBe(409);
    });
    test("검토 중 기준 버전 충돌은 묶음 전체 게시를 막는다", async () => {
      const command = batch([
        item("일부 게시 금지"),
        item("조건 수정", {
          kind: "update",
          pageId: firstPage,
          parentVersionId: firstVersion,
          basePublishedVersionId: firstVersion,
        }),
      ]);
      const response = await clients.writer.post(`${base}/proposals`, {
        data: command,
      });
      expect(response.status()).toBe(201);
      const id = (await response.json()).id;
      expect(
        (await action("proposals", id, "submit", clients.writer)).status(),
      ).toBe(200);
      const changed = await clients.writer.post(`${base}/wiki/${firstPage}`, {
        data: {
          title: "다른 직원의 최신 초안",
          body: "갱신 조건 추가 검토",
          domainId: fixture.domainId,
          projectId: null,
          parentVersionId: firstVersion,
          basePublishedVersionId: firstVersion,
          chunkIds: [chunkId],
        },
      });
      expect(changed.status()).toBe(201);
      expect((await action("proposals", id, "approve")).status()).toBe(409);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM wiki_version WHERE workspace_id=$1 AND title='일부 게시 금지'",
            [fixture.workspaceId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (await (await clients.reader.get(`${base}/wiki/${firstPage}`)).json())
          .version.id,
      ).toBe(firstVersion);
      expect(
        (
          await action(
            "proposals",
            id,
            "reject",
            clients.reviewer,
            "최신 초안을 기준으로 다시 비교해 주세요.",
          )
        ).status(),
      ).toBe(200);
      expect(
        (await action("proposals", id, "submit", clients.writer)).status(),
      ).toBe(409);
    });
    test("병합은 전체 근거와 정확한 버전을 확인하고 모순 제안은 승인하지 않는다", async () => {
      const latest = (
        await (await clients.writer.get(`${base}/wiki/${firstPage}`)).json()
      ).page.latestVersionId;
      const merge = item("개발 갱신 통합", {
        kind: "merge",
        pageId: firstPage,
        parentVersionId: latest,
        basePublishedVersionId: firstVersion,
        mergedPages: [
          {
            pageId: secondPage,
            publishedVersionId: secondVersion,
            latestVersionId: secondVersion,
          },
        ],
      });
      const response = await clients.writer.post(`${base}/proposals`, {
        data: batch([merge]),
      });
      expect(response.status()).toBe(201);
      const id = (await response.json()).id;
      expect(
        (await action("proposals", id, "submit", clients.writer)).status(),
      ).toBe(200);
      const approved = await action("proposals", id, "approve");
      expect(approved.status()).toBe(200);
      firstVersion = (await approved.json()).results[0].versionId;
      expect(
        (await clients.reader.get(`${base}/wiki/${secondPage}`)).status(),
      ).toBe(404);
      expect(
        (
          await clients.reviewer.get(
            `${base}/wiki/${secondPage}?version=${secondVersion}`,
          )
        ).status(),
      ).toBe(200);
      const conflicting = await clients.writer.post(`${base}/proposals`, {
        data: batch([
          item("모순 확인", {
            kind: "conflict",
            pageId: firstPage,
            parentVersionId: firstVersion,
            basePublishedVersionId: firstVersion,
          }),
        ]),
      });
      expect(conflicting.status()).toBe(201);
      const conflictId = (await conflicting.json()).id;
      expect(
        (
          await action("proposals", conflictId, "submit", clients.writer)
        ).status(),
      ).toBe(200);
      expect((await action("proposals", conflictId, "approve")).status()).toBe(
        409,
      );
    });
    test("본인의 완료 답변을 원문에 연결된 제안으로 저장하며 새 자료를 만들지 않는다", async () => {
      const conversation = await clients.writer.post(`${base}/conversations`, {
        data: {
          title: "실무 기록 질문",
          scope: {
            domainId: fixture.domainId,
            projectId: null,
            sourceId,
            wikiId: null,
          },
        },
      });
      expect(conversation.status()).toBe(201);
      const conversationId = (await conversation.json()).id;
      const stream = await clients.writer.post(
        `${base}/conversations/${conversationId}/stream`,
        { data: { requestId: randomUUID(), prompt: "관제 갱신 조건은?" } },
      );
      expect(stream.status()).toBe(200);
      expect(await stream.text()).toContain('"completed"');
      const detail = await (
        await clients.writer.get(`${base}/conversations/${conversationId}`)
      ).json();
      const runId = detail.runs[0].id;
      const before = (
        await pool.query(
          "SELECT count(*)::int n FROM source WHERE workspace_id=$1",
          [fixture.workspaceId],
        )
      ).rows[0].n;
      const command = {
        action: "answer",
        requestId: randomUUID(),
        conversationId,
        runId,
        title: "답변에서 남긴 갱신 지식",
      };
      expect((await generate(command, clients.reviewer)).status()).toBe(404);
      const response = await generate(command);
      expect(response.status()).toBe(201);
      const id = (await response.json()).batchId;
      const proposal = await (
        await clients.reviewer.get(`${base}/proposals/${id}`)
      ).json();
      expect(proposal.batch.origin).toBe("answer");
      expect(proposal.batch.items[0].chunkIds.length).toBeGreaterThan(0);
      expect(JSON.stringify(proposal)).not.toContain("관제 갱신 조건은?");
      expect(
        (
          await pool.query(
            "SELECT count(*)::int n FROM source WHERE workspace_id=$1",
            [fixture.workspaceId],
          )
        ).rows[0].n,
      ).toBe(before);
    });
    test("실제 폼·근거·검토 화면을 모바일에서 열고 변경안을 승인한다", async ({
      browser,
    }) => {
      const errors: string[] = [];
      const writer = await browser.newContext({
        storageState: await clients.writer.storageState(),
        viewport: { width: 390, height: 844 },
      });
      const page = await writer.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${root}/records`);
      await expect(
        page.getByRole("heading", { name: "실무 기록", exact: true }),
      ).toBeVisible();
      await page
        .getByLabel("기록 제목", { exact: true })
        .fill("화면으로 남긴 경험");
      await page
        .getByLabel("상황", { exact: true })
        .fill("개발 표본 화면 확인");
      await page
        .getByLabel("판단과 이유", { exact: true })
        .fill("행과 단위를 확인했습니다.");
      await page
        .getByLabel("결과", { exact: true })
        .fill("누락 없이 확인했습니다.");
      await page
        .getByRole("button", { name: "실무 기록 저장", exact: true })
        .click();
      await expect(page).toHaveURL(/\/sources\//);
      await expect(
        page.getByRole("heading", { name: "작성자 진술", exact: true }),
      ).toBeVisible();
      await page.goto(`${root}/proposals/${generatedBatch}`);
      await page
        .getByRole("button", { name: "묶음 검토 요청", exact: true })
        .click();
      await expect(page.getByText("검토 대기 · 변경안 1개")).toBeVisible();
      await expect(
        page.getByRole("link", { name: "← 변경 묶음" }),
      ).toBeVisible();
      await page
        .getByText("내용을 수정해 새 묶음으로 작성", { exact: true })
        .click();
      await expect(
        page.getByLabel("변경 묶음 제목", { exact: true }),
      ).toHaveValue("개발 표본 갱신 제안");
      await page
        .getByLabel("변경 묶음 제목", { exact: true })
        .fill("수정된 제안");
      await page
        .getByRole("button", { name: "수정한 새 변경 묶음 저장", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "수정된 제안", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      mkdirSync("docs/stages/04-proposals/screenshots", { recursive: true });
      await page.screenshot({
        path: "docs/stages/04-proposals/screenshots/mobile-proposal.png",
        fullPage: true,
      });
      await writer.close();
      const reviewer = await browser.newContext({
        storageState: await clients.reviewer.storageState(),
        viewport: { width: 1280, height: 900 },
      });
      const review = await reviewer.newPage();
      review.on("pageerror", (error) => errors.push(error.message));
      await review.goto(`${root}/proposals/${generatedBatch}`);
      await review
        .getByRole("button", { name: "전체 변경 승인·게시", exact: true })
        .click();
      await expect(
        review.getByRole("heading", { name: "게시된 위키", exact: true }),
      ).toBeVisible();
      await review.screenshot({
        path: "docs/stages/04-proposals/screenshots/approved-batch.png",
        fullPage: true,
      });
      await reviewer.close();
      expect(errors).toEqual([]);
    });
    test("원문 철회 후 이전 근거의 제안 생성·승인과 답변 재사용을 막는다", async () => {
      const pending = await clients.writer.post(`${base}/proposals`, {
        data: batch([item("철회 후 게시 금지")]),
      });
      expect(pending.status()).toBe(201);
      const id = (await pending.json()).id;
      expect(
        (await action("proposals", id, "submit", clients.writer)).status(),
      ).toBe(200);
      expect(
        (await action("source-versions", versionId, "withdraw")).status(),
      ).toBe(200);
      expect((await action("proposals", id, "approve")).status()).toBe(409);
      expect(
        (
          await generate({
            action: "source",
            requestId: randomUUID(),
            sourceId,
          })
        ).status(),
      ).toBe(409);
      const detail = await (
        await clients.writer.get(`${base}/proposals/${id}`)
      ).json();
      expect(
        detail.evidence.every((r: { available: boolean }) => !r.available),
      ).toBe(true);
      expect(
        (await clients.reader.get(`${base}/wiki/${firstPage}`)).status(),
      ).toBe(404);
    });
  });
}
