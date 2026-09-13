import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";
import { rebindUnitAnalysis } from "../src/lib/analysis-cache";
import type { AnalysisUnit } from "../src/lib/document-analysis";
import type { IngestSummary } from "../src/lib/ingest";
import type { aiTaskDetails } from "../src/server/services/ai-tasks";
import type { batchDetails } from "../src/server/services/proposals";

type Fixture = {
  workspaceId: string;
  accounts: { id: string; role: string }[];
};
type Task = Awaited<ReturnType<typeof aiTaskDetails>>;
type Batch = Awaited<ReturnType<typeof batchDetails>>;
type Source = {
  id: string;
  versionId: string;
  domainId: string;
  projectId: string;
  title: string;
  texts: string[];
  chunks: string[];
};
export function registerIngestTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("12단계 자동 정리·증분 갱신", () => {
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
      const done = new Promise<void>((resolve) =>
        worker?.once("exit", () => resolve()),
      );
      worker.kill("SIGTERM");
      await done;
      worker = undefined;
    }
    async function seed(
      title: string,
      texts = [
        "관제 화면은 30초마다 갱신합니다. 일반 화면에는 적용하지 않습니다.",
        "비상 전원은 8시간 동안 유지합니다.",
      ],
    ): Promise<Source> {
      const domainId = randomUUID(),
        projectId = randomUUID(),
        id = randomUUID(),
        versionId = randomUUID(),
        chunks = texts.map(() => randomUUID());
      await pool.query(
        "INSERT INTO domain(id,workspace_id,name,purpose) VALUES($1,$2,$3,'개발 표본의 조건을 확인합니다.')",
        [domainId, f.workspaceId, title],
      );
      await pool.query(
        "INSERT INTO project(id,workspace_id,domain_id,name,client_name) VALUES($1,$2,$3,$4,'개발 표본')",
        [projectId, f.workspaceId, domainId, title],
      );
      await pool.query(
        "INSERT INTO source(id,workspace_id,domain_id,project_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,$5,'guideline',$6,$7,$7,1)",
        [id, f.workspaceId, domainId, projectId, title, writer?.id, versionId],
      );
      await pool.query(
        "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing,parser_version) VALUES($1,$2,$3,1,'ingest.md','text/markdown',$4,$4,1000,$5,'published','completed','ingest-test-v1')",
        [versionId, f.workspaceId, id, randomUUID(), writer?.id],
      );
      for (const [index, text] of texts.entries())
        await pool.query(
          "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,$4,$5,$6)",
          [
            chunks[index],
            f.workspaceId,
            versionId,
            index,
            text,
            {
              kind: "lines",
              startLine: index + 1,
              endLine: index + 1,
              heading: "",
            },
          ],
        );
      return { id, versionId, domainId, projectId, title, texts, chunks };
    }
    async function revise(s: Source, texts: string[]): Promise<Source> {
      const versionId = randomUUID(),
        chunks = texts.map(() => randomUUID());
      await pool.query(
        "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing,parser_version) SELECT $1,$2,$3,version_count+1,'revision.md','text/markdown',$4,$4,1000,$5,'pending','completed','ingest-test-v1' FROM source WHERE id=$3",
        [versionId, f.workspaceId, s.id, randomUUID(), writer?.id],
      );
      for (const [index, text] of texts.entries())
        await pool.query(
          "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,$4,$5,$6)",
          [
            chunks[index],
            f.workspaceId,
            versionId,
            index,
            text,
            {
              kind: "lines",
              startLine: index + 20,
              endLine: index + 20,
              heading: "",
            },
          ],
        );
      await pool.query(
        "UPDATE source SET latest_version_id=$2,version_count=version_count+1 WHERE id=$1",
        [s.id, versionId],
      );
      const approved = await clients.reviewer.post(
        `${base}/source-versions/${versionId}/action`,
        { data: { action: "approve" } },
      );
      expect(approved.status(), await approved.text()).toBe(200);
      return { ...s, versionId, chunks, texts };
    }
    async function list(s: Source, role = "writer") {
      const r = await clients[role].get(
        `${base}/ingest-runs?sourceId=${s.id}&sourceVersionId=${s.versionId}`,
      );
      expect(r.status(), await r.text()).toBe(200);
      return (await r.json()) as { enabled: boolean; items: IngestSummary[] };
    }
    async function run(s: Source, role = "writer") {
      const r = await clients[role].post(`${base}/ingest-runs`, {
        data: { sourceId: s.id },
      });
      expect(r.status(), await r.text()).toBe(201);
      return (await r.json()) as { id: string; state: string; replay: boolean };
    }
    async function wait(s: Source, state = "review", role = "writer") {
      await expect
        .poll(async () => (await list(s, role)).items[0]?.state, {
          timeout: 25000,
          intervals: [200, 400, 800],
        })
        .toMatch(
          state === "completed"
            ? /^(completed|failed|canceled|outdated)$/
            : /^(review|completed|failed|canceled|outdated)$/,
        );
      const result = (await list(s, role)).items[0];
      expect(result.state, result.errorMessage ?? output).toBe(state);
      return result;
    }
    async function task(id: string, role = "writer"): Promise<Task> {
      const r = await clients[role].get(`${base}/ai-tasks/${id}`);
      expect(r.status()).toBe(200);
      return r.json();
    }
    async function batch(id: string): Promise<Batch> {
      const r = await clients.writer.get(`${base}/proposals/${id}`);
      expect(r.status()).toBe(200);
      return r.json();
    }
    async function approve(id: string) {
      const submitted = await clients.writer.post(
        `${base}/proposals/${id}/action`,
        { data: { action: "submit" } },
      );
      expect(submitted.status(), await submitted.text()).toBe(200);
      const approved = await clients.reviewer.post(
        `${base}/proposals/${id}/action`,
        { data: { action: "approve" } },
      );
      expect(approved.status(), await approved.text()).toBe(200);
      return batch(id);
    }
    async function countCalls(s: Source) {
      return (
        await pool.query(
          "SELECT count(*)::int AS n FROM generation g JOIN ai_task t ON t.id=g.task_id JOIN source_version v ON v.id=t.source_version_id WHERE v.source_id=$1",
          [s.id],
        )
      ).rows[0].n as number;
    }
    async function settings(s: Source, changes: Record<string, unknown>) {
      const row = (
        await pool.query(
          "SELECT name,purpose,purpose_guide,terms,record_template,auto_ingest FROM domain WHERE id=$1",
          [s.domainId],
        )
      ).rows[0];
      const response = await clients.admin.patch(
        `${base}/domains/${s.domainId}`,
        {
          data: {
            name: row.name,
            purpose: row.purpose,
            purposeGuide: row.purpose_guide,
            terms: row.terms,
            recordTemplate: row.record_template,
            autoIngest: row.auto_ingest,
            ...changes,
          },
        },
      );
      expect(response.status(), await response.text()).toBe(200);
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
    test("캐시의 같은 문단을 새 ID에 재연결하고 문맥·수치·부정의 변조를 거부한다", () => {
      const oldId = randomUUID(),
        currentId = randomUUID();
      const old: AnalysisUnit = {
        id: "unit-1",
        contextBefore: "관제 화면 조건",
        parts: [
          {
            id: `${oldId}:0-10`,
            chunkId: oldId,
            start: 0,
            end: 10,
            text: "관제 화면은 30초마다 갱신하며, 단절 시 자동 갱신하지 않습니다. 한글🙂",
            headingPath: "관제",
            structure: "text",
            structureContext: "",
            locator: {
              kind: "lines",
              startLine: 1,
              endLine: 1,
              heading: "관제",
            },
          },
        ],
      };
      const current: AnalysisUnit = {
        ...old,
        id: "unit-2",
        parts: old.parts.map((p) => ({
          ...p,
          id: `${currentId}:10-20`,
          chunkId: currentId,
          start: 10,
          end: 20,
          locator: {
            kind: "lines",
            startLine: 21,
            endLine: 21,
            heading: "관제",
          },
        })),
      };
      const value = {
        summary: "갱신 조건",
        claims: [
          {
            kind: "fact",
            subject: "관제 화면",
            predicate: "갱신",
            text: old.parts[0].text,
            polarity: "negated",
            value: "30",
            unit: "초",
            condition: "단절 시",
            evidence: [
              {
                partId: old.parts[0].id,
                chunkId: oldId,
                quote: old.parts[0].text,
              },
            ],
          },
        ],
        parts: [
          { partId: old.parts[0].id, status: "analyzed", reason: "조건" },
        ],
        questions: [],
      };
      const rebound = rebindUnitAnalysis(value, old, current);
      expect(rebound.claims[0].evidence[0]).toMatchObject({
        chunkId: currentId,
        partId: current.parts[0].id,
        quote: old.parts[0].text,
      });
      expect(() =>
        rebindUnitAnalysis(value, old, {
          ...current,
          contextBefore: "일반 화면 조건",
        }),
      ).toThrow();
      expect(() =>
        rebindUnitAnalysis(
          {
            ...value,
            claims: [
              { ...value.claims[0], text: "관제 화면은 45초마다 갱신합니다." },
            ],
          },
          old,
          current,
        ),
      ).toThrow();
    });
    let initial: Source, initialRun: IngestSummary;
    test("자동 정리는 기본으로 꺼져 있고 추출·공개 승인 후 중단된 연결을 복구한다", async () => {
      initial = await seed("자동정리 공개 연결");
      expect((await list(initial)).enabled).toBe(false);
      await pool.query(
        "UPDATE source SET published_version_id=NULL WHERE id=$1",
        [initial.id],
      );
      await pool.query(
        "UPDATE source_version SET publication='pending' WHERE id=$1",
        [initial.versionId],
      );
      await pool.query("UPDATE domain SET auto_ingest=true WHERE id=$1", [
        initial.domainId,
      ]);
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM ingest_run WHERE source_id=$1",
                [initial.id],
              )
            ).rows[0].n,
        )
        .toBe(0);
      await stop();
      expect(
        (
          await clients.reviewer.post(
            `${base}/source-versions/${initial.versionId}/action`,
            { data: { action: "approve" } },
          )
        ).status(),
      ).toBe(200);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM ingest_run WHERE source_id=$1",
            [initial.id],
          )
        ).rows[0].n,
      ).toBe(0);
      await start();
      initialRun = await wait(initial);
      expect(initialRun.origin).toBe("automatic");
      expect(initialRun.groups).toHaveLength(1);
      expect(
        (await task(initialRun.generationTaskId ?? "")).steps.filter(
          (s) => s.kind === "generate-wiki",
        ),
      ).toHaveLength(2);
    });
    test("동시·반복 실행은 같은 결과를 반환하고 직접 API의 역할·공간 경계를 지킨다", async () => {
      const calls = await countCalls(initial);
      const repeated = await Promise.all(
        Array.from({ length: 6 }, () => run(initial)),
      );
      expect(new Set(repeated.map((r) => r.id))).toEqual(
        new Set([initialRun.id]),
      );
      expect(repeated.every((r) => r.replay)).toBe(true);
      expect(await countCalls(initial)).toBe(calls);
      expect(
        (
          await clients.reader.post(`${base}/ingest-runs`, {
            data: { sourceId: initial.id },
          })
        ).status(),
      ).toBe(403);
      expect(
        (
          await clients.outsider.post(`${base}/ingest-runs`, {
            data: { sourceId: initial.id },
          })
        ).status(),
      ).toBe(404);
      expect(
        (
          await clients.writer.post(`${base}/ingest-runs`, {
            data: { sourceId: initial.id, authorId: "forged" },
          })
        ).status(),
      ).toBe(400);
      expect((await list(initial, "reviewer")).items[0].generationTaskId).toBe(
        initialRun.generationTaskId,
      );
    });
    test("모바일 자료실에서 정리 결과를 열고 승인 후 재실행해도 호출·위키가 늘지 않는다", async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: await clients.writer.storageState(),
        viewport: { width: 390, height: 844 },
        timezoneId: "America/New_York",
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await page.goto(`${root}/sources/${initial.id}`);
        const section = page.getByRole("region", { name: "자료 자동 정리" });
        await expect(
          section.getByText("변경안 검토 대기", { exact: true }),
        ).toBeVisible();
        await section.getByRole("link", { name: "위키 생성 보기 →" }).click();
        await expect(
          page.getByRole("heading", { name: "분석 기반 위키 생성" }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        ).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
      for (const group of initialRun.groups) await approve(group.id);
      initialRun = await wait(initial, "completed");
      const calls = await countCalls(initial);
      expect((await run(initial)).id).toBe(initialRun.id);
      expect(await countCalls(initial)).toBe(calls);
      const b = await batch(initialRun.groups[0].id);
      expect(b.batch.results).toHaveLength(2);
      for (const result of b.batch.results)
        expect(
          (await clients.reader.get(`${base}/wiki/${result.pageId}`)).status(),
        ).toBe(200);
    });
    let long: Source,
      first: IngestSummary,
      oldBatch: Batch,
      second: IngestSummary,
      changed: Batch;
    test("긴 원문을 여러 구간으로 분석하고 개정 비교에 사용할 위키를 게시한다", async () => {
      const texts = [
        `${"관제 화면 설명. ".padEnd(11000, "가")}관제 화면은 30초마다 갱신합니다. 일반 화면에는 적용하지 않습니다.`,
        `${"전원 유지 설명. ".padEnd(11000, "나")}비상 전원은 8시간 유지합니다.`,
        `${"보관 절차 설명. ".padEnd(11000, "다")}기록은 30일 보관합니다.`,
      ];
      long = await seed("자동정리 일부 개정", texts);
      await run(long);
      first = await wait(long);
      const a = await task(first.analysisTaskId ?? "");
      expect(
        a.steps.filter((s) => s.kind === "analyze").length,
      ).toBeGreaterThan(1);
      oldBatch = await approve(first.groups[0].id);
    });
    test("일부 개정은 같은 분석 구간·위키 본문을 재사용하며 새 문단과 기존 페이지 주소로 연결한다", async () => {
      long = await revise(
        long,
        long.texts.map((t, i) => (i === 2 ? t.replace("30일", "45일") : t)),
      );
      await run(long);
      second = await wait(long);
      changed = await batch(second.groups[0].id);
      const a = await task(second.analysisTaskId ?? ""),
        g = await task(second.generationTaskId ?? "");
      expect(a.steps.some((s) => s.kind === "analyze" && s.reused)).toBe(true);
      expect(
        g.steps.filter((s) => s.kind === "generate-wiki" && s.reused),
      ).toHaveLength(1);
      expect(new Set(changed.batch.items.map((i) => i.pageId))).toEqual(
        new Set(oldBatch.batch.results.map((r) => r.pageId)),
      );
      const original = oldBatch.batch.items.find(
        (i) => i.metadata?.type === "concept",
      );
      const untouched = changed.batch.items.find(
        (i) => i.metadata?.type === "concept",
      );
      expect(untouched?.body).toBe(original?.body);
      expect(untouched?.requiresResolution).toBe(false);
      expect(
        changed.batch.items.every((i) =>
          i.chunkIds.every((id) => long.chunks.includes(id)),
        ),
      ).toBe(true);
      expect(
        changed.batch.items.find((i) => i.metadata?.type === "source")
          ?.requiresResolution,
      ).toBe(true);
      expect((await task(first.generationTaskId ?? "")).current).toBe(false);
    });
    test("바뀐 조건을 직원이 수정·확인한 뒤 같은 위키 주소로 다시 게시한다", async () => {
      const submitted = await clients.writer.post(
        `${base}/proposals/${changed.batch.id}/action`,
        { data: { action: "submit" } },
      );
      expect(submitted.status()).toBe(200);
      expect(
        (
          await clients.reviewer.post(
            `${base}/proposals/${changed.batch.id}/action`,
            { data: { action: "approve" } },
          )
        ).status(),
      ).toBe(409);
      const g = await task(second.generationTaskId ?? "");
      const items = changed.batch.items.map((item) => {
        if (!item.requiresResolution) return item;
        const step = g.steps.find(
          (s) =>
            (s.input?.page as { plannedPageId?: string } | undefined)
              ?.plannedPageId === item.plannedPageId,
        );
        const sections = (
          step?.result as { sections: { heading: string; content: string }[] }
        ).sections;
        const links =
          item.metadata?.links
            .map((l) => `- [관련 위키](${root}/wiki/${l.pageId})`)
            .join("\n") ?? "";
        return {
          ...item,
          kind: "update",
          requiresResolution: false,
          body:
            sections
              .map((s) => `## ${s.heading}\n\n${s.content}`)
              .join("\n\n") + (links ? `\n\n## 관련 위키\n\n${links}` : ""),
        };
      });
      const revision = await clients.writer.post(`${base}/proposals`, {
        data: {
          title: changed.batch.title,
          domainId: long.domainId,
          projectId: long.projectId,
          predecessorId: changed.batch.id,
          items,
        },
      });
      expect(revision.status(), await revision.text()).toBe(201);
      changed = await approve((await revision.json()).id);
      for (const r of changed.batch.results) {
        const shown = await clients.reader.get(`${base}/wiki/${r.pageId}`);
        expect(shown.status()).toBe(200);
      }
      expect(
        changed.batch.items.find((i) => i.metadata?.type === "source")?.body,
      ).toContain("45일");
      expect(
        changed.batch.items.find((i) => i.metadata?.type === "source")?.body,
      ).not.toContain("30일");
    });
    test("직원이 게시 본문을 수정하면 과거 캐시로 덮어쓰지 않고 개정 대조를 요구한다", async () => {
      const concept = changed.batch.items.find(
        (i) => i.metadata?.type === "concept",
      );
      const result = changed.batch.results.find(
        (r) => r.pageId === concept?.pageId,
      );
      if (!concept || !result) throw new Error("개정 대상 없음");
      const body = `${concept.body}\n\n직원 현장 확인 메모를 보존합니다.`;
      const saved = await clients.writer.post(`${base}/wiki/${result.pageId}`, {
        data: {
          domainId: long.domainId,
          projectId: long.projectId,
          title: concept.title,
          body,
          chunkIds: concept.chunkIds,
          parentVersionId: result.versionId,
          basePublishedVersionId: result.versionId,
        },
      });
      expect(saved.status(), await saved.text()).toBe(201);
      const versionId = (await saved.json()).versionId;
      expect(
        (
          await clients.writer.post(
            `${base}/wiki-versions/${versionId}/action`,
            { data: { action: "submit" } },
          )
        ).status(),
      ).toBe(200);
      expect(
        (
          await clients.reviewer.post(
            `${base}/wiki-versions/${versionId}/action`,
            { data: { action: "approve" } },
          )
        ).status(),
      ).toBe(200);
      long = await revise(
        long,
        long.texts.map((t, i) => (i === 2 ? t.replace("45일", "60일") : t)),
      );
      await run(long);
      const latest = await wait(long),
        b = await batch(latest.groups[0].id);
      const updated = b.batch.items.find((i) => i.pageId === result.pageId);
      // Native single-source replacement proposes the regenerated body while
      // retaining the human-edited immutable version for comparison/recovery.
      expect(updated?.body).not.toContain("직원 현장 확인 메모를 보존합니다.");
      const previousVersion = await (
        await clients.writer.get(
          `${base}/wiki/${result.pageId}?version=${versionId}`,
        )
      ).json();
      expect(previousVersion.version.body).toBe(body);
      expect(updated?.requiresResolution).toBe(true);
      expect(
        (await task(latest.generationTaskId ?? "")).steps.filter(
          (s) => s.kind === "generate-wiki" && s.reused,
        ),
      ).toHaveLength(0);
    });
    test("일부 생성 실패를 재시도하면 이미 완료한 분석과 페이지를 다시 호출하지 않는다", async () => {
      const s = await seed("자동정리 생성부분실패");
      await run(s);
      const failed = await wait(s, "failed");
      const before = await task(failed.generationTaskId ?? "");
      expect(before.current).toBe(true);
      expect(
        before.steps.some(
          (step) => step.kind === "generate-wiki" && step.state === "completed",
        ),
      ).toBe(true);
      expect(
        (
          await clients.writer.patch(`${base}/ai-tasks/${before.id}`, {
            data: { action: "retry" },
          })
        ).status(),
      ).toBe(409);
      expect(
        (
          await clients.writer.patch(`${base}/ingest-runs/${failed.id}`, {
            data: { action: "retry" },
          })
        ).status(),
      ).toBe(200);
      const done = await wait(s);
      expect(done.analysisTaskId).toBe(failed.analysisTaskId);
      expect(done.generationTaskId).toBe(failed.generationTaskId);
      const after = await task(before.id);
      expect(
        after.steps
          .filter((step) => step.kind === "generate-wiki")
          .map((s) => s.attempts),
      ).toEqual([1, 2]);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM change_batch WHERE task_id=$1",
            [before.id],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    test("관련 위키가 달라지면 전체 분석을 유지하고 기존 지식 비교 계획을 다시 만든다", async () => {
      const saved = await clients.writer.post(`${base}/wiki`, {
        data: {
          domainId: initial.domainId,
          projectId: initial.projectId,
          title: "관련 관제 업무 설명",
          body: "관제 화면은 30초마다 갱신합니다.",
          chunkIds: [initial.chunks[0]],
          parentVersionId: null,
          basePublishedVersionId: null,
        },
      });
      expect(saved.status()).toBe(201);
      const versionId = (await saved.json()).versionId;
      expect(
        (
          await clients.writer.post(
            `${base}/wiki-versions/${versionId}/action`,
            { data: { action: "submit" } },
          )
        ).status(),
      ).toBe(200);
      expect(
        (
          await clients.reviewer.post(
            `${base}/wiki-versions/${versionId}/action`,
            { data: { action: "approve" } },
          )
        ).status(),
      ).toBe(200);
      const fresh = await run(initial);
      expect(fresh.replay).toBe(false);
      const done = await wait(initial);
      expect(done.reusedAnalysis).toBe(true);
      expect(done.analysisTaskId).toBe(initialRun.analysisTaskId);
      const generated = await task(done.generationTaskId ?? "");
      expect(generated.usage).toHaveLength(1);
      expect(
        generated.steps.filter((s) => s.kind === "generate-wiki" && s.reused),
      ).toHaveLength(2);
      expect((await task(initialRun.analysisTaskId ?? "")).current).toBe(true);
      expect((await task(initialRun.generationTaskId ?? "")).current).toBe(
        false,
      );
    });
    for (const change of ["purpose", "parser"] as const) {
      test(`${change === "purpose" ? "목적" : "추출기"} 기준이 달라지면 전체 분석과 구간 캐시를 다시 검증하고 이전 검토안을 숨긴다`, async () => {
        const s = await seed(`자동정리 ${change} 기준`);
        await run(s);
        const previous = await wait(s);
        if (change === "purpose")
          await settings(s, {
            purpose: "갱신 조건과 적용 예외를 새 기준으로 확인합니다.",
          });
        else
          await pool.query(
            "UPDATE source_version SET parser_version='ingest-test-v2' WHERE id=$1",
            [s.versionId],
          );
        if (change === "parser")
          expect((await task(previous.analysisTaskId ?? "")).current).toBe(
            false,
          );
        await run(s);
        const current = await wait(s);
        expect(current.reusedAnalysis).toBe(false);
        expect(current.analysisTaskId).not.toBe(previous.analysisTaskId);
        expect(
          (await task(current.analysisTaskId ?? "")).steps.filter(
            (step) => step.kind === "analyze" && step.reused,
          ),
        ).toHaveLength(0);
        const old = await batch(previous.groups[0].id);
        expect(old.available).toBe(false);
        expect(old.batch.items).toEqual([]);
        const visible = await clients.writer.get(`${base}/proposals`);
        expect(
          (await visible.json()).some(
            (b: { id: string }) => b.id === previous.groups[0].id,
          ),
        ).toBe(false);
      });
    }
    test("자동 정리를 중지하거나 설정을 꺼도 같은 원문을 자동으로 반복 등록하지 않는다", async () => {
      const s = await seed("자동정리 지연 중지");
      await settings(s, { autoIngest: true });
      const created = await run(s);
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM ai_task WHERE ingest_run_id=$1 AND state='running'",
                [created.id],
              )
            ).rows[0].n,
          { timeout: 15000 },
        )
        .toBe(1);
      expect(
        (
          await clients.writer.patch(`${base}/ingest-runs/${created.id}`, {
            data: { action: "cancel" },
          })
        ).status(),
      ).toBe(200);
      const calls = await countCalls(s);
      await new Promise((resolve) => setTimeout(resolve, 6500)); // More than two reconciliation periods.
      expect((await list(s)).items).toHaveLength(1);
      expect((await list(s)).items[0].state).toBe("canceled");
      expect(await countCalls(s)).toBe(calls);
      await settings(s, { autoIngest: false });
      expect((await list(s)).enabled).toBe(false);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM change_batch b JOIN ai_task t ON t.id=b.task_id WHERE t.ingest_run_id=$1",
            [created.id],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    test("진행 중 원문을 철회하면 늦은 응답과 검토 묶음을 저장하지 않는다", async () => {
      const s = await seed("자동정리 지연 철회");
      const created = await run(s);
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM ai_task WHERE ingest_run_id=$1 AND state='running'",
                [created.id],
              )
            ).rows[0].n,
          { timeout: 15000 },
        )
        .toBe(1);
      expect(
        (
          await clients.reviewer.post(
            `${base}/source-versions/${s.versionId}/action`,
            { data: { action: "withdraw", note: "개정 조건 확인" } },
          )
        ).status(),
      ).toBe(200);
      const result = await wait(s, "outdated");
      expect(result.generationTaskId).toBeNull();
      expect(result.groups).toEqual([]);
      const tasks = (
        await pool.query("SELECT id FROM ai_task WHERE ingest_run_id=$1", [
          created.id,
        ])
      ).rows;
      for (const row of tasks) {
        const t = await task(row.id);
        expect(t.current).toBe(false);
        expect(t.result).toBeNull();
        expect(t.steps.every((step) => step.result === null)).toBe(true);
      }
      expect(
        (
          await clients.writer.patch(`${base}/ingest-runs/${created.id}`, {
            data: { action: "retry" },
          })
        ).status(),
      ).toBe(409);
    });
    test("철회한 이전 원문의 분석을 새 버전 캐시로 사용하거나 위키를 복제하지 않는다", async () => {
      let s = await seed("자동정리 이전 원문 철회");
      await run(s);
      const previous = await wait(s);
      await approve(previous.groups[0].id);
      expect(
        (
          await clients.reviewer.post(
            `${base}/source-versions/${s.versionId}/action`,
            { data: { action: "withdraw", note: "이전 조건 철회" } },
          )
        ).status(),
      ).toBe(200);
      s = await revise(s, s.texts);
      await run(s);
      const current = await wait(s, "failed");
      const a = await task(current.analysisTaskId ?? "");
      expect(
        a.steps.filter((step) => step.kind === "analyze" && step.reused),
      ).toHaveLength(0);
      const g = await task(current.generationTaskId ?? "");
      expect(g.usage).toHaveLength(0);
      expect(g.errorMessage).toContain("철회");
      expect(current.groups).toEqual([]);
    });
    test("권한이 철회된 작성자의 캐시는 재사용하지 않고 다른 작성자에게 작업 내용을 공개하지 않는다", async () => {
      let s = await seed("자동정리 캐시 작성 권한");
      await run(s);
      const previous = await wait(s);
      await approve(previous.groups[0].id);
      s = await revise(s, s.texts);
      try {
        await pool.query(
          "UPDATE membership SET is_active=false WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, writer.id],
        );
        await run(s, "reviewer");
        const current = await wait(s, "review", "reviewer");
        const a = await task(current.analysisTaskId ?? "", "reviewer");
        expect(
          a.steps.filter((step) => step.kind === "analyze" && step.reused),
        ).toHaveLength(0);
      } finally {
        await pool.query(
          "UPDATE membership SET is_active=true WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, writer.id],
        );
      }
      const hidden = (await list(s)).items[0];
      expect(hidden.manageable).toBe(false);
      expect(hidden.analysisTaskId).toBeNull();
      expect(hidden.generationTaskId).toBeNull();
      expect(hidden.groups).toEqual([]);
      const visible = (await list(s, "reviewer")).items[0];
      expect(
        (
          await clients.writer.get(
            `${base}/ai-tasks/${visible.generationTaskId}`,
          )
        ).status(),
      ).toBe(404);
      expect(
        (
          await clients.writer.patch(`${base}/ingest-runs/${visible.id}`, {
            data: { action: "retry" },
          })
        ).status(),
      ).toBe(404);
    });
    test("자동 설정으로 중지한 작업을 직원이 재시도하면 수동 실행으로 이어가고 이력을 남긴다", async () => {
      const s = await seed("자동정리 설정 중지");
      await settings(s, { autoIngest: true });
      await expect
        .poll(async () => (await list(s)).items[0]?.analysisTaskId, {
          timeout: 15000,
        })
        .toBeTruthy();
      const before = (await list(s)).items[0];
      expect(before.origin).toBe("automatic");
      await settings(s, { autoIngest: false });
      const canceled = await wait(s, "canceled");
      const repeated = await run(s);
      expect(repeated.id).toBe(canceled.id);
      const retried = await clients.writer.patch(
        `${base}/ingest-runs/${canceled.id}`,
        { data: { action: "retry" } },
      );
      expect(retried.status(), await retried.text()).toBe(200);
      const done = await wait(s);
      expect(done.id).toBe(before.id);
      expect(done.origin).toBe("manual");
      expect(done.analysisTaskId).toBe(before.analysisTaskId);
      expect((await list(s)).enabled).toBe(false);
      const audit = await pool.query(
        "SELECT actor_id,details FROM operations_event WHERE workspace_id=$1 AND action='ingest-retry' AND details->>'runId'=$2",
        [f.workspaceId, done.id],
      );
      expect(audit.rows).toEqual([
        {
          actor_id: writer.id,
          details: { runId: done.id, previousOrigin: "automatic" },
        },
      ]);
    });
    test("새 정리 동시 요청과 작업자 재시작에도 분석·생성 작업을 한 번만 연결한다", async () => {
      const s = await seed("자동정리 연결 복구");
      await stop();
      try {
        const requests = await Promise.all(
          Array.from({ length: 8 }, () => run(s)),
        );
        expect(new Set(requests.map((r) => r.id)).size).toBe(1);
        expect(requests.filter((r) => !r.replay)).toHaveLength(1);
        expect(await countCalls(s)).toBe(0);
        await start();
        await expect
          .poll(async () => (await list(s)).items[0]?.analysisTaskId, {
            timeout: 15000,
          })
          .toBeTruthy();
        await stop();
        await start();
        const done = await wait(s);
        expect(done.id).toBe(requests[0].id);
        const tasks = await pool.query(
          "SELECT kind,count(*)::int AS n FROM ai_task WHERE ingest_run_id=$1 GROUP BY kind ORDER BY kind",
          [done.id],
        );
        expect(tasks.rows).toEqual([
          { kind: "analysis", n: 1 },
          { kind: "wiki-generation", n: 1 },
        ]);
        expect(await countCalls(s)).toBe(4);
        expect(done.groups).toHaveLength(1);
      } finally {
        if (!worker) await start();
      }
    });
    test("모바일 공식 관리 폼에서 자동 설정을 켜고 끄며 생략한 API 수정은 저장값을 보존한다", async ({
      browser,
    }) => {
      const s = await seed("자동정리 모바일 설정");
      const context = await browser.newContext({
        storageState: await clients.admin.storageState(),
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await page.goto(`${root}/admin`);
        const detail = page
          .locator("details")
          .filter({ has: page.locator("summary").filter({ hasText: s.title }) })
          .first();
        await detail.locator("summary").first().click();
        const checkbox = detail.getByRole("checkbox", {
          name: "공개 자료 자동 정리",
        });
        await expect(checkbox).not.toBeChecked();
        await checkbox.check();
        await detail.getByRole("button", { name: "저장", exact: true }).click();
        await expect(detail.getByRole("status")).toHaveText("저장했습니다.");
        await expect(
          detail.getByRole("button", { name: "저장", exact: true }),
        ).toBeEnabled();
        const saved = await clients.admin.patch(
          `${base}/domains/${s.domainId}`,
          {
            data: {
              name: s.title,
              purpose: "수동 변경 시 자동 설정 보존",
              terms: [],
              recordTemplate: "상황·결과",
            },
          },
        );
        expect(saved.status(), await saved.text()).toBe(200);
        await page.reload();
        await detail.locator("summary").first().click();
        await expect(checkbox).toBeChecked();
        await checkbox.uncheck();
        await detail.getByRole("button", { name: "저장", exact: true }).click();
        await expect(detail.getByRole("status")).toHaveText("저장했습니다.");
        await expect(
          detail.getByRole("button", { name: "저장", exact: true }),
        ).toBeEnabled();
        expect((await list(s)).enabled).toBe(false);
        expect(errors).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        ).toBe(0);
      } finally {
        await context.close();
      }
    });
    test("분석 응답 대기 중 추출 정보가 바뀌면 이전 분석의 저장·조회와 생성을 막는다", async () => {
      const s = await seed("자동정리 지연 추출 변경");
      const r = await run(s);
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT a.id FROM ai_step a JOIN ai_task t ON t.id=a.task_id WHERE t.ingest_run_id=$1 AND a.kind='analyze' AND a.state='running'",
                [r.id],
              )
            ).rows.length,
          { timeout: 15000, intervals: [100, 200] },
        )
        .toBe(1);
      await pool.query(
        "UPDATE source_version SET parser_version='ingest-test-v2' WHERE id=$1",
        [s.versionId],
      );
      const ids = (
        await pool.query("SELECT id FROM ai_task WHERE ingest_run_id=$1", [
          r.id,
        ])
      ).rows;
      for (const { id } of ids) {
        const current = await task(id);
        expect(current.current).toBe(false);
        expect(current.result).toBeNull();
        expect(
          current.steps.every((s) => s.input === null && s.result === null),
        ).toBe(true);
      }
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT state FROM ai_task WHERE ingest_run_id=$1",
                [r.id],
              )
            ).rows[0].state,
        )
        .toMatch(/failed|canceled/);
      expect((await list(s)).items[0].state).toBe("outdated");
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM change_batch b JOIN ai_task t ON t.id=b.task_id WHERE t.ingest_run_id=$1",
            [r.id],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    test("분석 캐시를 재사용한 뒤 최초 작성자의 권한이 철회되면 분석과 검토안도 차단한다", async () => {
      let s = await seed("자동정리 캐시 최초 권한 재검증");
      await run(s);
      await wait(s);
      s = await revise(s, s.texts);
      await run(s, "reviewer");
      const current = await wait(s, "review", "reviewer");
      expect(current.reusedUnits).toBeGreaterThan(0);
      try {
        await pool.query(
          "UPDATE membership SET is_active=false WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, writer.id],
        );
        for (const id of [current.analysisTaskId, current.generationTaskId]) {
          const hidden = await task(id ?? "", "reviewer");
          expect(hidden.current).toBe(false);
          expect(hidden.result).toBeNull();
        }
        const hidden = await clients.reviewer.get(
          `${base}/proposals/${current.groups[0].id}`,
        );
        expect(hidden.status()).toBe(200);
        expect((await hidden.json()).batch.items).toEqual([]);
        const submitted = await clients.reviewer.post(
          `${base}/proposals/${current.groups[0].id}/action`,
          { data: { action: "submit" } },
        );
        expect(submitted.status(), await submitted.text()).toBe(409);
      } finally {
        await pool.query(
          "UPDATE membership SET is_active=true WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, writer.id],
        );
      }
    });
    test("실제 파일 등록·추출·공개 승인을 자동 위키 생성으로 연결하고 동일 파일을 재사용한다", async () => {
      const created = await clients.admin.post(`${base}/domains`, {
        data: {
          name: "자동정리 파일 등록",
          purpose: "원문 갱신 조건 확인",
          terms: [],
          recordTemplate: "상황·결과",
          autoIngest: true,
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const domainId = (await created.json()).id;
      const bytes = Buffer.from(
        "# 관제 화면\n\n관제 화면은 30초마다 갱신합니다. 일반 화면에 일괄 적용하지 않습니다.\n\n비상 전원은 8시간 유지합니다.\n",
        "utf8",
      );
      const upload = () =>
        clients.writer.post(`${base}/sources`, {
          multipart: {
            title: "자동정리 실제 파일",
            domainId,
            projectId: "",
            category: "guideline",
            file: {
              name: "ingest.md",
              mimeType: "text/markdown",
              buffer: bytes,
            },
          },
        });
      const uploaded = await upload();
      expect(uploaded.status(), await uploaded.text()).toBe(201);
      const saved = await uploaded.json();
      const s: Source = {
        id: saved.sourceId,
        versionId: saved.versionId,
        domainId,
        projectId: "",
        title: "자동정리 실제 파일",
        texts: [],
        chunks: [],
      };
      await expect
        .poll(
          async () =>
            (await (await clients.writer.get(`${base}/sources/${s.id}`)).json())
              .version.processing,
          { timeout: 15000 },
        )
        .toBe("completed");
      expect((await list(s)).items).toEqual([]);
      expect(
        (
          await clients.reviewer.post(
            `${base}/source-versions/${s.versionId}/action`,
            { data: { action: "approve" } },
          )
        ).status(),
      ).toBe(200);
      const result = await wait(s);
      expect(result.origin).toBe("automatic");
      const duplicate = await upload();
      expect(duplicate.status()).toBe(201);
      expect((await duplicate.json()).versionId).toBe(s.versionId);
      const calls = await countCalls(s);
      expect((await run(s)).id).toBe(result.id);
      expect(await countCalls(s)).toBe(calls);
    });
  });
}
