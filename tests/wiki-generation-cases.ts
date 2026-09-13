import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";
import {
  generationAnalysisSchema,
  groupWikiPlans,
  type WikiPagePlan,
} from "../src/lib/wiki-generation";
import {
  markdownReferences,
  wikiLinksFromMarkdown,
} from "../src/lib/wiki-links";
import type { aiTaskDetails } from "../src/server/services/ai-tasks";
import type { batchDetails } from "../src/server/services/proposals";

type Fixture = {
  workspaceId: string;
  domainId: string;
  accounts: { id: string; role: string }[];
};
type Task = Awaited<ReturnType<typeof aiTaskDetails>>;
type Batch = Awaited<ReturnType<typeof batchDetails>>;
export function registerWikiGenerationTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("11단계 분석 기반 위키 생성", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const base = `/api/workspaces/${f.workspaceId}`,
      root = `/w/${f.workspaceId}`;
    const writer = f.accounts.find((a) => a.role === "writer");
    if (!writer) throw new Error("작성 계정 없음");
    let worker: ChildProcess | undefined,
      output = "";
    async function start() {
      worker = spawn(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", "src/worker/index.ts"],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      output = "";
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
    async function stop() {
      if (!worker || worker.exitCode !== null || worker.signalCode !== null)
        return;
      const exit = new Promise<void>((resolve) =>
        worker?.once("exit", () => resolve()),
      );
      worker.kill("SIGTERM");
      await exit;
      worker = undefined;
    }
    async function seed(
      title: string,
      projectId?: string | null,
      texts = [
        "관제 화면은 30초마다 갱신합니다. 일반 화면에는 적용하지 않습니다.",
        "비상 전원은 8시간 동안 유지해야 합니다.",
      ],
    ) {
      const p = projectId === undefined ? randomUUID() : projectId;
      if (projectId === undefined)
        await pool.query(
          "INSERT INTO project(id,workspace_id,domain_id,name,client_name) VALUES($1,$2,$3,$4,'개발 표본')",
          [p, f.workspaceId, f.domainId, title],
        );
      const source = randomUUID(),
        version = randomUUID(),
        chunks: string[] = [];
      await pool.query(
        "INSERT INTO source(id,workspace_id,domain_id,project_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,$5,'guideline',$6,$7,$7,1)",
        [source, f.workspaceId, f.domainId, p, title, writer?.id, version],
      );
      await pool.query(
        "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'generate.md','text/markdown',$4,$4,500,$5,'published','completed')",
        [version, f.workspaceId, source, randomUUID(), writer?.id],
      );
      for (const [i, text] of texts.entries()) {
        const id = randomUUID();
        chunks.push(id);
        await pool.query(
          "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id,
            f.workspaceId,
            version,
            i,
            text,
            { kind: "lines", startLine: i + 1, endLine: i + 1 },
          ],
        );
      }
      return { source, version, chunks, projectId: p, title };
    }
    async function info(id: string): Promise<Task> {
      const r = await clients.writer.get(`${base}/ai-tasks/${id}`);
      expect(r.status()).toBe(200);
      return r.json();
    }
    async function wait(id: string, state = "completed") {
      await expect
        .poll(async () => (await info(id)).state, {
          timeout: 25000,
          intervals: [200, 400, 800],
        })
        .toMatch(/^(completed|failed|canceled)$/);
      const task = await info(id);
      expect(task.state, task.errorMessage ?? "작업 완료").toBe(state);
      return task;
    }
    async function analysis(sourceId: string) {
      const r = await clients.writer.post(`${base}/ai-tasks`, {
        data: { sourceId, kind: "analysis", requestId: randomUUID() },
      });
      expect(r.status()).toBe(201);
      return wait((await r.json()).id);
    }
    async function generate(sourceId: string, analysisTaskId: string) {
      const r = await clients.writer.post(`${base}/ai-tasks`, {
        data: {
          sourceId,
          analysisTaskId,
          kind: "wiki-generation",
          requestId: randomUUID(),
        },
      });
      expect(r.status(), await r.text()).toBe(201);
      return (await r.json()).id as string;
    }
    async function batch(id: string): Promise<Batch> {
      const r = await clients.writer.get(`${base}/proposals/${id}`);
      expect(r.status()).toBe(200);
      return r.json();
    }
    const action = (id: string, action: string, role = "writer") =>
      clients[role].post(`${base}/proposals/${id}/action`, {
        data: { action, note: action === "reject" ? "조건 확인 필요" : "" },
      });
    const revision = (b: Batch["batch"], items = b.items) => ({
      title: b.title,
      domainId: b.domainId,
      projectId: b.projectId,
      predecessorId: b.id,
      items,
    });
    async function wiki(
      s: Awaited<ReturnType<typeof seed>>,
      title = "생성대상 관제",
      body = "기존 조건은 관제 화면의 현장 확인을 포함합니다.",
    ) {
      const r = await clients.writer.post(`${base}/wiki`, {
        data: {
          domainId: f.domainId,
          projectId: s.projectId,
          title,
          body,
          parentVersionId: null,
          basePublishedVersionId: null,
          chunkIds: s.chunks,
        },
      });
      expect(r.status()).toBe(201);
      const data = await r.json();
      expect(
        (
          await clients.writer.post(
            `${base}/wiki-versions/${data.versionId}/action`,
            { data: { action: "submit" } },
          )
        ).status(),
      ).toBe(200);
      expect(
        (
          await clients.reviewer.post(
            `${base}/wiki-versions/${data.versionId}/action`,
            { data: { action: "approve" } },
          )
        ).status(),
      ).toBe(200);
      return data as { pageId: string; versionId: string };
    }
    test.beforeAll(start);
    test.afterAll(async () => {
      await stop();
      await pool.query(
        "UPDATE membership SET is_active=true WHERE workspace_id=$1 AND user_id=$2",
        [f.workspaceId, writer.id],
      );
      await pool.end();
    });

    test("마크다운 관계는 코드·이미지를 제외하고 참조 링크를 읽으며 순환 묶음을 분리한다", () => {
      const ids = Array.from({ length: 7 }, () => randomUUID());
      expect(
        wikiLinksFromMarkdown(
          `[정상](${root}/wiki/${ids[0]}#조건)\n[참조][조건]\n\n[조건]: ${root}/wiki/${ids[1]}\n\n\`[코드](${root}/wiki/${ids[2]})\`\n\n\`\`\`md\n[예시](${root}/wiki/${ids[3]})\n\`\`\`\n\n![그림](${root}/wiki/${ids[4]})\n[타공간](/w/${randomUUID()}/wiki/${ids[5]})`,
          f.workspaceId,
        ),
      ).toEqual(ids.slice(0, 2));
      expect(
        markdownReferences("`[[코드]]`\n\n[[연결]]").hasUnresolvedWikiLinks,
      ).toBe(true);
      const cycle = [
        { key: "page-1", links: [{ key: "page-2" }] },
        { key: "page-2", links: [{ key: "page-1" }] },
      ];
      expect(
        groupWikiPlans(cycle as Pick<WikiPagePlan, "key" | "links">[]),
      ).toEqual([
        { ordinal: 1, pageKeys: ["page-1", "page-2"], dependencies: [] },
      ]);
      const big = Array.from({ length: 6 }, (_, i) => ({
        key: `page-${i + 1}`,
        links: [{ key: `page-${((i + 1) % 6) + 1}`, reason: "연결" }],
      }));
      expect(groupWikiPlans(big)).toEqual([
        { ordinal: 1, pageKeys: big.map((p) => p.key), dependencies: [] },
      ]);
    });
    let first: Task;
    let sample: Awaited<ReturnType<typeof seed>>;
    test("완료 분석에서 여섯 페이지를 두 묶음으로 만들고 모바일에서 모든 범위를 대조한다", async ({
      page,
    }) => {
      sample = await seed("생성여섯 관제 운영");
      const analyzed = await analysis(sample.source);
      await page
        .context()
        .addCookies((await clients.writer.storageState()).cookies);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${root}/ai-tasks/${analyzed.id}`);
      await page
        .getByRole("button", { name: "분석으로 위키 생성", exact: true })
        .click();
      await expect(page).toHaveURL(/ai-tasks\/[0-9a-f-]+$/);
      await expect(
        page.getByRole("heading", { name: "분석 기반 위키 생성", exact: true }),
      ).toBeVisible();
      const id = page.url().split("/").at(-1) as string;
      first = await wait(id);
      expect(first.groups).toHaveLength(2);
      expect(first.groups.map((g) => g.pages.length)).toEqual([5, 1]);
      expect(first.groups[1].dependencies).toEqual([1]);
      expect(first.usage).toHaveLength(7);
      const pages = first.groups.flatMap((g) => g.pages.map((p) => p.id));
      expect(new Set(pages).size).toBe(6);
      expect(
        (
          await pool.query(
            "SELECT id FROM wiki_page WHERE id=ANY($1::uuid[])",
            [pages],
          )
        ).rows,
      ).toHaveLength(0);
      await page.reload();
      await expect(
        page.getByText("본문 작성 6/6개 완료", { exact: false }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.goto(`${root}/proposals/${first.groups[1].id}`);
      await expect(page.getByText("1번 · 초안", { exact: true })).toBeVisible();
      const b = await batch(first.groups[1].id);
      expect(b.batch.items[0].claimIds?.length).toBe(
        generationAnalysisSchema.parse(analyzed.result).claims.length,
      );
      const link = page.locator(".wiki-markdown a").first();
      expect(await link.getAttribute("href")).toContain(
        `/proposals/${first.groups[0].id}#page-`,
      );
      await page.screenshot({
        path: "test-results/11-generation-review-mobile.png",
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        (await clients.reader.get(`${base}/ai-tasks/${id}`)).status(),
      ).toBe(403);
      expect(
        (await clients.outsider.get(`${base}/ai-tasks/${id}`)).status(),
      ).toBe(404);
    });
    test("의존 묶음이 승인되기 전에는 게시하지 않고 수정 묶음의 페이지 주소를 유지한다", async () => {
      const [one, two] = first.groups;
      expect((await action(two.id, "submit")).status()).toBe(200);
      const blocked = await action(two.id, "approve", "reviewer");
      expect(blocked.status()).toBe(409);
      expect((await blocked.json()).error).toContain("1번 묶음");
      expect((await action(one.id, "submit")).status()).toBe(200);
      const original = (await batch(one.id)).batch;
      const cycle = structuredClone(original.items);
      cycle[0].body += `\n\n[문서 요약](${root}/wiki/${two.pages[0].id})`;
      expect(
        (
          await clients.writer.post(`${base}/proposals`, {
            data: revision(original, cycle),
          })
        ).status(),
      ).toBe(409);
      const invalidLink = structuredClone(original.items);
      invalidLink[0].body += `\n\n[알 수 없는 위키](${root}/wiki/${randomUUID()})`;
      expect(
        (
          await clients.writer.post(`${base}/proposals`, {
            data: revision(original, invalidLink),
          })
        ).status(),
      ).toBe(409);
      const changed = structuredClone(original.items);
      changed[0].title += " 확인";
      const saved = await clients.writer.post(`${base}/proposals`, {
        data: revision(original, changed),
      });
      expect(saved.status(), await saved.text()).toBe(201);
      const newer = (await saved.json()).id;
      const revised = await batch(newer);
      expect(revised.batch.groupRevision).toBe(2);
      expect(revised.batch.items.map((i) => i.plannedPageId)).toEqual(
        original.items.map((i) => i.plannedPageId),
      );
      expect((await batch(one.id)).isLatest).toBe(false);
      expect((await action(one.id, "approve", "reviewer")).status()).toBe(409);
      const queue = await clients.reviewer.get(`${base}/reviews`);
      expect((await queue.text()).includes(one.id)).toBe(false);
      const list = await (await clients.writer.get(`${base}/proposals`)).json();
      expect(list.some((b: { id: string }) => b.id === one.id)).toBe(false);
      expect((await action(newer, "submit")).status()).toBe(200);
      expect((await action(newer, "approve", "reviewer")).status()).toBe(200);
      expect((await action(two.id, "approve", "reviewer")).status()).toBe(200);
      const done = await info(first.id);
      expect(done.groups.map((g) => g.state)).toEqual(["approved", "approved"]);
      for (const g of done.groups) {
        expect(g.results.map((r) => r.pageId)).toEqual(
          g.pages.map((p) => p.id),
        );
      }
      const published = (await batch(two.id)).batch.results[0];
      const detail = await (
        await clients.reader.get(`${base}/wiki/${published.pageId}`)
      ).json();
      expect(detail.version.metadata.type).toBe("source");
      expect(detail.version.metadata.links).toHaveLength(5);
      expect(
        (
          await clients.writer.post(`${base}/proposals`, {
            data: revision(revised.batch),
          })
        ).status(),
      ).toBe(409);
    });
    test("단락 생성이 실패하면 부분 결과를 보존하고 재시도에서 완료 호출을 재사용한다", async ({
      page,
    }) => {
      const s = await seed("생성부분실패 관제");
      const a = await analysis(s.source),
        id = await generate(s.source, a.id),
        failed = await wait(id, "failed");
      expect(failed.groups).toHaveLength(0);
      expect(failed.result).toBeNull();
      const steps = failed.steps.filter((s) => s.kind === "generate-wiki");
      expect(steps[0].state).toBe("completed");
      expect(steps[1].state).toBe("failed");
      await page
        .context()
        .addCookies((await clients.writer.storageState()).cookies);
      await page.goto(`${root}/ai-tasks/${id}`);
      await expect(
        page.getByRole("heading", { name: "완료한 페이지의 추가 단락" }),
      ).toBeVisible();
      const retried = page.waitForResponse(
        (r) =>
          r.request().method() === "PATCH" &&
          r.url().endsWith(`/ai-tasks/${id}`),
      );
      await page
        .getByRole("button", { name: "완료한 단계부터 재시도", exact: true })
        .click();
      expect((await retried).status()).toBe(200);
      const done = await wait(id);
      expect(done.steps.find((s) => s.kind === "plan-wiki")?.attempts).toBe(1);
      expect(
        done.steps
          .filter((s) => s.kind === "generate-wiki")
          .map((s) => s.attempts),
      ).toEqual([1, 2, 1, 1, 1, 1]);
      expect(done.usage).toHaveLength(8);
      expect(done.groups).toHaveLength(2);
    });
    test("여섯 페이지의 순환 참조를 한 묶음으로 생성하고 모두 함께 게시한다", async () => {
      const s = await seed("생성큰순환"),
        a = await analysis(s.source);
      const generated = await wait(await generate(s.source, a.id));
      expect(generated.groups).toHaveLength(1);
      const group = await batch(generated.groups[0].id);
      expect(group.batch.items).toHaveLength(6);
      expect((await action(group.batch.id, "submit")).status()).toBe(200);
      expect(
        (await action(group.batch.id, "approve", "reviewer")).status(),
      ).toBe(200);
      const pages = await pool.query(
        "SELECT id,published_version_id FROM wiki_page WHERE id=ANY($1::uuid[])",
        [group.batch.items.map((i) => i.plannedPageId)],
      );
      expect(pages.rows).toHaveLength(6);
      expect(pages.rows.every((p) => p.published_version_id)).toBe(true);
    });
    for (const [title, message] of [
      ["생성유형혼동", "구조화 분석"],
      ["생성허위ID", "분석 근거"],
      ["생성범위누락", "전체 분석"],
      ["생성다른범위", "같은 범위"],
      ["생성수치변조", "수치"],
      ["생성링크변조", "링크"],
    ])
      test(`${title}: 잘못된 계획·본문은 검토 묶음으로 저장하지 않는다`, async () => {
        if (title === "생성다른범위") {
          const common = await seed("생성 대조용 관제 공통", null);
          await wiki(common, "관제 공통 생성 기준");
        }
        const s = await seed(title),
          a = await analysis(s.source),
          failed = await wait(await generate(s.source, a.id), "failed");
        expect(failed.errorMessage).toContain(message);
        expect(failed.groups).toHaveLength(0);
        expect(failed.result).toBeNull();
        expect(failed.usage.length).toBeGreaterThan(0);
      });
    test("같은 묶음의 새 페이지는 서로 연결한 채 한 번에 게시한다", async () => {
      const s = await seed("생성순환 관제"),
        a = await analysis(s.source),
        done = await wait(await generate(s.source, a.id));
      expect(done.groups).toHaveLength(1);
      const g = done.groups[0];
      expect((await action(g.id, "submit")).status()).toBe(200);
      const approvals = await Promise.all([
        action(g.id, "approve", "reviewer"),
        action(g.id, "approve", "admin"),
      ]);
      expect(approvals.map((r) => r.status()).sort()).toEqual([200, 409]);
      const rows = await pool.query(
        "SELECT p.id,v.metadata FROM wiki_page p JOIN wiki_version v ON v.id=p.published_version_id WHERE p.id=ANY($1::uuid[])",
        [g.pages.map((p) => p.id)],
      );
      expect(rows.rows).toHaveLength(2);
      for (const row of rows.rows)
        expect(row.metadata.links[0].pageId).toBe(
          g.pages.find((p) => p.id !== row.id)?.id,
        );
    });
    test("여러 원문의 기존 위키 본문·근거를 병합하고 다른 프로젝트 후보는 제외한다", async () => {
      const s = await seed("생성보완 관제"),
        target = await wiki(s);
      // Upstream replaces pages owned only by the re-ingested source. Exercise
      // its distinct multi-source merge branch with a second real contributor.
      const contributor = await seed("기존 현장 확인 자료", s.projectId, [
        "기존 조건은 관제 화면의 현장 확인을 포함합니다.",
      ]);
      await pool.query(
        "INSERT INTO wiki_evidence(workspace_id,version_id,chunk_id) VALUES($1,$2,$3)",
        [f.workspaceId, target.versionId, contributor.chunks[0]],
      );
      const other = await seed("같은 단어의 비공개범위 관제");
      const hidden = await wiki(other, "생성대상 다른 프로젝트");
      const common = await seed("관제 공통 원문", null);
      const shared = await wiki(common, "관제 공통 기준");
      const a = await analysis(s.source),
        done = await wait(await generate(s.source, a.id));
      const knowledge = done.steps.find((s) => s.kind === "generation-prepare")
        ?.result?.knowledge as {
        candidates: { pageId: string; body: string }[];
        relatedSources: { sourceId: string }[];
      };
      expect(knowledge.candidates.some((c) => c.pageId === target.pageId)).toBe(
        true,
      );
      expect(knowledge.candidates.some((c) => c.pageId === shared.pageId)).toBe(
        true,
      );
      expect(knowledge.candidates.some((c) => c.pageId === hidden.pageId)).toBe(
        false,
      );
      expect(
        knowledge.relatedSources.some((c) => c.sourceId === other.source),
      ).toBe(false);
      const b = await batch(done.groups[0].id),
        item = b.batch.items.find((i) => i.pageId === target.pageId);
      expect(item?.body).toContain(
        "기존 조건은 관제 화면의 현장 확인을 포함합니다.",
      );
      expect(item?.chunkIds).toEqual(expect.arrayContaining(s.chunks));
      expect((await action(b.batch.id, "submit")).status()).toBe(200);
      expect((await action(b.batch.id, "approve", "reviewer")).status()).toBe(
        200,
      );
      expect((await info(done.id)).current).toBe(true);
      expect((await batch(b.batch.id)).available).toBe(true);
      const detail = await (
        await clients.writer.get(`${base}/wiki/${target.pageId}`)
      ).json();
      const saved = await clients.writer.post(`${base}/wiki/${target.pageId}`, {
        data: {
          domainId: f.domainId,
          projectId: s.projectId,
          title: detail.version.title,
          body: `${detail.version.body}\n\n직원 검토 메모`,
          parentVersionId: detail.page.latestVersionId,
          basePublishedVersionId: detail.page.publishedVersionId,
          chunkIds: s.chunks,
        },
      });
      expect(saved.status(), await saved.text()).toBe(201);
      const edit = await (
        await clients.writer.get(`${base}/wiki/${target.pageId}`)
      ).json();
      expect(edit.version.metadata).toEqual(detail.version.metadata);
    });
    test("기존 위키를 병합한 뒤에도 완료 작업의 근거와 검토 결과를 열 수 있다", async () => {
      const s = await seed("생성병합 관제"),
        target = await wiki(s),
        merged = await wiki(
          s,
          "병합대상 관제",
          "별도로 기록했던 현장 확인 조건입니다.",
        );
      const a = await analysis(s.source),
        done = await wait(await generate(s.source, a.id)),
        b = await batch(done.groups[0].id);
      const item = b.batch.items.find((i) => i.pageId === target.pageId);
      expect(item?.kind).toBe("merge");
      expect(item?.body).toContain("별도로 기록했던 현장 확인 조건입니다.");
      expect((await action(b.batch.id, "submit")).status()).toBe(200);
      const approved = await action(b.batch.id, "approve", "reviewer");
      expect(approved.status(), await approved.text()).toBe(200);
      expect(
        (
          await pool.query(
            "SELECT published_version_id FROM wiki_page WHERE id=$1",
            [merged.pageId],
          )
        ).rows[0].published_version_id,
      ).toBeNull();
      expect((await info(done.id)).current).toBe(true);
      expect((await batch(b.batch.id)).available).toBe(true);
    });
    test("모순 확인은 명시적인 수정 확인 후 재제출하며 자동 생성 필드를 임의로 추가할 수 없다", async ({
      page,
    }) => {
      const s = await seed("생성모순 관제"),
        a = await analysis(s.source),
        done = await wait(await generate(s.source, a.id)),
        b = (await batch(done.groups[0].id)).batch;
      expect((await action(b.id, "submit")).status()).toBe(200);
      expect((await action(b.id, "approve", "reviewer")).status()).toBe(409);
      const tampered = structuredClone(b.items);
      for (const item of tampered) delete item.requiresResolution;
      expect(
        (
          await clients.writer.post(`${base}/proposals`, {
            data: revision(b, tampered),
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await clients.writer.post(`${base}/proposals`, {
            data: { ...revision(b), predecessorId: null },
          })
        ).status(),
      ).toBe(400);
      const changed = structuredClone(b.items);
      changed[0].plannedPageId = randomUUID();
      expect(
        (
          await clients.writer.post(`${base}/proposals`, {
            data: revision(b, changed),
          })
        ).status(),
      ).toBe(409);
      await page
        .context()
        .addCookies((await clients.writer.storageState()).cookies);
      await page.goto(`${root}/proposals/${b.id}`);
      await page.locator("#batch-revise > summary").click();
      await expect(
        page.getByRole("button", {
          name: "변경안 추가",
          exact: true,
        }),
      ).toBeDisabled();
      const checks = page.getByRole("checkbox", {
        name: "모순·적용 조건을 확인하고 본문 수정을 마쳤습니다",
      });
      expect(await checks.count()).toBe(2);
      for (let i = 0; i < 2; i++) await checks.nth(i).check();
      await page
        .getByRole("button", { name: "수정한 새 변경 묶음 저장", exact: true })
        .click();
      await expect(page).not.toHaveURL(new RegExp(b.id));
      const id = page.url().split("/").at(-1) as string;
      expect((await action(id, "submit")).status()).toBe(200);
      expect((await action(id, "approve", "reviewer")).status()).toBe(200);
    });
    test("대상 개정이나 대조 원문 철회가 있으면 전체 묶음의 게시를 막고 결과를 숨긴다", async () => {
      const s = await seed("생성보완 개정 관제"),
        target = await wiki(s),
        a = await analysis(s.source),
        done = await wait(await generate(s.source, a.id)),
        b = await batch(done.groups[0].id);
      expect((await action(b.batch.id, "submit")).status()).toBe(200);
      const edit = await clients.writer.post(`${base}/wiki/${target.pageId}`, {
        data: {
          domainId: f.domainId,
          projectId: s.projectId,
          title: "먼저 수정한 위키",
          body: "직원이 먼저 수정했습니다.",
          parentVersionId: target.versionId,
          basePublishedVersionId: target.versionId,
          chunkIds: s.chunks,
        },
      });
      expect(edit.status()).toBe(201);
      expect((await action(b.batch.id, "approve", "reviewer")).status()).toBe(
        409,
      );
      expect(
        (
          await pool.query(
            "SELECT id FROM wiki_page WHERE id=ANY($1::uuid[])",
            [
              b.batch.items
                .filter((i) => !i.pageId)
                .map((i) => i.plannedPageId),
            ],
          )
        ).rows,
      ).toHaveLength(0);
      await pool.query(
        "UPDATE source SET published_version_id=NULL WHERE id=$1",
        [s.source],
      );
      const hidden = await info(done.id);
      expect(hidden.current).toBe(false);
      expect(hidden.result).toBeNull();
      expect(
        hidden.steps.every((s) => s.input === null && s.result === null),
      ).toBe(true);
      const closed = await batch(b.batch.id);
      expect(closed.available).toBe(false);
      expect(closed.batch.items).toHaveLength(0);
      expect(closed.evidence).toHaveLength(0);
    });
    test("전체 분석·입력 예산을 확인하고 완료되지 않은 근거로 생성하지 않는다", async () => {
      const s = await seed("생성 입력 한도 관제"),
        a = await analysis(s.source);
      const input = {
        sourceId: s.source,
        kind: "wiki-generation",
        analysisTaskId: a.id,
        requestId: randomUUID(),
      };
      const partial = structuredClone(a.result) as Record<string, unknown>;
      const coverage = partial.coverage as { processedParts: number };
      coverage.processedParts -= 1;
      await pool.query("UPDATE ai_task SET result=$2 WHERE id=$1", [
        a.id,
        partial,
      ]);
      expect(
        (
          await clients.writer.post(`${base}/ai-tasks`, { data: input })
        ).status(),
      ).toBe(409);
      const oversized = structuredClone(a.result) as {
        summaries: { text: string }[];
      };
      oversized.summaries[0].text = "전체 분석 맥락 ".repeat(9000);
      await pool.query("UPDATE ai_task SET result=$2 WHERE id=$1", [
        a.id,
        oversized,
      ]);
      const failed = await wait(await generate(s.source, a.id), "failed");
      expect(failed.errorMessage).toContain("입력 공간");
      expect(failed.usage).toHaveLength(0);
      expect(failed.groups).toHaveLength(0);
    });
    test("수정 묶음에 추가한 원문이 철회되면 작업·검토 본문과 근거도 숨긴다", async () => {
      const s = await seed("생성 후 근거 보완 관제"),
        a = await analysis(s.source),
        done = await wait(await generate(s.source, a.id));
      const b = (await batch(done.groups[0].id)).batch;
      const extra = await seed("새로 추가한 현장 기록", s.projectId);
      const items = structuredClone(b.items);
      items[0].chunkIds.push(extra.chunks[0]);
      items[0].body += "\n\n추가 원문을 대조했습니다.";
      const saved = await clients.writer.post(`${base}/proposals`, {
        data: revision(b, items),
      });
      expect(saved.status()).toBe(201);
      const id = (await saved.json()).id;
      await pool.query(
        "UPDATE source SET published_version_id=NULL WHERE id=$1",
        [extra.source],
      );
      const hidden = await info(done.id);
      expect(hidden.current).toBe(false);
      expect(hidden.groups).toHaveLength(0);
      expect(hidden.result).toBeNull();
      const closed = await batch(id);
      expect(closed.available).toBe(false);
      expect(closed.batch.items).toHaveLength(0);
      expect(
        closed.groups.every(
          (g) => g.pages.length === 0 && g.results.length === 0,
        ),
      ).toBe(true);
      expect((await action(id, "submit")).status()).toBe(409);
    });
    test("수동 위키의 많은 링크와 변경 묶음 편집에서도 유형·별칭을 보존한다", async () => {
      const s = await seed("수동 위키 관계 경계 관제");
      const ids = Array.from({ length: 60 }, () => randomUUID());
      const body = `관제 화면의 참조 목록입니다.\n\n${ids.map((id) => `[참고](${root}/wiki/${id})`).join("\n")}`;
      const target = await wiki(s, "수동 관계 목록", body);
      let detail = await (
        await clients.writer.get(`${base}/wiki/${target.pageId}`)
      ).json();
      expect(detail.version.metadata.links).toHaveLength(60);
      await pool.query(
        "UPDATE wiki_version SET metadata=metadata||$2::jsonb WHERE id=$1",
        [
          target.versionId,
          JSON.stringify({ type: "concept", aliases: ["관제 용어"] }),
        ],
      );
      const item = {
        kind: "update",
        pageId: target.pageId,
        parentVersionId: target.versionId,
        basePublishedVersionId: target.versionId,
        title: "직원이 정리한 관계 목록",
        body: `${body}\n\n직원이 정리했습니다.`,
        reason: "직접 작성한 내용을 검토합니다.",
        chunkIds: s.chunks,
        mergedPages: [],
      };
      const saved = await clients.writer.post(`${base}/proposals`, {
        data: {
          title: "수동 변경",
          domainId: f.domainId,
          projectId: s.projectId,
          items: [item],
        },
      });
      expect(saved.status()).toBe(201);
      const id = (await saved.json()).id;
      expect((await action(id, "submit")).status()).toBe(200);
      expect((await action(id, "approve", "reviewer")).status()).toBe(200);
      detail = await (
        await clients.reader.get(`${base}/wiki/${target.pageId}`)
      ).json();
      expect(detail.version.metadata).toMatchObject({
        type: "concept",
        aliases: ["관제 용어"],
      });
      expect(
        detail.version.metadata.links.map((l: { pageId: string }) => l.pageId),
      ).toEqual(ids);
    });
    test("생성 중 작성 권한을 철회하면 늦은 응답·검토 묶음을 저장하지 않는다", async () => {
      const s = await seed("생성지연 권한 관제"),
        a = await analysis(s.source),
        id = await generate(s.source, a.id);
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
          { timeout: 15000 },
        )
        .toBe(1);
      try {
        await pool.query(
          "UPDATE membership SET is_active=false WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, writer.id],
        );
        await expect
          .poll(
            async () =>
              (await pool.query("SELECT state FROM ai_task WHERE id=$1", [id]))
                .rows[0].state,
            { timeout: 15000 },
          )
          .toBe("failed");
        expect(
          (
            await pool.query("SELECT id FROM change_batch WHERE task_id=$1", [
              id,
            ])
          ).rows,
        ).toHaveLength(0);
      } finally {
        await pool.query(
          "UPDATE membership SET is_active=true WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, writer.id],
        );
      }
      const task = await info(id);
      expect(task.result).toBeNull();
      expect(
        task.steps.some(
          (s) => s.kind === "plan-wiki" && s.state === "completed",
        ),
      ).toBe(false);
    });
  });
}
