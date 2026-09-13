import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";
import type { researchDetails } from "../src/server/services/research";

type Fixture = {
  workspaceId: string;
  accounts: { id: string; role: string }[];
};
type Details = Awaited<ReturnType<typeof researchDetails>>;
export function registerOriginalResearchTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("원본 기능 복원 — 심층 조사·그래프 편집", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const w = f.workspaceId,
      base = `/api/workspaces/${w}`;
    const author = f.accounts.find((a) => a.role === "writer")?.id,
      reviewer = f.accounts.find((a) => a.role === "reviewer")?.id;
    function job(call = "runNextResearch()") {
      const child = spawn(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "--eval",
          `import('./src/server/jobs/research.ts').then(async m=>{await m.${call}; const {getPool}=await import('./src/server/db/index.ts');await getPool().end();}).catch(e=>{console.error(e);process.exit(1)})`,
        ],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let errors = "";
      child.stderr.on("data", (v) => {
        errors += v;
      });
      const done = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) =>
          code === 0 || signal === "SIGKILL"
            ? resolve()
            : reject(new Error(errors)),
        );
      });
      return { child, done };
    }
    async function seed() {
      const domainId = randomUUID(),
        sourceId = randomUUID(),
        sv = randomUUID(),
        chunkId = randomUUID(),
        pageId = randomUUID(),
        versionId = randomUUID();
      const body =
        "# 검수기초\n\n검수기초에서는 검수 기록을 72시간 보관합니다. 담당자가 확인한 후 문서를 게시하며 예외 조건을 원문에서 확인합니다.";
      await pool.query(
        "INSERT INTO domain(id,workspace_id,name,purpose) VALUES($1,$2,$3,'검수 기록 관리와 공개 절차')",
        [domainId, w, `조사 표본 ${domainId.slice(0, 8)}`],
      );
      await pool.query(
        "INSERT INTO source(id,workspace_id,domain_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,'검수기초 원문','reference',$4,$5,$5,1)",
        [sourceId, w, domainId, author, sv],
      );
      await pool.query(
        "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'inspection.md','text/markdown',$4,$4,100,$5,'published','completed')",
        [sv, w, sourceId, randomUUID(), author],
      );
      await pool.query(
        "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,0,$4,$5)",
        [chunkId, w, sv, body, { kind: "lines", startLine: 1, endLine: 3 }],
      );
      await pool.query(
        "INSERT INTO wiki_page(id,workspace_id,domain_id,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,$5,$5,1)",
        [pageId, w, domainId, author, versionId],
      );
      await pool.query(
        "INSERT INTO wiki_version(id,workspace_id,page_id,number,title,body,metadata,author_id,state) VALUES($1,$2,$3,1,'검수기초',$4,$5,$6,'approved')",
        [
          versionId,
          w,
          pageId,
          body,
          {
            type: "concept",
            aliases: [],
            links: [],
            path: "wiki/concepts/검수기초.md",
          },
          author,
        ],
      );
      await pool.query(
        "INSERT INTO wiki_evidence(workspace_id,version_id,chunk_id) VALUES($1,$2,$3)",
        [w, versionId, chunkId],
      );
      return { domainId, sourceId, sv, chunkId, pageId, versionId, body };
    }
    const input = (domainId: string, extra: object = {}) => ({
      domainId,
      projectId: null,
      requestId: randomUUID(),
      topic: "검수 기록 조사",
      queries: ["검수기초"],
      sourceMode: "local",
      ...extra,
    });
    async function queue(
      domainId: string,
      extra: object = {},
      client = clients.writer,
    ) {
      const response = await client.post(`${base}/research`, {
        data: input(domainId, extra),
      });
      expect(response.status(), await response.text()).toBe(201);
      return (await response.json()).id as string;
    }
    async function details(
      id: string,
      client = clients.writer,
    ): Promise<Details> {
      const response = await client.get(`${base}/research/${id}`);
      expect(response.status(), await response.text()).toBe(200);
      return response.json();
    }
    const state = async (id: string) =>
      (await pool.query("SELECT state FROM research_run WHERE id=$1", [id]))
        .rows[0]?.state;
    const action = (
      kind: string,
      id: string,
      action: string,
      client = clients.reviewer,
    ) =>
      client.post(`${base}/${kind}-versions/${id}/action`, {
        data: { action, note: action === "withdraw" ? "근거 철회 시험" : "" },
      });
    async function finding(
      domainId: string,
      kind = "suggestion",
      resolved = false,
    ) {
      const runId = randomUUID(),
        id = randomUUID();
      await pool.query(
        "INSERT INTO quality_run(id,workspace_id,domain_id,author_id,request_id,mode,origin,basis_hash,snapshot,state) VALUES($1,$2,$3,$4,$5,'semantic','manual','fixture','{}','completed')",
        [runId, w, domainId, reviewer, randomUUID()],
      );
      await pool.query(
        "INSERT INTO quality_finding(id,workspace_id,domain_id,scope_key,finding_key,mode,kind,severity,title,note,page_ids,quotes,run_id,basis_hash,state) VALUES($1::uuid,$2,$3,$4,$1::text,'semantic',$5,'info','검수기초 보완','검수기초 보관 예외를 조사합니다.','[]','[]',$6,'fixture',$7)",
        [
          id,
          w,
          domainId,
          `${domainId}:*`,
          kind,
          runId,
          resolved ? "resolved" : "open",
        ],
      );
      return id;
    }
    test.afterAll(async () => {
      await pool.end();
    });

    test("내부 자료로 원본 인용·위키 연결·query 초안을 만들고 중복 요청과 작업자 경쟁을 제어한다", async () => {
      const s = await seed(),
        requestId = randomUUID();
      const id = await queue(s.domainId, { requestId });
      expect(await queue(s.domainId, { requestId })).toBe(id);
      expect(
        (
          await clients.writer.post(`${base}/research`, {
            data: input(s.domainId, { requestId, topic: "다른 주제" }),
          })
        ).status(),
      ).toBe(409);
      await Promise.all([job().done, job().done]);
      const d = await details(id);
      expect(d.state, d.error ?? "").toBe("completed");
      expect(d.pageId).toBeTruthy();
      expect(d.synthesis).toContain("[1]");
      expect(
        d.linkDestinations[`#${encodeURIComponent("concepts/검수기초")}`],
      ).toBe(`/w/${w}/wiki/${s.pageId}`);
      const {
        rows: [page],
      } = await pool.query(
        "SELECT p.published_version_id,v.state,v.metadata,v.body,(SELECT count(*)::int FROM wiki_evidence WHERE version_id=v.id) AS evidence FROM wiki_page p JOIN wiki_version v ON v.id=p.latest_version_id WHERE p.id=$1",
        [d.pageId],
      );
      expect(page).toMatchObject({
        published_version_id: null,
        state: "draft",
        evidence: 1,
      });
      expect(page.metadata.type).toBe("query");
      expect(page.metadata.path).toContain(id);
      expect(page.body).toContain("origin: deep-research");
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM generation WHERE request_id=$1",
            [id],
          )
        ).rows[0].count,
      ).toBe(1);
      expect(
        (await clients.reader.get(`${base}/research/${id}`)).status(),
      ).toBe(403);
      expect(
        (await clients.outsider.get(`${base}/research/${id}`)).status(),
      ).toBe(404);
      expect(
        (await clients.reader.get(`${base}/wiki/${d.pageId}`)).status(),
      ).toBe(404);
      expect((await action("source", s.sv, "withdraw")).status()).toBe(200);
      expect(await details(id)).toMatchObject({
        state: "outdated",
        synthesis: "",
        references: [],
        pageId: null,
      });
    });

    test("웹과 내부 출처를 함께 인용하고 인용한 발췌만 원문으로 저장해 검토·게시·철회를 거친다", async () => {
      const s = await seed(),
        id = await queue(s.domainId, {
          topic: "혼합인용 검수 조사",
          sourceMode: "both",
          provider: "searxng",
          categories: ["science", "it"],
        });
      await job().done;
      const d = await details(id);
      expect(d.state, d.error ?? "").toBe("completed");
      expect(d.references.length).toBeGreaterThan(5);
      expect(d.synthesis).toContain("[6]");
      const web = d.sources.find((source) => source.publication === "pending");
      expect(web).toBeTruthy();
      const { rows: chunks } = await pool.query(
        "SELECT text,locator FROM source_chunk WHERE version_id=$1 ORDER BY ordinal",
        [web?.version_id],
      );
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toContain(d.references[0].snippet);
      expect(chunks[0].text).not.toContain("# 검수 기록 조사");
      const file = await clients.writer.get(
        `${base}/source-versions/${web?.version_id}/file`,
      );
      expect(file.status()).toBe(200);
      const lines = (await file.text()).split("\n");
      expect(
        lines
          .slice(chunks[0].locator.startLine - 1, chunks[0].locator.endLine)
          .join("\n"),
      ).toBe(chunks[0].text);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM ai_task WHERE source_version_id=$1",
            [web?.version_id],
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await action("wiki", d.versionId as string, "submit", clients.writer)
        ).status(),
      ).toBe(409);
      expect(
        (await action("source", web?.version_id as string, "approve")).status(),
      ).toBe(200);
      expect(
        (
          await action("wiki", d.versionId as string, "submit", clients.writer)
        ).status(),
      ).toBe(200);
      expect(
        (await action("wiki", d.versionId as string, "approve")).status(),
      ).toBe(200);
      expect(
        (await clients.reader.get(`${base}/wiki/${d.pageId}`)).status(),
      ).toBe(200);
      expect(
        (
          await action("source", web?.version_id as string, "withdraw")
        ).status(),
      ).toBe(200);
      expect(await details(id)).toMatchObject({
        state: "outdated",
        synthesis: "",
        references: [],
        sources: [],
      });
      expect(
        (await clients.reader.get(`${base}/wiki/${d.pageId}`)).status(),
      ).toBe(404);
    });

    test("검색 일부 실패와 URL 중복을 처리하고 자료가 없으면 모델·문서 생성 없이 마친다", async () => {
      const s = await seed();
      const id = await queue(s.domainId, {
        sourceMode: "web",
        provider: "searxng",
        queries: ["중복검색 갑", "검색실패", "중복검색 을"],
      });
      await job().done;
      const d = await details(id);
      expect(d.state, d.error ?? "").toBe("completed");
      expect(d.references).toHaveLength(5);
      expect(d.sourceErrors).toHaveLength(1);
      const empty = await queue(s.domainId, {
        sourceMode: "web",
        provider: "searxng",
        queries: ["빈검색"],
      });
      await job().done;
      expect(await details(empty)).toMatchObject({
        state: "completed",
        pageId: null,
        references: [],
      });
      const {
        rows: [g],
      } = await pool.query(
        "SELECT input_tokens,output_tokens FROM generation WHERE request_id=$1",
        [empty],
      );
      expect(g).toEqual({ input_tokens: 0, output_tokens: 0 });
      const failed = await queue(s.domainId, {
        sourceMode: "web",
        provider: "searxng",
        queries: ["검색실패"],
      });
      await job().done;
      expect(await details(failed)).toMatchObject({
        state: "failed",
        pageId: null,
        synthesis: "",
      });
    });

    test("본문·인용 검증에 실패한 모델 응답은 원문이나 위키 초안으로 남기지 않는다", async () => {
      const s = await seed();
      for (const topic of ["연구본문오류", "연구인용오류"]) {
        const id = await queue(s.domainId, {
          topic,
          sourceMode: "web",
          provider: "searxng",
        });
        await job().done;
        expect(await details(id)).toMatchObject({
          state: "failed",
          pageId: null,
          versionId: null,
          synthesis: "",
          references: [],
        });
      }
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM source WHERE domain_id=$1",
            [s.domainId],
          )
        ).rows[0].count,
      ).toBe(1);
    });

    test("대기·생성 중 중지와 자료 변경은 저장을 막고 임대가 끊긴 작업은 자동 재과금하지 않는다", async () => {
      const s = await seed(),
        queued = await queue(s.domainId);
      expect(
        (
          await clients.writer.patch(`${base}/research/${queued}`, {
            data: { action: "cancel" },
          })
        ).status(),
      ).toBe(200);
      await job().done;
      expect(await state(queued)).toBe("canceled");
      const active = await queue(s.domainId, { topic: "지연 조사" }),
        running = job();
      await expect.poll(() => state(active)).toBe("synthesizing");
      expect(
        (
          await clients.writer.patch(`${base}/research/${active}`, {
            data: { action: "cancel" },
          })
        ).status(),
      ).toBe(200);
      await running.done;
      expect(await details(active)).toMatchObject({
        state: "canceled",
        pageId: null,
        synthesis: "",
      });
      const revoked = await queue(s.domainId, { topic: "지연 자료 변경" }),
        second = job();
      await expect.poll(() => state(revoked)).toBe("synthesizing");
      await action("source", s.sv, "withdraw");
      await second.done;
      expect(await details(revoked)).toMatchObject({
        state: "outdated",
        pageId: null,
        synthesis: "",
      });
      const interrupted = await queue(s.domainId, {
          topic: "지연 연결 종료",
          sourceMode: "web",
          provider: "searxng",
        }),
        third = job();
      await expect.poll(() => state(interrupted)).toBe("synthesizing");
      third.child.kill("SIGKILL");
      await third.done;
      await pool.query(
        "UPDATE research_run SET updated_at=now()-interval '40 seconds' WHERE id=$1",
        [interrupted],
      );
      await job("reconcileResearch()").done;
      await job().done;
      expect(await details(interrupted)).toMatchObject({
        state: "failed",
        pageId: null,
        synthesis: "",
      });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM generation WHERE request_id=$1",
            [interrupted],
          )
        ).rows[0].count,
      ).toBe(1);
    });

    test("조사 중 작성 권한과 목적이 바뀌면 최종 초안을 저장하지 않는다", async () => {
      const s = await seed(),
        id = await queue(s.domainId, { topic: "지연 권한 확인" }),
        active = job();
      await expect.poll(() => state(id)).toBe("synthesizing");
      try {
        await pool.query(
          "UPDATE membership SET role='reader' WHERE workspace_id=$1 AND user_id=$2",
          [w, author],
        );
        await active.done;
        expect(await state(id)).toBe("failed");
      } finally {
        await pool.query(
          "UPDATE membership SET role='writer' WHERE workspace_id=$1 AND user_id=$2",
          [w, author],
        );
      }
      const id2 = await queue(s.domainId, { topic: "지연 목적 확인" }),
        active2 = job();
      await expect.poll(() => state(id2)).toBe("synthesizing");
      await pool.query(
        "UPDATE domain SET purpose='변경된 업무 목적' WHERE id=$1",
        [s.domainId],
      );
      await active2.done;
      expect(await details(id2)).toMatchObject({
        state: "outdated",
        pageId: null,
        synthesis: "",
      });
    });

    test("동시 실행 한도에서는 대기하고 같은 주제의 서로 다른 조사는 고유 경로를 쓴다", async () => {
      const s = await seed();
      const ids = [];
      for (let n = 0; n < 3; n++) {
        const id = randomUUID();
        ids.push(id);
        await pool.query(
          "INSERT INTO generation(id,workspace_id,author_id,request_id,input_hash,kind,state,model) VALUES($1,$2,$3,$4,'capacity','deep-research','running','test-knowledge')",
          [id, w, author, randomUUID()],
        );
      }
      const id = await queue(s.domainId);
      await job().done;
      expect(await state(id)).toBe("queued");
      await pool.query(
        "UPDATE generation SET state='failed' WHERE id=ANY($1::uuid[])",
        [ids],
      );
      await job().done;
      const second = await queue(s.domainId);
      await job().done;
      const { rows } = await pool.query(
        "SELECT v.metadata->>'path' AS path FROM research_run r JOIN wiki_version v ON v.id=r.version_id WHERE r.id=ANY($1::uuid[])",
        [[id, second]],
      );
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.path)).size).toBe(2);
    });

    test("검토 항목 일괄 조사는 대상·권한을 검사하고 진행 중인 조사를 재사용한다", async () => {
      const s = await seed(),
        a = await finding(s.domainId),
        b = await finding(s.domainId, "missing-page"),
        c = await finding(s.domainId, "contradiction"),
        resolved = await finding(s.domainId, "suggestion", true);
      const data = {
        domainId: s.domainId,
        projectId: null,
        requestId: randomUUID(),
        findingIds: [a, b, c, resolved],
        sourceMode: "local",
      };
      expect(
        (
          await clients.writer.post(`${base}/research-batch`, { data })
        ).status(),
      ).toBe(403);
      const response = await clients.reviewer.post(`${base}/research-batch`, {
        data,
      });
      expect(response.status(), await response.text()).toBe(201);
      const result = await response.json();
      expect(result.results).toHaveLength(2);
      expect(result.results.every((r: { id?: string }) => !!r.id)).toBe(true);
      expect(result.skipped.sort()).toEqual([c, resolved].sort());
      const replay = await clients.reviewer.post(`${base}/research-batch`, {
        data: { ...data, requestId: randomUUID() },
      });
      expect(
        (await replay.json()).results.every(
          (r: { replay: boolean }) => r.replay,
        ),
      ).toBe(true);
      expect(
        (
          await clients.reviewer.post(`${base}/research-batch`, {
            data: { ...data, findingIds: [a, randomUUID()] },
          })
        ).status(),
      ).toBe(409);
      await Promise.all([job().done, job().done]);
      for (const r of result.results)
        expect((await details(r.id, clients.reviewer)).state).toBe("completed");
      expect(
        (await pool.query("SELECT state FROM quality_finding WHERE id=$1", [a]))
          .rows[0].state,
      ).toBe("open");
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM review_event WHERE target_id=ANY($1::uuid[]) AND action='research-draft'",
            [[a, b]],
          )
        ).rows[0].count,
      ).toBe(2);
    });

    test("390px에서 주제 보완·검색어 수정·조사·숫자 인용·위키 링크를 조작한다", async ({
      page,
    }) => {
      const s = await seed();
      await page
        .context()
        .addCookies((await clients.writer.storageState()).cookies);
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(
        `/w/${w}/tools/research?domainId=${s.domainId}&topic=검수기초`,
      );
      await page.getByRole("button", { name: "AI로 주제·검색어 보완" }).click();
      await expect(page.getByLabel("조사 주제", { exact: true })).toHaveValue(
        "검수 기록 보관 기준 조사",
      );
      await page.getByLabel("검색어 · 한 줄에 하나").fill("검수기초");
      await page.getByLabel("조사 자료", { exact: true }).click();
      await page
        .getByRole("option", { name: "내부 공개 자료", exact: true })
        .click();
      const posted = page.waitForResponse(
        (r) => r.url().endsWith("/research") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "조사 시작", exact: true })
        .click();
      const id = (await (await posted).json()).id;
      await job().done;
      const result = page.getByRole("region", {
        name: "조사 결과",
        exact: true,
      });
      await expect(
        result.getByRole("link", { name: "조사 초안 확인·검토 요청 →" }),
      ).toBeVisible();
      await result
        .getByRole("button", { name: /^출처 1:/ })
        .first()
        .click();
      await expect(
        result.getByRole("region", { name: "선택한 조사 출처" }),
      ).toContainText("72시간");
      await expect(
        result.getByRole("link", { name: "검수 기준", exact: true }),
      ).toHaveAttribute("href", `/w/${w}/wiki/${s.pageId}`);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: ".local/parity-research-390.png",
        fullPage: true,
      });
      expect((await details(id)).state).toBe("completed");
    });

    test("검토 목록에서 여러 항목을 선택해 조사하고 개별 진행 화면으로 이동한다", async ({
      page,
    }) => {
      const s = await seed();
      await finding(s.domainId);
      await finding(s.domainId, "missing-page");
      await page
        .context()
        .addCookies((await clients.reviewer.storageState()).cookies);
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(`/w/${w}/quality?domainId=${s.domainId}`);
      const panel = page.getByRole("region", { name: "검토 항목 일괄 조사" });
      for (const item of await panel.getByRole("checkbox").all())
        await item.check();
      await panel.getByRole("button", { name: "선택 2건 조사 시작" }).click();
      await expect(
        panel.getByRole("link", { name: "조사 진행 보기 →" }),
      ).toHaveCount(2);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await Promise.all([job().done, job().done]);
      await panel
        .getByRole("link", { name: "조사 진행 보기 →" })
        .first()
        .click();
      await expect(
        page
          .getByRole("region", { name: "조사 결과", exact: true })
          .getByRole("link", { name: "조사 초안 확인·검토 요청 →" }),
      ).toBeVisible();
    });
    test("채팅의 원본 위키 별칭 링크는 숫자 인용과 함께 목적지로 연결되고 철회 뒤 답변을 숨긴다", async ({
      page,
    }) => {
      const s = await seed();
      const created = await clients.reader.post(`${base}/conversations`, {
        data: { scope: { domainId: s.domainId } },
      });
      expect(created.status()).toBe(201);
      const id = (await created.json()).id;
      const response = await clients.reader.post(
        `${base}/conversations/${id}/stream`,
        {
          data: {
            requestId: randomUUID(),
            prompt: "검수기초 채팅위키연결계약",
          },
        },
      );
      expect(response.status(), await response.text()).toBe(200);
      const details = await (
        await clients.reader.get(`${base}/conversations/${id}`)
      ).json();
      expect(details.runs.at(-1).state).toBe("completed");
      expect(
        details.runs
          .at(-1)
          .messages.find((m: { role: string }) => m.role === "assistant").body,
      ).toContain("[[concepts/검수기초|검수 기준]]");
      expect(
        details.runs.at(-1).linkDestinations[
          `#${encodeURIComponent("concepts/검수기초")}`
        ],
      ).toBe(`/w/${w}/wiki/${s.pageId}`);
      await page
        .context()
        .addCookies((await clients.reader.storageState()).cookies);
      await page.goto(`/w/${w}/chat?conversation=${id}`);
      await expect(
        page.getByRole("link", { name: "검수 기준", exact: true }),
      ).toHaveAttribute("href", `/w/${w}/wiki/${s.pageId}`);
      await expect(
        page.getByRole("button", { name: /^출처 E1:/ }).first(),
      ).toBeVisible();
      await action("source", s.sv, "withdraw");
      await page.reload();
      await expect(
        page.getByRole("link", { name: "검수 기준", exact: true }),
      ).toHaveCount(0);
    });

    test("그래프 미리보기 편집은 근거·경로·게시본을 보존한 새 초안으로 저장된다", async ({
      page,
    }) => {
      const s = await seed();
      await page
        .context()
        .addCookies((await clients.writer.storageState()).cookies);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`/w/${w}/graph?domainId=${s.domainId}`);
      await page
        .getByRole("button", { name: "위키 목록", exact: true })
        .click();
      await page
        .getByRole("group", { name: "위키 목록", exact: true })
        .getByRole("button", { name: /검수기초/ })
        .click();
      const preview = page.getByRole("region", {
        name: "그래프 문서 미리보기",
      });
      await expect(preview).toContainText("72시간");
      await preview.getByRole("button", { name: "미리보기에서 편집" }).click();
      await preview
        .getByRole("button", { name: "마크다운", exact: true })
        .click();
      await preview
        .getByLabel("마크다운 본문")
        .fill(`${s.body}\n\n현장 담당자의 검토 설명을 추가합니다.`);
      await preview
        .getByRole("button", { name: "초안으로 저장", exact: true })
        .click();
      await expect(preview).toContainText("수정 내용을 초안으로 저장했습니다.");
      const {
        rows: [result],
      } = await pool.query(
        "SELECT p.published_version_id,v.state,v.body,v.metadata,(SELECT count(*)::int FROM wiki_evidence WHERE version_id=v.id) AS evidence FROM wiki_page p JOIN wiki_version v ON v.id=p.latest_version_id WHERE p.id=$1",
        [s.pageId],
      );
      expect(result).toMatchObject({
        published_version_id: s.versionId,
        state: "draft",
        evidence: 1,
      });
      expect(result.metadata.path).toBe("wiki/concepts/검수기초.md");
      expect(result.body).toContain("현장 담당자");
    });
  });
}
