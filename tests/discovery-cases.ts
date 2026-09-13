import { type ChildProcess, fork, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { searchGroups } from "../src/lib/search-terms";
import type { ExtractionResult } from "../src/server/parsers/document";

type Fixture = {
  workspaceId: string;
  outsiderDomainId: string;
  accounts: { id: string; email: string; password: string; role: string }[];
};
export function registerDiscoveryTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("5단계 입문 탐색과 문서 품질", () => {
    test.describe.configure({ mode: "serial" });
    const base = `/api/workspaces/${f.workspaceId}`;
    const root = `/w/${f.workspaceId}`;
    let worker: ChildProcess;
    let domainId: string;
    let projectA: string;
    let projectB: string;
    let doc: { sourceId: string; versionId: string };
    let slide: { sourceId: string; versionId: string };
    let wiki: { pageId: string; versionId: string };
    let other: { sourceId: string; versionId: string };
    let common: { sourceId: string; versionId: string };
    let hidden: { sourceId: string; versionId: string };
    let chunkId: string;
    const terms = [
      {
        term: "지능형 교통체계",
        definition: "개발 표본의 교통 업무 개념",
        aliases: ["ITS", "스마트교통"],
      },
    ];
    const action = (resource: string, id: string, action: string) =>
      clients.reviewer.post(`${base}/${resource}/${id}/action`, {
        data: { action, note: "개발 표본 확인" },
      });
    const details = async (s: { sourceId: string; versionId: string }) =>
      (
        await clients.writer.get(
          `${base}/sources/${s.sourceId}?version=${s.versionId}`,
        )
      ).json();
    const wait = async (
      s: { sourceId: string; versionId: string },
      status = "completed",
    ) =>
      expect
        .poll(async () => (await details(s)).version.processing, {
          timeout: 30000,
        })
        .toBe(status);
    async function upload(
      filename: string,
      buffer: Buffer,
      title: string,
      projectId: string | null = null,
      publish = true,
    ) {
      const response = await clients.writer.post(`${base}/sources`, {
        multipart: {
          title,
          domainId,
          projectId: projectId ?? "",
          category: "reference",
          file: {
            name: filename,
            mimeType: "application/octet-stream",
            buffer,
          },
        },
      });
      expect(response.status()).toBe(201);
      const data = await response.json();
      await wait(data);
      if (publish)
        expect(
          (await action("source-versions", data.versionId, "approve")).status(),
        ).toBe(200);
      return data;
    }
    async function parse(
      file: string,
      mimeType: string,
    ): Promise<{ result?: ExtractionResult; error?: string }> {
      const child = fork("scripts/parse-child.ts", [], {
        execArgv: ["--import", "tsx", "--max-old-space-size=256"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("파서 시간 초과"));
        }, 12000);
        child.once("message", (message) => {
          clearTimeout(timeout);
          child.kill("SIGKILL");
          resolve(message as { result?: ExtractionResult; error?: string });
        });
        child.once("error", reject);
        child.send({ bytes: readFileSync(file).toString("base64"), mimeType });
      });
    }
    test.beforeAll(async () => {
      for (const a of f.accounts) {
        if (
          (await (await clients[a.role].get("/api/auth/get-session")).json())
            ?.user
        )
          continue;
        expect(
          (
            await clients[a.role].post("/api/auth/sign-in/email", {
              data: { email: a.email, password: a.password },
            })
          ).status(),
        ).toBe(200);
      }
      const d = await clients.admin.post(`${base}/domains`, {
        data: {
          name: `입문 탐색 ${randomUUID().slice(0, 6)}`,
          purpose: "실제 고객 지침이 아닌 통합시험 도메인",
          terms,
          recordTemplate: "상황\n판단\n결과",
        },
      });
      expect(d.status()).toBe(201);
      domainId = (await d.json()).id;
      const projects = [];
      for (const name of ["새봄시 관제", "겨울시 관제"]) {
        const p = await clients.admin.post(`${base}/projects`, {
          data: {
            domainId,
            name,
            clientName: name.split(" ")[0],
            description: "개발 시연 사업",
          },
        });
        expect(p.status()).toBe(201);
        projects.push((await p.json()).id);
      }
      [projectA, projectB] = projects;
      worker = spawn(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", "src/worker/index.ts"],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let ready = "";
      worker.stdout?.on("data", (c) => {
        ready += c;
      });
      worker.stderr?.on("data", () => {});
      await expect
        .poll(() => ready, { timeout: 15000 })
        .toContain("문서 처리 작업자가 준비되었습니다.");
    });
    test.afterAll(async () => {
      if (worker && worker.exitCode === null && worker.signalCode === null) {
        const stopped = new Promise<void>((r) =>
          worker.once("exit", () => r()),
        );
        worker.kill("SIGTERM");
        await stopped;
      }
    });
    test("등록한 동의어만 확장하고 한국어 조사·복합 용어·검색 조건을 보존한다", async () => {
      expect(searchGroups("ITS는 무엇인가요", terms, true)[0]).toEqual([
        "지능형 교통체계",
        "its",
        "스마트교통",
      ]);
      expect(searchGroups("지능형 교통체계 정상", terms)).toEqual([
        ["지능형 교통체계", "its", "스마트교통"],
        ["정상"],
      ]);
      expect(searchGroups("ＩＴＳ", terms)[0]).toContain("its");
      expect(searchGroups("관제 모니터링", terms)).toEqual([
        ["관제"],
        ["모니터링"],
      ]);
      expect(searchGroups("hits", terms)).toEqual([["hits"]]);
    });
    test("DOCX 원본의 부정문·단위·표 행을 보존하고 승인 뒤 위치로 연다", async () => {
      const bytes = readFileSync(
        "docs/evaluation/stage-02/fixtures/conditions-table.docx",
      );
      doc = await upload("조건표.docx", bytes, "관제 DOCX 조건표", projectA);
      const d = await details(doc);
      expect(d.version.mimeType).toContain("wordprocessingml");
      expect(
        d.chunks.some((c: { text: string }) =>
          c.text.includes("표시하면 안 된다"),
        ),
      ).toBe(true);
      const row = d.chunks.find((c: { text: string }) =>
        c.text.includes("2열(주기): 30초"),
      );
      expect(row.text).toContain("1열(사업): 새봄시");
      expect(row.text).not.toContain("10초");
      expect(row.locator).toMatchObject({ kind: "docx", table: 1, row: 2 });
      chunkId = row.id;
      const downloaded = await clients.reader.get(
        `${base}/source-versions/${doc.versionId}/file`,
      );
      expect(downloaded.status()).toBe(200);
      expect(
        createHash("sha256")
          .update(await downloaded.body())
          .digest("hex"),
      ).toBe(createHash("sha256").update(bytes).digest("hex"));
    });
    test("PPTX 슬라이드·도형 ID·좌표와 발표자 노트를 구분한다", async () => {
      slide = await upload(
        "화면설계.pptx",
        readFileSync(
          "docs/evaluation/stage-05/fixtures/screen-coordinates.pptx",
        ),
        "관제 화면설계 사례",
        projectA,
      );
      const d = await details(slide);
      const body = d.chunks.find((c: { text: string }) =>
        c.text.includes("최신 값으로 표시하면 안 된다"),
      );
      expect(body.locator).toMatchObject({
        kind: "pptx",
        slide: 1,
        section: "body",
        shapeId: "4",
        x: 914400,
        y: 1828800,
      });
      const note = d.chunks.find((c: { text: string }) =>
        c.text.includes("반영 완료가 아니라"),
      );
      expect(note.locator).toMatchObject({
        kind: "pptx",
        slide: 1,
        section: "notes",
      });
      const foreign = await clients.outsider.get(
        `${base}/sources/${slide.sourceId}`,
      );
      expect(foreign.status()).toBe(404);
    });
    test("잘못된 Office 형식·손상·스캔을 거부하고 PDF 표의 대응을 보완한다", async () => {
      expect(
        (
          await clients.writer.post(`${base}/sources`, {
            multipart: {
              title: "손상",
              domainId,
              projectId: "",
              category: "reference",
              file: {
                name: "bad.docx",
                mimeType: "application/octet-stream",
                buffer: Buffer.from("wrong"),
              },
            },
          })
        ).status(),
      ).toBe(400);
      const fake = await clients.writer.post(`${base}/sources`, {
        multipart: {
          title: "형식 불일치",
          domainId,
          projectId: "",
          category: "reference",
          file: {
            name: "renamed.pptx",
            mimeType: "application/octet-stream",
            buffer: readFileSync(
              "docs/evaluation/stage-02/fixtures/conditions-table.docx",
            ),
          },
        },
      });
      expect(fake.status()).toBe(201);
      const bad = await fake.json();
      await wait(bad, "failed");
      expect((await details(bad)).version.errorMessage).toContain("파일 형식");
      expect(
        (await action("source-versions", bad.versionId, "approve")).status(),
      ).toBe(409);
      const pdf = await parse(
        "docs/evaluation/stage-02/fixtures/columns-table.pdf",
        "application/pdf",
      );
      expect(pdf.error).toBeUndefined();
      const row = pdf.result?.chunks.find(
        (c) =>
          c.locator.kind === "pdf" &&
          c.locator.table &&
          c.text.includes("30초"),
      );
      expect(row?.text).toContain("새봄시");
      expect(row?.text).not.toContain("10초");
      expect(row?.locator).toMatchObject({
        kind: "pdf",
        page: 1,
        table: 1,
        row: 2,
      });
      const scan = await parse(
        "docs/evaluation/stage-02/fixtures/scan-only.pdf",
        "application/pdf",
      );
      expect(scan.error).toContain("OCR");
      writeFileSync(
        "docs/evaluation/stage-05/parser-check.json",
        `${JSON.stringify(
          { fixtureType: "개발 표본", pdf, scan: { error: scan.error } },
          null,
          2,
        )}\n`,
      );
    });
    test("입문 안내는 관리자만 저장하며 현재 공개 근거와 같은 도메인을 확인한다", async () => {
      const created = await clients.writer.post(`${base}/wiki`, {
        data: {
          title: "관제 업무 점검 절차",
          body: "개발 표본의 정상 통신은 30초 조건입니다.",
          domainId,
          projectId: projectA,
          parentVersionId: null,
          basePublishedVersionId: null,
          chunkIds: [chunkId],
        },
      });
      expect(created.status()).toBe(201);
      wiki = await created.json();
      const guide = {
        steps: [
          {
            title: "적용 조건 확인",
            description: "개발 표본의 사업과 통신 조건부터 확인합니다.",
            wikiId: wiki.pageId,
          },
        ],
        readingIds: [wiki.pageId],
      };
      expect(
        (
          await clients.reader.patch(`${base}/domain-guides/${domainId}`, {
            data: guide,
          })
        ).status(),
      ).toBe(403);
      expect(
        (
          await clients.admin.patch(`${base}/domain-guides/${domainId}`, {
            data: guide,
          })
        ).status(),
      ).toBe(409);
      expect(
        (
          await clients.writer.post(
            `${base}/wiki-versions/${wiki.versionId}/action`,
            { data: { action: "submit" } },
          )
        ).status(),
      ).toBe(200);
      expect(
        (await action("wiki-versions", wiki.versionId, "approve")).status(),
      ).toBe(200);
      expect(
        (
          await clients.admin.patch(`${base}/domain-guides/${domainId}`, {
            data: guide,
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await clients.admin.patch(
            `${base}/domain-guides/${f.outsiderDomainId}`,
            { data: guide },
          )
        ).status(),
      ).toBe(409);
      const d = await (
        await clients.reader.get(`${base}/domain-guides/${domainId}`)
      ).json();
      expect(d.reading[0].id).toBe(wiki.pageId);
      expect(d.steps[0].wiki.title).toBe("관제 업무 점검 절차");
    });
    test("프로젝트 탐색은 해당 사업과 공통 지식만 보이고 관련 추천은 비공개를 제외한다", async () => {
      other = await upload(
        "other.md",
        Buffer.from("다른 프로젝트의 관제 갱신은 10초입니다."),
        "관제 다른 사업 자료",
        projectB,
      );
      common = await upload(
        "common.md",
        Buffer.from(
          "지능형 교통체계 공통 안내. 개발 표본의 관제 점검과 업무 용어입니다.",
        ),
        "관제 도메인 공통 안내",
      );
      hidden = await upload(
        "hidden.md",
        Buffer.from("관제 비공개 검토 중"),
        "관제 미승인 원문",
        projectA,
        false,
      );
      const d = await (
        await clients.reader.get(`${base}/projects/${projectA}`)
      ).json();
      const ids = d.items.map((i: { id: string }) => i.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          doc.sourceId,
          slide.sourceId,
          common.sourceId,
          wiki.pageId,
        ]),
      );
      expect(ids).not.toContain(other.sourceId);
      expect(ids).not.toContain(hidden.sourceId);
      expect(
        d.items.find((i: { id: string }) => i.id === common.sourceId).projectId,
      ).toBeNull();
      const related = await (
        await clients.reader.get(`${base}/wiki-relations/${wiki.pageId}`)
      ).json();
      expect(related.suggestions.map((i: { id: string }) => i.id)).toEqual(
        expect.arrayContaining([slide.sourceId, common.sourceId]),
      );
      expect(JSON.stringify(related)).not.toContain(hidden.sourceId);
      expect(JSON.stringify(related)).not.toContain(other.sourceId);
      expect(JSON.stringify(related)).not.toContain(doc.sourceId);
      expect(related.questions.length).toBe(3);
    });
    test("약어·새 표현의 검색과 근거 부족·후속 질문의 계약을 검증한다", async () => {
      const results = [];
      for (const q of [
        "ITS",
        "지능형 교통체계",
        "스마트교통",
        "ITS 공통",
        "알수없는무근거문자열",
      ]) {
        const r = await (
          await clients.reader.get(
            `${base}/search?domainId=${domainId}&q=${encodeURIComponent(q)}`,
          )
        ).json();
        if (q === "알수없는무근거문자열") expect(r).toHaveLength(0);
        else
          expect(r.some((i: { id: string }) => i.id === common.sourceId)).toBe(
            true,
          );
        results.push({
          question: q,
          expectedMatch: q !== "알수없는무근거문자열",
          found: r.length,
        });
      }
      const c = await clients.reader.post(`${base}/conversations`, {
        data: { scope: { domainId } },
      });
      expect(c.status()).toBe(201);
      const id = (await c.json()).id;
      for (const prompt of [
        "ITS는 무엇인가요? 임베딩오류",
        "후속 공통 안내는? 임베딩오류",
      ]) {
        const r = await clients.reader.post(
          `${base}/conversations/${id}/stream`,
          { data: { requestId: randomUUID(), prompt } },
        );
        expect(r.status()).toBe(200);
        const events = (await r.text())
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => JSON.parse(l.slice(5)));
        const sources = events.find((e) => e.type === "sources");
        expect(sources.mode).toBe("keyword");
        expect(JSON.stringify(sources)).toContain(common.sourceId);
        expect(events.find((e) => e.type === "done").runs.at(-1).state).toBe(
          "completed",
        );
      }
      writeFileSync(
        "docs/evaluation/stage-05/search-check.json",
        `${JSON.stringify(
          {
            fixtureType: "개발 표본",
            model: "계약 시험용 고정 응답",
            results,
            semanticQuality: "실제 회사 모델 입력 대기",
          },
          null,
          2,
        )}\n`,
      );
    });
    test("390px 화면에서 입문 편집·홈·프로젝트·원문·위키 연결을 실제 조작한다", async ({
      page,
      browser,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page
        .context()
        .addCookies((await clients.reader.storageState()).cookies);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${root}?domain=${domainId}`);
      await expect(
        page.getByRole("heading", { name: "업무를 익히는 순서" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "위키 둘러보기" }),
      ).toBeVisible();
      const quick = page
        .locator(".quick-card")
        .filter({ hasText: "위키 둘러보기" });
      await expect(quick).toHaveAttribute(
        "href",
        `${root}/wiki?domainId=${domainId}&q=`,
      );
      await page.screenshot({
        path: "docs/stages/05-discovery/screenshots/mobile-home.png",
        fullPage: true,
      });
      await page
        .getByRole("link", { name: "새봄시 관제 →", exact: true })
        .click();
      await expect(page).toHaveURL(`${root}/projects/${projectA}`);
      await expect(
        page.getByRole("heading", { name: "관제 다른 사업 자료" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "관제 도메인 공통 안내" }),
      ).toBeVisible();
      await page.goto(`${root}/wiki/${wiki.pageId}`);
      await expect(
        page.getByRole("heading", { name: "지식 연결 보기" }),
      ).toBeVisible();
      await expect(
        page.getByText("자동으로 찾은 관련 자료", { exact: false }),
      ).toBeVisible();
      await page.screenshot({
        path: "docs/stages/05-discovery/screenshots/mobile-relations.png",
        fullPage: true,
      });
      await page.goto(`${root}/sources/${slide.sourceId}`);
      await expect(page.getByText(/슬라이드 1 · 본문 · 도형 4/)).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const ctx = await browser.newContext({
        storageState: await clients.admin.storageState(),
        viewport: { width: 390, height: 844 },
      });
      const admin = await ctx.newPage();
      admin.on("pageerror", (e) => errors.push(e.message));
      await admin.goto(`${root}/admin`);
      const domainDetail = admin
        .locator("#domains > details")
        .filter({ hasText: "입문 탐색" })
        .first();
      await domainDetail.locator(":scope > summary").click();
      await domainDetail
        .getByText("입문 순서·추천 읽기 편집", { exact: true })
        .click();
      await domainDetail
        .getByLabel("할 일", { exact: true })
        .fill("적용 조건과 최신 개정 확인");
      await domainDetail
        .getByRole("button", { name: "입문 안내 저장", exact: true })
        .click();
      await expect(
        domainDetail.getByText("입문 안내를 저장했습니다."),
      ).toBeVisible();
      expect(
        await admin.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await ctx.close();
      await page.goto(`${root}?domain=${domainId}`);
      await expect(
        page.getByRole("heading", { name: "적용 조건과 최신 개정 확인" }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
    test("원문 철회 즉시 입문 추천·관계·프로젝트에서 파생 위키를 제외한다", async ({
      page,
    }) => {
      expect(
        (await action("source-versions", doc.versionId, "withdraw")).status(),
      ).toBe(200);
      const guide = await (
        await clients.reader.get(`${base}/domain-guides/${domainId}`)
      ).json();
      expect(guide.reading).toHaveLength(0);
      expect(guide.steps[0].wiki).toBeNull();
      expect(
        (
          await clients.reader.get(`${base}/wiki-relations/${wiki.pageId}`)
        ).status(),
      ).toBe(404);
      const d = await (
        await clients.reader.get(`${base}/projects/${projectA}`)
      ).json();
      expect(d.items.map((i: { id: string }) => i.id)).not.toContain(
        wiki.pageId,
      );
      await page
        .context()
        .addCookies((await clients.reader.storageState()).cookies);
      await page.goto(`${root}/chat?domainId=not-a-uuid`);
      await expect(
        page.getByRole("heading", {
          name: "접근 가능한 페이지를 확인해 주세요",
        }),
      ).toBeVisible();
    });
  });
}
