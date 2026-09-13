import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";

type Fixture = {
  workspaceId: string;
  outsiderWorkspaceId: string;
  domainId: string;
  outsiderDomainId: string;
  accounts: { id: string; email: string; password: string; role: string }[];
};

export function registerKnowledgeTests(
  fixture: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("2단계 원본과 게시 위키", () => {
    test.describe.configure({ mode: "serial" });
    let worker: ChildProcess | undefined;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const base = `/api/workspaces/${fixture.workspaceId}`;
    const root = `/w/${fixture.workspaceId}`;
    let sourceId = "";
    let sourceVersionId = "";
    let chunkId = "";
    let pageId = "";
    let publishedWikiId = "";
    let latestWikiId = "";
    const original = readFileSync(
      "docs/evaluation/sources/01-project-guide.md",
    );
    const upload = (
      client: APIRequestContext,
      name: string,
      bytes: Buffer,
      title = name,
      existing?: string,
      projectId = "",
    ) =>
      client.post(`${base}/sources${existing ? `/${existing}` : ""}`, {
        multipart: {
          title,
          domainId: fixture.domainId,
          projectId,
          category: "reference",
          file: {
            name,
            mimeType: name.endsWith(".pdf") ? "application/pdf" : "text/plain",
            buffer: bytes,
          },
        },
      });
    const sourceInfo = async (
      id = sourceId,
      version = sourceVersionId,
      client = clients.writer,
    ) => {
      const response = await client.get(
        `${base}/sources/${id}?version=${version}`,
      );
      expect(response.status()).toBe(200);
      return response.json();
    };
    const action = (
      kind: string,
      id: string,
      value: string,
      client = clients.reviewer,
      note = "",
    ) =>
      client.post(`${base}/${kind}-versions/${id}/action`, {
        data: { action: value, note },
      });
    const draft = (
      title: string,
      body: string,
      refs = [chunkId],
      parent = latestWikiId || null,
      published = publishedWikiId || null,
    ) => ({
      title,
      body,
      chunkIds: refs,
      domainId: fixture.domainId,
      projectId: null,
      parentVersionId: parent,
      basePublishedVersionId: published,
    });
    async function startWorker() {
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
        .poll(() => output, { timeout: 15_000 })
        .toContain("문서 처리 작업자가 준비되었습니다.");
    }
    async function stopWorker(force = false) {
      if (!worker || worker.exitCode !== null || worker.signalCode !== null)
        return;
      const stopped = new Promise<void>((resolve) =>
        worker?.once("exit", () => resolve()),
      );
      worker.kill(force ? "SIGKILL" : "SIGTERM");
      await stopped;
      worker = undefined;
    }
    async function waitForSource(
      id: string,
      version: string,
      state = "completed",
    ) {
      await expect
        .poll(async () => (await sourceInfo(id, version)).version.processing, {
          timeout: 30_000,
          intervals: [200, 300, 500],
        })
        .toBe(state);
    }
    test.beforeAll(async () => {
      const writer = fixture.accounts.find((item) => item.role === "writer");
      if (!writer) throw new Error("작성 직원 표본 없음");
      expect(
        (
          await clients.writer.post("/api/auth/sign-in/email", {
            data: { email: writer.email, password: writer.password },
          })
        ).status(),
      ).toBe(200);
    });
    test.afterAll(async () => {
      await stopWorker();
      await pool.end();
    });

    test("파일·버전·중복·비공개 권한과 영속 대기열을 확인한다", async () => {
      expect((await upload(clients.reader, "no.md", original)).status()).toBe(
        403,
      );
      expect(
        (await upload(clients.writer, "no.xlsx", Buffer.from("x"))).status(),
      ).toBe(400);
      expect(
        (await upload(clients.writer, "no.exe", Buffer.from("x"))).status(),
      ).toBe(415);
      expect(
        (
          await upload(clients.writer, "no.pdf", Buffer.from("not-pdf"))
        ).status(),
      ).toBe(400);
      const [one, two] = await Promise.all([
        upload(clients.writer, "sample.md", original),
        upload(clients.writer, "sample.md", original),
      ]);
      expect(one.status()).toBe(201);
      expect(two.status()).toBe(201);
      const first = await one.json();
      const second = await two.json();
      expect(first.sourceId).toBe(second.sourceId);
      expect(first.versionId).toBe(second.versionId);
      expect(first.duplicate).not.toBe(second.duplicate);
      sourceId = first.sourceId;
      sourceVersionId = first.versionId;
      expect((await sourceInfo()).version.processing).toBe("queued");
      const pending = await pool.query(
        "SELECT count(*)::int AS count FROM pgboss.job WHERE data->>'versionId'=$1",
        [sourceVersionId],
      );
      expect(pending.rows[0].count).toBe(1);
      expect(
        (await clients.reader.get(`${base}/sources/${sourceId}`)).status(),
      ).toBe(404);
      expect(
        (
          await clients.reader.get(
            `${base}/source-versions/${sourceVersionId}/file`,
          )
        ).status(),
      ).toBe(404);
      expect(
        (await clients.outsider.get(`${base}/sources/${sourceId}`)).status(),
      ).toBe(404);
      const file = await clients.writer.get(
        `${base}/source-versions/${sourceVersionId}/file`,
      );
      expect(await file.body()).toEqual(original);
      expect(file.headers()["cache-control"]).toContain("no-store");
      await startWorker();
      await waitForSource(sourceId, sourceVersionId);
      const details = await sourceInfo();
      expect(
        details.chunks.map((chunk: { text: string }) => chunk.text).join("\n"),
      ).toContain("최신 값으로 표시하면 안 된다");
      expect(details.chunks[0].locator.kind).toBe("lines");
      chunkId = details.chunks.find((chunk: { text: string }) =>
        chunk.text.includes("30초"),
      ).id;
      expect(JSON.stringify(details)).not.toContain("storageKey");
    });

    test("작업 취소·재시도와 처리 중 작업자 강제 종료 후 복구를 확인한다", async () => {
      test.setTimeout(60_000);
      await stopWorker();
      const created = await (
        await upload(
          clients.writer,
          "restart.md",
          Buffer.from(
            `# 재시작 시험\n${"가상 사업의 점검 결과를 확인한다.\n".repeat(800)}`,
          ),
        )
      ).json();
      expect(
        (
          await action("source", created.versionId, "cancel", clients.writer)
        ).status(),
      ).toBe(200);
      expect(
        (await sourceInfo(created.sourceId, created.versionId)).version
          .processing,
      ).toBe("canceled");
      expect(
        (
          await action("source", created.versionId, "retry", clients.writer)
        ).status(),
      ).toBe(200);
      // 빠른 환경에서도 완료 직전의 저장을 잠가 실제 작업자 중단을 재현한다.
      const blocker = await pool.connect();
      await blocker.query("BEGIN");
      try {
        await blocker.query("LOCK TABLE source_chunk IN SHARE MODE");
        await startWorker();
        await expect
          .poll(
            async () =>
              (
                await pool.query(
                  "SELECT processing FROM source_version WHERE id=$1",
                  [created.versionId],
                )
              ).rows[0].processing,
            { intervals: [10], timeout: 10_000 },
          )
          .toBe("processing");
        await stopWorker(true);
        expect(
          (
            await pool.query(
              "SELECT processing FROM source_version WHERE id=$1",
              [created.versionId],
            )
          ).rows[0].processing,
        ).toBe("processing");
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      await startWorker();
      await waitForSource(created.sourceId, created.versionId);
      const chunks = await pool.query(
        "SELECT count(*)::int AS total, count(DISTINCT ordinal)::int AS distinct_count FROM source_chunk WHERE version_id=$1",
        [created.versionId],
      );
      expect(chunks.rows[0].total).toBeGreaterThan(0);
      expect(chunks.rows[0].total).toBe(chunks.rows[0].distinct_count);
      expect(
        (
          await action("source", created.versionId, "retry", clients.writer)
        ).status(),
      ).toBe(409);
    });

    test("원본 공개는 검토 역할과 다른 작성자의 승인을 요구한다", async () => {
      expect(
        (
          await action("source", sourceVersionId, "approve", clients.writer)
        ).status(),
      ).toBe(403);
      expect(
        (
          await action("source", sourceVersionId, "approve", clients.reader)
        ).status(),
      ).toBe(404);
      const own = await (
        await upload(
          clients.reviewer,
          "self-review.md",
          Buffer.from("본인 승인 금지 표본"),
        )
      ).json();
      await expect
        .poll(
          async () =>
            (await sourceInfo(own.sourceId, own.versionId, clients.reviewer))
              .version.processing,
        )
        .toBe("completed");
      expect((await action("source", own.versionId, "approve")).status()).toBe(
        409,
      );
      expect(
        (
          await action("source", own.versionId, "approve", clients.admin)
        ).status(),
      ).toBe(200);
      expect(
        (
          await action(
            "source",
            sourceVersionId,
            "reject",
            clients.reviewer,
            "원문 확인 후 다시 요청해 주세요.",
          )
        ).status(),
      ).toBe(200);
      expect(
        (await action("source", sourceVersionId, "approve")).status(),
      ).toBe(409);
      expect(
        (
          await action("source", sourceVersionId, "submit", clients.writer)
        ).status(),
      ).toBe(200);
      expect(
        (await action("source", sourceVersionId, "approve")).status(),
      ).toBe(200);
      expect(
        (await sourceInfo(sourceId, sourceVersionId, clients.reader)).version
          .publication,
      ).toBe("published");
      const search = await (
        await clients.reader.get(
          `${base}/search?q=30초&domainId=${fixture.domainId}`,
        )
      ).json();
      expect(
        search.some(
          (item: { versionId: string }) => item.versionId === sourceVersionId,
        ),
      ).toBe(true);
      expect(
        (
          await clients.reader.get(
            `${base}/search?q=30초&domainId=${fixture.outsiderDomainId}`,
          )
        ).status(),
      ).toBe(404);
    });

    test("프로젝트 검색과 위키 근거에서 다른 프로젝트 자료를 제외한다", async () => {
      const projects: string[] = [];
      const versions: {
        sourceId: string;
        versionId: string;
        chunkId: string;
      }[] = [];
      for (const name of ["범위 시험 A", "범위 시험 B"]) {
        const project = await clients.admin.post(`${base}/projects`, {
          data: {
            domainId: fixture.domainId,
            name,
            clientName: "가상 발주처",
            description: "프로젝트 범위 시험",
          },
        });
        expect(project.status()).toBe(201);
        const id = (await project.json()).id;
        projects.push(id);
        const response = await upload(
          clients.writer,
          `${name}.md`,
          Buffer.from(`${name}: 프로젝트 구분 표본`),
          name,
          undefined,
          id,
        );
        expect(response.status()).toBe(201);
        const source = await response.json();
        await waitForSource(source.sourceId, source.versionId);
        expect(
          (await action("source", source.versionId, "approve")).status(),
        ).toBe(200);
        const details = await sourceInfo(source.sourceId, source.versionId);
        versions.push({ ...source, chunkId: details.chunks[0].id });
      }
      const selected = await (
        await clients.reader.get(
          `${base}/search?q=프로젝트 구분&domainId=${fixture.domainId}&projectId=${projects[0]}`,
        )
      ).json();
      expect(selected[0].id).toBe(versions[0].sourceId);
      expect(selected.map((item: { id: string }) => item.id)).not.toContain(
        versions[1].sourceId,
      );
      expect(
        selected.every(
          (item: { projectId: string | null }) =>
            item.projectId === null || item.projectId === projects[0],
        ),
      ).toBe(true);
      const common = await (
        await clients.reader.get(
          `${base}/search?q=30초&domainId=${fixture.domainId}&projectId=${projects[0]}`,
        )
      ).json();
      expect(common.some((item: { id: string }) => item.id === sourceId)).toBe(
        true,
      );
      const mismatched = await clients.writer.post(`${base}/wiki`, {
        data: {
          ...draft(
            "다른 프로젝트 근거",
            "범위가 다른 근거를 거부해야 한다.",
            [versions[0].chunkId],
            null,
            null,
          ),
          projectId: projects[1],
        },
      });
      expect(mismatched.status()).toBe(409);
      const matching = await clients.writer.post(`${base}/wiki`, {
        data: {
          ...draft(
            "프로젝트와 공통 근거",
            "동일 프로젝트와 공통 자료를 연결한다.",
            [versions[0].chunkId, chunkId],
            null,
            null,
          ),
          projectId: projects[0],
        },
      });
      expect(matching.status()).toBe(201);
    });

    test("위키 초안·근거·제출·게시의 권한과 버전 경계를 확인한다", async () => {
      const created = await clients.writer.post(`${base}/wiki`, {
        data: draft(
          "관제 화면 점검 위키",
          "# 점검 기준\n\n정상 통신 상태에서는 30초 간격으로 갱신합니다.",
        ),
      });
      expect(created.status()).toBe(201);
      const saved = await created.json();
      pageId = saved.pageId;
      latestWikiId = saved.versionId;
      expect(
        (await clients.reader.get(`${base}/wiki/${pageId}`)).status(),
      ).toBe(404);
      expect(
        (
          await clients.reader.get(
            `${base}/wiki/${pageId}?version=${latestWikiId}`,
          )
        ).status(),
      ).toBe(404);
      const before = await (
        await clients.reader.get(`${base}/search?q=점검&kind=wiki`)
      ).json();
      expect(before).toEqual([]);
      expect(
        (
          await clients.writer.post(`${base}/wiki`, {
            data: draft(
              "없는 근거",
              "본문",
              [fixture.outsiderDomainId],
              null,
              null,
            ),
          })
        ).status(),
      ).toBe(404);
      expect(
        (
          await action("wiki", latestWikiId, "approve", clients.writer)
        ).status(),
      ).toBe(403);
      expect(
        (await action("wiki", latestWikiId, "submit", clients.writer)).status(),
      ).toBe(200);
      const review = await (
        await clients.reviewer.get(`${base}/reviews`)
      ).json();
      expect(
        review.wikis.some(
          (item: { versionId: string }) => item.versionId === latestWikiId,
        ),
      ).toBe(true);
      expect((await action("wiki", latestWikiId, "approve")).status()).toBe(
        200,
      );
      publishedWikiId = latestWikiId;
      const published = await (
        await clients.reader.get(`${base}/wiki/${pageId}`)
      ).json();
      expect(published.version.id).toBe(publishedWikiId);
      expect(published.evidence[0].id).toBe(chunkId);
      expect(published.evidence[0].text).toContain("30초");
    });

    test("동시 변경·반려·재작성은 게시본과 저장된 본문을 덮어쓰지 않는다", async () => {
      const one = await clients.writer.post(`${base}/wiki/${pageId}`, {
        data: draft("먼저 승인할 변경", "정상 통신 30초. 변경안 A"),
      });
      const a = await one.json();
      expect(one.status()).toBe(201);
      const stale = await clients.writer.post(`${base}/wiki/${pageId}`, {
        data: draft("오래된 편집", "오래된 내용"),
      });
      expect(stale.status()).toBe(409);
      latestWikiId = a.versionId;
      const two = await clients.writer.post(`${base}/wiki/${pageId}`, {
        data: draft("나중에 검토할 변경", "정상 통신 30초. 변경안 B"),
      });
      const b = await two.json();
      expect(two.status()).toBe(201);
      latestWikiId = b.versionId;
      expect(
        (await action("wiki", a.versionId, "submit", clients.writer)).status(),
      ).toBe(200);
      expect(
        (await action("wiki", b.versionId, "submit", clients.writer)).status(),
      ).toBe(200);
      expect((await action("wiki", a.versionId, "approve")).status()).toBe(200);
      publishedWikiId = a.versionId;
      expect((await action("wiki", b.versionId, "approve")).status()).toBe(409);
      const current = await (
        await clients.reader.get(`${base}/wiki/${pageId}`)
      ).json();
      expect(current.version.body).toContain("변경안 A");
      expect(current.version.body).not.toContain("변경안 B");
      expect(
        (
          await clients.reader.get(
            `${base}/wiki/${pageId}?version=${b.versionId}`,
          )
        ).status(),
      ).toBe(404);
      expect(
        (
          await action(
            "wiki",
            b.versionId,
            "reject",
            clients.reviewer,
            "기준 게시본 변경 확인 필요",
          )
        ).status(),
      ).toBe(200);
      expect(
        (await action("wiki", b.versionId, "submit", clients.writer)).status(),
      ).toBe(409);
      const old = await (
        await clients.writer.get(
          `${base}/wiki/${pageId}?version=${b.versionId}`,
        )
      ).json();
      expect(old.version.body).toContain("변경안 B");
      expect(old.decisions[0].note).toContain("기준 게시본");
    });

    test("원본 개정·철회는 구버전 근거와 파생 위키의 조회·검색을 제한한다", async () => {
      const fresh = await (
        await upload(
          clients.writer,
          "sample.md",
          Buffer.from(
            "# 새 원본 버전\n정상 통신 상태의 갱신 간격은 45초이다.\n",
          ),
          "sample.md",
          sourceId,
        )
      ).json();
      await waitForSource(sourceId, fresh.versionId);
      expect(
        (
          await clients.reader.get(
            `${base}/sources/${sourceId}?version=${fresh.versionId}`,
          )
        ).status(),
      ).toBe(404);
      expect(
        (
          await clients.reader.get(
            `${base}/source-versions/${sourceVersionId}/file`,
          )
        ).status(),
      ).toBe(200);
      expect(
        (await action("source", fresh.versionId, "approve")).status(),
      ).toBe(200);
      expect(
        (
          await clients.reader.get(
            `${base}/source-versions/${sourceVersionId}/file`,
          )
        ).status(),
      ).toBe(404);
      expect(
        (await clients.reader.get(`${base}/wiki/${pageId}`)).status(),
      ).toBe(404);
      const hidden = await (
        await clients.reader.get(`${base}/search?q=30초&kind=all`)
      ).json();
      expect(hidden.some((item: { id: string }) => item.id === pageId)).toBe(
        false,
      );
      expect(
        hidden.some(
          (item: { versionId: string }) => item.versionId === sourceVersionId,
        ),
      ).toBe(false);
      const freshDetails = await sourceInfo(sourceId, fresh.versionId);
      chunkId = freshDetails.chunks[0].id;
      sourceVersionId = fresh.versionId;
      const corrected = await clients.writer.post(`${base}/wiki/${pageId}`, {
        data: draft("개정 기준 위키", "새 원본은 정상 통신 45초 기준이다."),
      });
      expect(corrected.status()).toBe(201);
      const saved = await corrected.json();
      latestWikiId = saved.versionId;
      expect(
        (await action("wiki", latestWikiId, "submit", clients.writer)).status(),
      ).toBe(200);
      expect((await action("wiki", latestWikiId, "approve")).status()).toBe(
        200,
      );
      publishedWikiId = latestWikiId;
      expect(
        (await clients.reader.get(`${base}/wiki/${pageId}`)).status(),
      ).toBe(200);
      expect(
        (
          await action(
            "source",
            sourceVersionId,
            "withdraw",
            clients.reviewer,
            "개발 철회 시험",
          )
        ).status(),
      ).toBe(200);
      expect(
        (await clients.reader.get(`${base}/wiki/${pageId}`)).status(),
      ).toBe(404);
      expect(
        (await clients.reader.get(`${base}/sources/${sourceId}`)).status(),
      ).toBe(404);
      const withdrawn = await (
        await clients.reader.get(`${base}/search?q=45초`)
      ).json();
      expect(
        withdrawn.some((item: { id: string }) =>
          [pageId, sourceId].includes(item.id),
        ),
      ).toBe(false);
    });

    test("텍스트 PDF는 페이지 근거를 남기고 손상·스캔·잘못된 인코딩은 실패한다", async () => {
      test.setTimeout(60_000);
      const pdf = await (
        await upload(
          clients.writer,
          "text-pages.pdf",
          readFileSync("docs/evaluation/stage-02/fixtures/text-pages.pdf"),
        )
      ).json();
      await waitForSource(pdf.sourceId, pdf.versionId);
      const parsed = await sourceInfo(pdf.sourceId, pdf.versionId);
      expect(
        parsed.chunks.map(
          (chunk: { locator: { page: number } }) => chunk.locator.page,
        ),
      ).toContain(2);
      expect(
        parsed.chunks.find((chunk: { text: string }) =>
          chunk.text.includes("60초"),
        ).locator.page,
      ).toBe(2);
      expect(parsed.version.warnings.length).toBeGreaterThan(0);
      for (const [name, bytes] of [
        [
          "broken.pdf",
          readFileSync("docs/evaluation/stage-02/fixtures/broken.pdf"),
        ],
        [
          "scan.pdf",
          readFileSync("docs/evaluation/stage-02/fixtures/scan-only.pdf"),
        ],
        ["encoding.txt", Buffer.from([0xff, 0xfe, 0xff])],
      ] as const) {
        const created = await (
          await upload(clients.writer, name, bytes)
        ).json();
        await waitForSource(created.sourceId, created.versionId, "failed");
        const failed = await sourceInfo(created.sourceId, created.versionId);
        expect(failed.chunks).toHaveLength(0);
        expect(failed.version.errorMessage).toBeTruthy();
        expect(failed.version.errorMessage).not.toContain(".local");
      }
    });

    test("브라우저에서 자료 등록→공개→위키 작성·게시→직원 원문 확인을 수행한다", async ({
      browser,
    }) => {
      test.setTimeout(60_000);
      const writerContext = await browser.newContext({
        storageState: await clients.writer.storageState(),
      });
      const reviewerContext = await browser.newContext({
        storageState: await clients.reviewer.storageState(),
      });
      const readerContext = await browser.newContext({
        storageState: await clients.reader.storageState(),
      });
      await readerContext.route("https://no-request.invalid/pixel", (route) =>
        route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
            "base64",
          ),
        }),
      );
      const writer = await writerContext.newPage();
      const reviewer = await reviewerContext.newPage();
      const reader = await readerContext.newPage();
      const errors: string[] = [];
      for (const page of [writer, reviewer, reader])
        page.on("pageerror", (error) => errors.push(error.message));
      try {
        await writer.goto(`http://localhost:3101${root}/sources`);
        await writer.getByText("새 자료 등록", { exact: true }).click();
        await writer.getByLabel("자료 제목").fill("브라우저 시연 원문");
        await writer.getByRole("combobox", { name: "자료 분류" }).click();
        await writer
          .getByRole("option", { name: "참고 자료", exact: true })
          .click();
        await writer.locator('input[type="file"]').setInputFiles({
          name: "browser.md",
          mimeType: "text/markdown",
          buffer: Buffer.from(
            "# 브라우저 시연\n가상 담당자는 승인된 지침을 먼저 확인한다.\n",
          ),
        });
        await writer
          .getByRole("button", { name: "자료 등록", exact: true })
          .click();
        await expect(writer).toHaveURL(/\/sources\/[0-9a-f-]+\?version=/);
        await expect(
          writer.getByText("처리 완료", { exact: true }),
        ).toBeVisible({ timeout: 20_000 });
        const sourceAddress = new URL(writer.url());
        const browserSource = await sourceInfo(
          sourceAddress.pathname.split("/").at(-1),
          sourceAddress.searchParams.get("version") ?? undefined,
        );
        expect(browserSource.source.category).toBe("reference");
        expect(browserSource.source.projectId).toBeNull();
        await reviewer.goto(writer.url());
        await reviewer.getByRole("button", { name: "자료 공개 승인" }).click();
        await expect(
          reviewer.getByText("공개", { exact: true }).first(),
        ).toBeVisible();
        await writer.goto(`http://localhost:3101${root}/wiki/new`);
        await writer.getByLabel("위키 제목").fill("브라우저 시연 위키");
        await writer
          .getByRole("button", { name: "마크다운", exact: true })
          .click();
        await writer
          .getByLabel("마크다운 본문")
          .fill(
            "# 업무 시작\n\n가상 담당자는 승인된 지침을 먼저 확인합니다.\n\n<script>window.wikiXss=1</script>\n![외부 이미지](https://no-request.invalid/pixel)",
          );
        const evidence = writer
          .locator(".evidence-option")
          .filter({ hasText: "브라우저 시연 원문" })
          .first();
        await evidence.getByRole("checkbox").check();
        await writer.getByRole("button", { name: "초안 저장" }).click();
        await expect(writer).toHaveURL(/\/wiki\/[0-9a-f-]+\?version=/);
        await writer.getByRole("button", { name: "검토 요청" }).click();
        await expect(
          writer.getByText("검토 대기 · 버전 1", { exact: true }),
        ).toBeVisible();
        await reviewer.goto(writer.url());
        await reviewer.getByRole("button", { name: "위키 게시 승인" }).click();
        await expect(
          reviewer.getByText("게시 · 버전 1", { exact: true }),
        ).toBeVisible();
        await reader.goto(writer.url());
        await expect(
          reader.getByRole("heading", { name: "브라우저 시연 위키" }),
        ).toBeVisible();
        const image = reader.locator(".wiki-markdown img");
        await expect(image).toHaveCount(1);
        await expect(image).toHaveAttribute(
          "src",
          "https://no-request.invalid/pixel",
        );
        await expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
        await expect
          .poll(() =>
            image.evaluate((img: HTMLImageElement) => img.naturalWidth),
          )
          .toBe(1);
        expect(await reader.evaluate(() => "wikiXss" in window)).toBe(false);
        await reader.screenshot({
          path: "test-results/02-published-wiki.png",
          fullPage: true,
        });
        await reader
          .getByRole("link", { name: /\[1\] 브라우저 시연 원문/ })
          .click();
        await expect(reader).toHaveURL(/#chunk-/);
        await expect(reader.locator(".source-passage:target")).toContainText(
          "승인된 지침을 먼저 확인한다",
        );
        await reader.setViewportSize({ width: 390, height: 844 });
        expect(
          await reader.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await reader.screenshot({
          path: "test-results/02-mobile-evidence.png",
          fullPage: true,
        });
        expect(errors).toEqual([]);
      } finally {
        await writerContext.close();
        await reviewerContext.close();
        await readerContext.close();
      }
    });
  });
}
