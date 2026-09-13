import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";
import { computeContextBudget } from "../src/lib/context-budget";
import {
  analysisMessages,
  integrateAnalyses,
  messageChars,
  splitSourceIntoSemanticUnits,
  type UnitAnalysis,
  validateUnitAnalysis,
} from "../src/lib/document-analysis";

type Fixture = {
  workspaceId: string;
  domainId: string;
  accounts: { id: string; role: string }[];
};
export function registerDocumentAnalysisTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("10단계 문서 전체 분석", () => {
    const context = {
      sourceTitle: "경계 표본",
      sourceVersionId: randomUUID(),
      category: "guideline",
      domain: {
        purpose: "정확한 조건",
        terms: [{ term: "관제", definition: "화면 확인" }],
        recordTemplate: "사실\n예외",
      },
    };
    const makeChunk = (text: string) => ({
      id: randomUUID(),
      text,
      locator: {
        kind: "lines" as const,
        startLine: 1,
        endLine: text.split("\n").length,
        heading: "",
      },
    });
    test("긴 문단·표·각주·코드와 유니코드를 문자 손실 없이 나누고 예산을 지킨다", () => {
      const chunks = [
        makeChunk(
          `# 제어 시스템\r\n\r\n${'원문 😀 따옴표 "와 역슬래시 \\를 보존합니다. '.repeat(1900)}\r\n## 요구 조건\r\n| 대상 | 갱신 |\r\n| --- | --- |\r\n${"| 관제 화면 | 30초 |\r\n".repeat(1800)}\r\n[^1]: 통신이 끊기면 갱신하지 않습니다.\r\n\n\`\`\`sql\nCREATE TABLE test(id int PRIMARY KEY);\n\`\`\`\n`,
        ),
        makeChunk("후속 절의 마지막 조건은 8시간입니다."),
        makeChunk(""),
      ];
      const plan = splitSourceIntoSemanticUnits(chunks, context, 12000);
      expect(plan.units.length).toBeGreaterThan(10);
      const parts = plan.units.flatMap((u) => u.parts);
      for (const c of chunks) {
        const pieces = parts.filter((p) => p.chunkId === c.id);
        expect(pieces.map((p) => p.text).join("")).toBe(c.text);
        let end = 0;
        for (const p of pieces) {
          expect(p.start).toBe(end);
          expect(p.text).toBe(c.text.slice(p.start, p.end));
          expect(p.text.isWellFormed()).toBe(true);
          end = p.end;
        }
        expect(end).toBe(c.text.length);
      }
      for (const u of plan.units) {
        expect(messageChars(analysisMessages(context, u))).toBeLessThanOrEqual(
          plan.inputLimit,
        );
        expect(u.contextBefore.isWellFormed()).toBe(true);
      }
      expect(
        parts
          .filter((p) => p.structure === "table")
          .every((p) => p.structureContext.includes("대상 | 갱신")),
      ).toBe(true);
      expect(
        parts.find((p) => p.text.includes("CREATE TABLE"))?.structure,
      ).toBe("code");
      expect(parts.at(-1)?.headingPath).toBe("제어 시스템 > 요구 조건");
      expect(plan.excluded).toEqual([
        { chunkId: chunks[2].id, reason: "추출된 텍스트가 비어 있습니다." },
      ]);
      expect(plan.totalChars).toBe(
        chunks.reduce((n, c) => n + c.text.length, 0),
      );
      const continued = splitSourceIntoSemanticUnits(
        [
          makeChunk(
            "# 공유 절\n| 대상 | 주기 |\n| --- | --- |\n| 화면 A | 30초 |\n",
          ),
          makeChunk("| 화면 B | 60초 |\n"),
          makeChunk("\n```sql\nCREATE TABLE t("),
          makeChunk("id int PRIMARY KEY);\n```\n"),
        ],
        context,
        48000,
      ).units.flatMap((u) => u.parts);
      expect(
        continued.find((p) => p.text.includes("화면 B"))?.structureContext,
      ).toContain("대상 | 주기");
      expect(continued.find((p) => p.text.includes("id int"))?.structure).toBe(
        "code",
      );
    });
    test("부정·수치·단위·대상·인용과 구간 누락을 검증하고 조건 비교를 보존한다", () => {
      const chunk = makeChunk(
        "관제 화면은 30초마다 갱신합니다. 일반 화면에는 적용하지 않습니다.",
      );
      const unit = splitSourceIntoSemanticUnits([chunk], context, 48000)
        .units[0];
      const data: UnitAnalysis = {
        summary: "조건",
        claims: [
          {
            kind: "requirement",
            subject: "관제 화면",
            predicate: "갱신 간격",
            text: chunk.text,
            polarity: "negated",
            value: "30",
            unit: "초",
            condition: "일반 화면에는 적용하지 않습니다.",
            evidence: [
              {
                partId: unit.parts[0].id,
                chunkId: chunk.id,
                quote: chunk.text,
              },
            ],
          },
        ],
        parts: [
          { partId: unit.parts[0].id, status: "analyzed", reason: "조건 확인" },
        ],
        questions: [],
      };
      expect(validateUnitAnalysis(data, unit)).toEqual(data);
      for (const [patch, message] of [
        [{ text: "300초마다 갱신합니다." }, "수치"],
        [{ unit: "분" }, "단위"],
        [
          {
            text: "관제 화면은 30분마다 갱신합니다. 일반 화면에는 적용하지 않습니다.",
            unit: null,
          },
          "단위 조합",
        ],
        [{ subject: "다른 장비" }, "적용 대상"],
        [{ text: "관제 화면은 30초마다 갱신합니다." }, "부정"],
        [{ condition: "모든 프로젝트" }, "조건"],
      ] as const) {
        const changed = structuredClone(data);
        Object.assign(changed.claims[0], patch);
        expect(() => validateUnitAnalysis(changed, unit)).toThrow(message);
      }
      const bad = structuredClone(data);
      bad.claims[0].evidence[0].quote = "원문에 없는 구절";
      expect(() => validateUnitAnalysis(bad, unit)).toThrow("인용 구절");
      expect(() =>
        validateUnitAnalysis({ ...data, parts: [] }, unit),
      ).toThrow();
      const other = structuredClone(data);
      other.claims[0].value = "60";
      const combined = integrateAnalyses(
        [unit, { ...unit, id: "unit-2" }],
        [data, other],
      );
      expect(combined.claims).toHaveLength(2);
      expect(combined.comparisons).toHaveLength(1);
      expect(
        combined.claims.every((c) => c.condition === data.claims[0].condition),
      ).toBe(true);
      expect(() => integrateAnalyses([unit], [])).toThrow("완료하지 않은");
      const affirmative = makeChunk("비상 전원은 8시간 동안 유지해야 합니다.");
      const affirmativeUnit = splitSourceIntoSemanticUnits(
        [affirmative],
        context,
        48000,
      ).units[0];
      const positive = structuredClone(data);
      Object.assign(positive.claims[0], {
        subject: "비상 전원",
        text: affirmative.text,
        polarity: "affirmed",
        value: "8",
        unit: "시간",
        condition: null,
        evidence: [
          {
            partId: affirmativeUnit.parts[0].id,
            chunkId: affirmative.id,
            quote: affirmative.text,
          },
        ],
      });
      positive.parts[0].partId = affirmativeUnit.parts[0].id;
      expect(validateUnitAnalysis(positive, affirmativeUnit)).toEqual(positive);
      const mislabeled = structuredClone(data);
      mislabeled.claims[0].polarity = "affirmed";
      expect(validateUnitAnalysis(mislabeled, unit).claims[0].polarity).toBe(
        "negated",
      );
      const unrelated = makeChunk(
        "이 문서는 실제 사업과 무관한 가상 평가 자료입니다.",
      );
      const unrelatedUnit = splitSourceIntoSemanticUnits(
        [unrelated],
        context,
        48000,
      ).units[0];
      Object.assign(positive.claims[0], {
        subject: "이 문서",
        text: unrelated.text,
        value: null,
        unit: null,
        evidence: [
          {
            partId: unrelatedUnit.parts[0].id,
            chunkId: unrelated.id,
            quote: unrelated.text,
          },
        ],
      });
      positive.parts[0].partId = unrelatedUnit.parts[0].id;
      expect(
        validateUnitAnalysis(positive, unrelatedUnit).claims[0].polarity,
      ).toBe("negated");
      const mixed = makeChunk(
        "장비 A는 30초마다 갱신합니다. 장비 B는 60초마다 갱신합니다.",
      );
      const mixedUnit = splitSourceIntoSemanticUnits([mixed], context, 48000)
        .units[0];
      Object.assign(positive.claims[0], {
        subject: "장비 B",
        text: "장비 A는 30초마다 갱신합니다.",
        polarity: "affirmed",
        evidence: [
          {
            partId: mixedUnit.parts[0].id,
            chunkId: mixed.id,
            quote: "장비 A는 30초마다 갱신합니다.",
          },
        ],
      });
      positive.parts[0].partId = mixedUnit.parts[0].id;
      const checked = validateUnitAnalysis(positive, mixedUnit);
      expect(checked.claims[0].subject).toBe("");
      expect(checked.questions.some((q) => q.includes("장비 B"))).toBe(true);
    });
    test("규칙이 입력 공간을 차지하면 일부만 분석한 성공으로 바꾸지 않는다", () => {
      expect(computeContextBudget(1000)).toMatchObject({
        maxCtx: 1000,
        responseReserve: 150,
        pageBudget: 500,
        maxPageSize: 500,
      });
      expect(() =>
        splitSourceIntoSemanticUnits(
          [makeChunk("원문")],
          { ...context, domain: { purpose: "설명".repeat(5000) } },
          4000,
        ),
      ).toThrow("입력 공간");
    });
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const base = `/api/workspaces/${f.workspaceId}`,
      root = `/w/${f.workspaceId}`;
    let worker: ChildProcess | undefined,
      first = "";
    const ids = {
      source: randomUUID(),
      version: randomUUID(),
      chunks: [] as string[],
    };
    async function start() {
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
    async function stop() {
      if (!worker || worker.exitCode !== null || worker.signalCode !== null)
        return;
      const exited = new Promise<void>((resolve) =>
        worker?.once("exit", () => resolve()),
      );
      worker.kill("SIGTERM");
      await exited;
      worker = undefined;
    }
    async function seed(
      title: string,
      texts: string[],
      sourceId = randomUUID(),
      versionId = randomUUID(),
    ) {
      const writer = f.accounts.find((a) => a.role === "writer");
      if (!writer) throw new Error("계정 없음");
      await pool.query(
        "INSERT INTO source(id,workspace_id,domain_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,'guideline',$5,$6,$6,1)",
        [sourceId, f.workspaceId, f.domainId, title, writer.id, versionId],
      );
      await pool.query(
        "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing,warnings) VALUES($1,$2,$3,1,'analysis.md','text/markdown',$4,$4,$5,$6,'published','completed',$7)",
        [
          versionId,
          f.workspaceId,
          sourceId,
          randomUUID(),
          texts.join("").length,
          writer.id,
          JSON.stringify(["이미지 속 문자는 분석하지 않았습니다."]),
        ],
      );
      const chunkIds = [];
      for (const [i, text] of texts.entries()) {
        const id = randomUUID();
        chunkIds.push(id);
        await pool.query(
          "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id,
            f.workspaceId,
            versionId,
            i,
            text,
            {
              kind: "lines",
              startLine: i * 10 + 1,
              endLine: i * 10 + 10,
              heading: "",
            },
          ],
        );
      }
      return { source: sourceId, version: versionId, chunks: chunkIds };
    }
    async function create(sourceId: string) {
      const r = await clients.writer.post(`${base}/ai-tasks`, {
        data: { sourceId, requestId: randomUUID(), kind: "analysis" },
      });
      expect(r.status()).toBe(201);
      return r.json();
    }
    async function info(id: string) {
      const r = await clients.writer.get(`${base}/ai-tasks/${id}`);
      expect(r.status()).toBe(200);
      return r.json();
    }
    async function wait(id: string, state: string) {
      await expect
        .poll(async () => (await info(id)).state, {
          timeout: 40000,
          intervals: [200, 400, 800],
        })
        .toBe(state);
      return info(id);
    }
    test.beforeAll(async () => {
      const seeded = await seed(
        "구간실패 긴 문서",
        [
          ...Array.from(
            { length: 6 },
            (_, i) =>
              `# 운영 구간 ${i + 1}\n${"설치 장소의 조건을 확인하고 기록합니다. ".repeat(800)}\n관제 화면의 핵심 조건은 30초입니다. 모든 화면에 일괄 적용하지 않습니다.\n`,
          ),
          "## 마지막 표와 각주\n| 대상 | 조건 |\n| --- | --- |\n| 보조 화면 | 90초 |\n\n[^1]: 통신 단절 상태에서는 자동 갱신을 금지합니다.",
        ],
        ids.source,
        ids.version,
      );
      ids.chunks = seeded.chunks;
    });
    test.afterAll(async () => {
      await stop();
      await pool.end();
    });
    test("중간 실패를 부분 결과로 표시하고 완료 구간과 원문 위치를 보존한다", async ({
      page,
    }) => {
      await start();
      first = (await create(ids.source)).id;
      const failed = await wait(first, "failed");
      expect(failed.result).toBeNull();
      const units = failed.steps.filter(
        (s: { kind: string }) => s.kind === "analyze",
      );
      expect(units.length).toBeGreaterThan(3);
      expect(units[0].state).toBe("completed");
      expect(units[1].state).toBe("failed");
      expect(
        units.slice(2).every((s: { state: string }) => s.state === "pending"),
      ).toBe(true);
      await page
        .context()
        .addCookies((await clients.writer.storageState()).cookies);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${root}/ai-tasks/${first}`);
      await expect(
        page.getByText("부분 결과 · 전체 분석 미완료", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("이미지 속 문자는 분석하지 않았습니다.", {
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "test-results/10-analysis-partial-mobile.png",
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "완료한 단계부터 재시도", exact: true })
        .click();
    });
    test("재시도는 실패 구간부터 이어 문서 끝·표·각주를 포함해 통합한다", async ({
      page,
    }) => {
      const done = await wait(first, "completed");
      const units = done.steps.filter(
        (s: { kind: string }) => s.kind === "analyze",
      );
      expect(units[0].attempts).toBe(1);
      expect(units[1].attempts).toBe(2);
      expect(
        units.slice(2).every((s: { attempts: number }) => s.attempts === 1),
      ).toBe(true);
      expect(done.result.coverage).toMatchObject({
        totalChunks: 7,
        processedChunks: 7,
        totalUnits: units.length,
        processedUnits: units.length,
        excluded: [],
      });
      expect(done.result.coverage.processedChars).toBe(
        done.result.coverage.totalChars,
      );
      expect(done.usage).toHaveLength(units.length + 1);
      const claims = JSON.stringify(done.result.claims);
      expect(claims).toContain("90초");
      expect(claims).toContain("자동 갱신을 금지");
      expect(
        new Set(
          done.result.claims.flatMap((c: { evidence: { chunkId: string }[] }) =>
            c.evidence.map((e) => e.chunkId),
          ),
        ),
      ).toEqual(new Set(ids.chunks));
      await page
        .context()
        .addCookies((await clients.writer.storageState()).cookies);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${root}/ai-tasks/${first}`);
      await expect(
        page.getByText("전체 분석 완료", { exact: true }),
      ).toBeVisible();
      await page
        .locator(".analysis-unit")
        .last()
        .locator(":scope > summary")
        .click();
      await expect(
        page.getByRole("link", { name: /원문 구절 확인/ }).last(),
      ).toHaveAttribute("href", new RegExp(ids.chunks.at(-1) as string));
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "test-results/10-analysis-complete-mobile.png",
        fullPage: true,
      });
      await pool.query(
        "UPDATE source SET published_version_id=NULL WHERE id=$1",
        [ids.source],
      );
      const hidden = await info(first);
      expect(hidden.result).toBeNull();
      expect(
        hidden.steps.every(
          (s: { input: unknown; result: unknown }) =>
            s.input === null && s.result === null,
        ),
      ).toBe(true);
      await pool.query(
        "UPDATE source SET published_version_id=$2 WHERE id=$1",
        [ids.source, ids.version],
      );
    });
    test("수치·단위·대상·부정·근거·처리 범위 변조는 통합을 차단하고 호출 사용량을 남긴다", async () => {
      test.setTimeout(60000);
      for (const [title, message] of [
        ["분석수치변조", "수치"],
        ["분석단위변조", "단위"],
        ["분석대상변조", "적용 대상"],
        ["분석부정변조", "부정"],
        ["분석근거변조", "원문 ID"],
        ["분석범위누락", "구조화 분석"],
      ]) {
        const source = await seed(title, [
          "관제 화면은 30초마다 갱신합니다. 일반 화면에는 적용하지 않습니다.",
        ]);
        const failed = await wait((await create(source.source)).id, "failed");
        expect(failed.errorMessage).toContain(message);
        expect(failed.result).toBeNull();
        expect(failed.usage).toEqual([
          {
            inputTokens: 120,
            outputTokens: 40,
            state: "failed",
            model: "test-knowledge",
          },
        ]);
        expect(
          failed.steps.find((s: { kind: string }) => s.kind === "integrate")
            .state,
        ).toBe("pending");
      }
    });
    test("프롬프트 기준이 바뀐 대기 분석은 이전 결과와 섞어 재개하지 않는다", async () => {
      await stop();
      const id = (await create(ids.source)).id;
      await pool.query(
        "UPDATE ai_task SET prompt_version='obsolete' WHERE id=$1",
        [id],
      );
      await start();
      const failed = await wait(id, "failed");
      expect(failed.errorMessage).toContain("프롬프트 기준");
      expect(failed.usage).toHaveLength(0);
      expect(
        (
          await clients.writer.patch(`${base}/ai-tasks/${id}`, {
            data: { action: "retry" },
          })
        ).status(),
      ).toBe(409);
    });
    test("장문 추출 프로세스는 큰 결과를 전부 전달한 뒤 종료한다", async () => {
      const text = "장문 전달을 확인하는 개발 표본입니다. ".repeat(4000);
      const uploaded = await clients.writer.post(`${base}/sources`, {
        multipart: {
          title: "장문 전달 표본",
          domainId: f.domainId,
          category: "reference",
          file: {
            name: "large-ipc.md",
            mimeType: "text/markdown",
            buffer: Buffer.from(text),
          },
        },
      });
      expect(uploaded.status()).toBe(201);
      const source = await uploaded.json();
      await expect
        .poll(
          async () => {
            const r = await clients.writer.get(
              `${base}/sources/${source.sourceId}?version=${source.versionId}`,
            );
            return (await r.json()).version.processing;
          },
          { timeout: 15000 },
        )
        .toBe("completed");
      const d = await (
        await clients.writer.get(
          `${base}/sources/${source.sourceId}?version=${source.versionId}`,
        )
      ).json();
      expect(d.chunks.map((c: { text: string }) => c.text).join("")).toBe(
        text.trim(),
      );
    });
  });
}
