import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";
import { emptyPurposeGuide } from "../src/lib/domain-purpose";
import {
  parseQualityOutput,
  type QualitySnapshot,
  qualityMessages,
  qualityPlan,
  structuralQuality,
} from "../src/lib/quality";
import type { qualityOverview } from "../src/server/services/quality";

type Data = Awaited<ReturnType<typeof qualityOverview>>;
type Fixture = {
  workspaceId: string;
  outsiderDomainId: string;
  accounts: { id: string; role: string }[];
};
export function registerQualityTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("14단계 품질 점검과 검토", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL }),
      base = `/api/workspaces/${f.workspaceId}`;
    const writer = f.accounts.find((a) => a.role === "writer")?.id as string;
    const reviewer = f.accounts.find((a) => a.role === "reviewer")
      ?.id as string;
    function job(which = "runNextQuality") {
      const child = spawn(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "--eval",
          `import('./src/server/jobs/quality.ts').then(async m=>{await m.${which}(); const {getPool}=await import('./src/server/db/index.ts');await getPool().end();}).catch(e=>{console.error(e.message);process.exit(1)})`,
        ],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stderr.on("data", (c) => {
        output += c;
      });
      const done = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) =>
          code === 0 || signal ? resolve() : reject(new Error(output)),
        );
      });
      return { child, done };
    }
    async function seed(name = "품질 표본") {
      const domainId = randomUUID(),
        sourceId = randomUUID(),
        sourceVersionId = randomUUID(),
        chunkId = randomUUID(),
        a = randomUUID(),
        b = randomUUID(),
        av = randomUUID(),
        bv = randomUUID(),
        broken = randomUUID(),
        pa = randomUUID(),
        pb = randomUUID();
      await pool.query(
        "INSERT INTO domain(id,workspace_id,name,purpose,purpose_guide) VALUES($1,$2,$3,'조건과 예외의 검토',$4)",
        [
          domainId,
          f.workspaceId,
          name,
          {
            ...emptyPurposeGuide,
            keyQuestions: "장애 장비의 보관 예외는 어떻게 확인하나요?",
          },
        ],
      );
      await pool.query(
        "INSERT INTO project(id,workspace_id,domain_id,name,client_name) VALUES($1,$2,$3,'사업 갑','시험'),($4,$2,$3,'사업 을','시험')",
        [pa, f.workspaceId, domainId, pb],
      );
      await pool.query(
        "INSERT INTO source(id,workspace_id,domain_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,'품질 원문','reference',$4,$5,$5,1)",
        [sourceId, f.workspaceId, domainId, writer, sourceVersionId],
      );
      await pool.query(
        "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'quality.md','text/markdown',$4,$4,100,$5,'published','completed')",
        [sourceVersionId, f.workspaceId, sourceId, randomUUID(), writer],
      );
      await pool.query(
        "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,0,'정상 장비의 기록을 45일 보관합니다. 장애 장비에는 적용하지 않습니다.',$4)",
        [
          chunkId,
          f.workspaceId,
          sourceVersionId,
          { kind: "lines", startLine: 3, endLine: 5, heading: "검수 보관" },
        ],
      );
      const bodyA = `보완후보표본 정상 장비의 기록을 30일 보관합니다. 장애 장비에는 적용하지 않습니다.\n\n[기준](/w/${f.workspaceId}/wiki/${b})\n\n[없는 대상](/w/${f.workspaceId}/wiki/${broken})`;
      const bodyB =
        "정상 장비의 기록을 45일 보관합니다. 장애 장비에는 적용하지 않습니다.";
      for (const [id, version, title, body] of [
        [a, av, `${name} 보관 안내`, bodyA],
        [b, bv, `${name} 보관 기준`, bodyB],
      ]) {
        await pool.query(
          "INSERT INTO wiki_page(id,workspace_id,domain_id,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,$5,$5,1)",
          [id, f.workspaceId, domainId, writer, version],
        );
        await pool.query(
          "INSERT INTO wiki_version(id,workspace_id,page_id,number,title,body,author_id,state) VALUES($1,$2,$3,1,$4,$5,$6,'approved')",
          [version, f.workspaceId, id, title, body, writer],
        );
      }
      await pool.query(
        "INSERT INTO wiki_evidence(workspace_id,version_id,chunk_id) VALUES($1,$2,$3)",
        [f.workspaceId, bv, chunkId],
      );
      return {
        domainId,
        sourceId,
        sourceVersionId,
        chunkId,
        a,
        b,
        av,
        bv,
        broken,
        pa,
        pb,
        bodyA,
        bodyB,
      };
    }
    async function create(
      domainId: string,
      mode = "structural",
      projectId: string | null = null,
      force = true,
      requestId = randomUUID(),
    ) {
      const r = await clients.reviewer.post(`${base}/quality`, {
        data: { domainId, projectId, mode, requestId, force },
      });
      expect(r.status(), await r.text()).toBe(201);
      return r.json() as Promise<{
        id: string;
        state: string;
        replay: boolean;
      }>;
    }
    async function data(
      domainId: string,
      projectId: string | null = null,
    ): Promise<Data> {
      const r = await clients.reviewer.get(
        `${base}/quality?domainId=${domainId}${projectId ? `&projectId=${projectId}` : ""}`,
      );
      expect(r.status(), await r.text()).toBe(200);
      return r.json();
    }
    async function finished(id: string, state = "completed") {
      const r = await pool.query(
        "SELECT state,error_message FROM quality_run WHERE id=$1",
        [id],
      );
      expect(r.rows[0], JSON.stringify(r.rows)).toMatchObject({ state });
    }
    test.afterAll(async () => {
      await pool.end();
    });
    test("구조 검사는 코드 예시와 범위 밖의 실제 연결을 오해하지 않고 근거 상태를 나눈다", () => {
      const w = randomUUID(),
        a = randomUUID(),
        b = randomUUID(),
        outside = randomUUID(),
        missing = randomUUID();
      const snapshot: QualitySnapshot = {
        rules: { name: "시험", purpose: "조건" },
        knownPageIds: [a, b, outside],
        pages: [
          {
            id: a,
            versionId: randomUUID(),
            latestVersionId: randomUUID(),
            domainId: randomUUID(),
            projectId: null,
            title: "시작",
            body: `[정상](/w/${w}/wiki/${b}) [다른 범위](/w/${w}/wiki/${outside}) [없음](/w/${w}/wiki/${missing})\n\n\`[코드](/w/${w}/wiki/${randomUUID()})\``,
            state: "approved",
            evidence: [],
          },
          {
            id: b,
            versionId: randomUUID(),
            latestVersionId: randomUUID(),
            domainId: randomUUID(),
            projectId: null,
            title: "끝",
            body: "연결 없는 독립 안내문입니다.",
            state: "approved",
            evidence: [
              {
                id: randomUUID(),
                versionId: randomUUID(),
                chunkId: randomUUID(),
                title: "이전 원문",
                current: false,
                locator: {
                  kind: "lines",
                  startLine: 1,
                  endLine: 2,
                  heading: "",
                },
              },
            ],
          },
        ],
      };
      const found = structuralQuality(w, snapshot);
      expect(
        found.filter((f) => f.kind === "broken-link").map((f) => f.targetId),
      ).toEqual([missing]);
      expect(
        found.filter((f) => f.kind === "orphan").map((f) => f.pageIds[0]),
      ).toEqual([a]);
      expect(found.filter((f) => f.kind === "no-outlinks")[0].severity).toBe(
        "info",
      );
      expect(
        found.some((f) => f.kind === "no-evidence" && f.pageIds[0] === a),
      ).toBe(true);
      expect(
        found.some((f) => f.kind === "stale-evidence" && f.pageIds[0] === b),
      ).toBe(true);
    });
    test("AI 전 구간과 마지막 부정문을 보존하고 거짓 비교 구절·잘못된 목적 질문을 거부한다", () => {
      const body = `${'긴 설명 😀 "따옴표"와 역슬래시 \\를 보존합니다.\n'.repeat(1200)}끝 조건은 37분이며 장애 장비에는 적용하지 않습니다.`;
      const p = {
        id: randomUUID(),
        versionId: randomUUID(),
        latestVersionId: randomUUID(),
        domainId: randomUUID(),
        projectId: null,
        title: "장문",
        body,
        state: "approved",
        evidence: [],
      };
      const s: QualitySnapshot = {
        pages: [p],
        knownPageIds: [p.id],
        rules: {
          name: "시험",
          purpose: "부정문 유지",
          purposeGuide: {
            ...emptyPurposeGuide,
            keyQuestions: "장애 장비의 보관 예외는 어떻게 확인하나요?",
          },
        },
      };
      const plan = qualityPlan(randomUUID(), s, 12000);
      const units = plan.steps
        .filter((s) => s.comparison === "page")
        .flatMap((s) => s.units);
      expect(units.map((u) => u.text).join("")).toBe(body);
      expect(units.at(-1)?.text).toContain(
        "37분이며 장애 장비에는 적용하지 않습니다.",
      );
      for (const step of plan.steps) {
        expect(
          JSON.stringify(qualityMessages(step)).length,
        ).toBeLessThanOrEqual(12000);
        expect(step.units.every((u) => u.text.isWellFormed())).toBe(true);
      }
      const input = plan.steps.at(-1);
      if (!input) throw new Error("비교 구간 없음");
      const finding = {
        kind: "missing-explanation",
        severity: "info",
        title: "검토할 후보",
        note: "적용 대상과 예외를 실제 원문에서 검토합니다.",
        quotes: [
          {
            pageId: p.id,
            quote: "끝 조건은 37분이며 장애 장비에는 적용하지 않습니다.",
          },
        ],
      };
      const result = parseQualityOutput(
        JSON.stringify({ findings: [finding] }),
        input,
      );
      expect(body.slice(result[0].quotes[0].start)).toBe(
        finding.quotes[0].quote,
      );
      expect(() =>
        parseQualityOutput(
          JSON.stringify({
            findings: [
              {
                ...finding,
                quotes: [
                  { pageId: p.id, quote: "거짓으로 지어낸 조건은 38분입니다." },
                ],
              },
            ],
          }),
          input,
        ),
      ).toThrow("입력");
      expect(() =>
        parseQualityOutput(
          JSON.stringify({ findings: [{ ...finding, kind: "contradiction" }] }),
          input,
        ),
      ).toThrow("두 페이지");
      expect(() =>
        parseQualityOutput(
          JSON.stringify({
            findings: [
              {
                ...finding,
                kind: "purpose-gap",
                purposeQuestion: "없는 질문입니다",
              },
            ],
          }),
          input,
        ),
      ).toThrow("질문 원문");
      expect(() => qualityPlan(randomUUID(), s, 1000)).toThrow("목적");
    });
    test("직원 역할·작업공간·프로젝트 경계를 직접 API와 화면에 적용한다", async ({
      browser,
    }) => {
      const s = await seed();
      for (const role of ["reader", "writer", "outsider"]) {
        expect(
          (
            await clients[role].get(`${base}/quality?domainId=${s.domainId}`)
          ).status(),
        ).toBe(role === "outsider" ? 404 : 403);
        expect(
          (
            await clients[role].post(`${base}/quality`, {
              data: { domainId: s.domainId, requestId: randomUUID() },
            })
          ).status(),
        ).toBe(role === "outsider" ? 404 : 403);
      }
      expect(
        (
          await clients.admin.get(`${base}/quality?domainId=${s.domainId}`)
        ).status(),
      ).toBe(200);
      expect(
        (
          await clients.reviewer.get(
            `${base}/quality?domainId=${f.outsiderDomainId}`,
          )
        ).status(),
      ).toBe(404);
      const second = await seed("다른 범위");
      expect(
        (
          await clients.reviewer.post(`${base}/quality`, {
            data: {
              domainId: s.domainId,
              projectId: second.pa,
              requestId: randomUUID(),
            },
          })
        ).status(),
      ).toBe(404);
      const context = await browser.newContext({
        storageState: await clients.reader.storageState(),
      });
      const page = await context.newPage();
      expect(
        (
          await page.goto(`/w/${f.workspaceId}/quality?domainId=${s.domainId}`)
        )?.status(),
      ).toBe(404);
      await context.close();
    });
    test("동시 요청·동시 작업자는 한 번만 점검하고 같은 요청 ID의 범위 변경을 거부한다", async () => {
      const s = await seed("동시 점검");
      const requestId = randomUUID();
      const runs = await Promise.all([
        create(s.domainId, "structural", null, true, requestId),
        create(s.domainId, "structural", null, true, requestId),
      ]);
      expect(runs[0].id).toBe(runs[1].id);
      await Promise.all([job().done, job().done]);
      await finished(runs[0].id);
      const d = await data(s.domainId);
      expect(d.findings.map((f) => f.kind).sort()).toEqual(
        ["broken-link", "no-evidence", "no-outlinks", "orphan"].sort(),
      );
      expect((await create(s.domainId, "structural", null, false)).id).toBe(
        runs[0].id,
      );
      expect(
        (
          await clients.reviewer.post(`${base}/quality`, {
            data: { domainId: s.domainId, projectId: s.pa, requestId },
          })
        ).status(),
      ).toBe(409);
      const desk = await (
        await clients.reviewer.get(`${base}/review-desk?kind=quality`)
      ).json();
      expect(
        desk.targets.some((x: { id: string }) => x.id === d.findings[0].id),
      ).toBe(true);
    });
    test("AI 비교·Purpose 후보는 실제 구절과 버전·사용량을 저장하고 원문은 유지한다", async () => {
      const s = await seed("의미 조건");
      const run = await create(s.domainId, "semantic");
      await job().done;
      await finished(run.id);
      const d = await data(s.domainId);
      const conflict = d.findings.find((f) => f.kind === "contradiction");
      expect(conflict?.quotes.map((q) => q.pageId).sort()).toEqual(
        [s.a, s.b].sort(),
      );
      expect(conflict?.quotes.some((q) => q.quote.includes("30일"))).toBe(true);
      expect(conflict?.quotes.some((q) => q.quote.includes("45일"))).toBe(true);
      expect(
        d.findings.some(
          (f) =>
            f.kind === "purpose-gap" &&
            f.purpose_question?.includes("장애 장비"),
        ),
      ).toBe(true);
      const calls = await pool.query(
        "SELECT g.* FROM quality_step s JOIN generation g ON g.id=s.generation_id WHERE s.run_id=$1",
        [run.id],
      );
      expect(calls.rows.length).toBe(3);
      expect(
        calls.rows.every(
          (r) =>
            r.kind === "wiki-quality" &&
            r.model === "test-knowledge" &&
            r.input_tokens === 120 &&
            r.output_tokens === 40 &&
            r.state === "completed",
        ),
      ).toBe(true);
      expect(
        (await pool.query("SELECT body FROM wiki_version WHERE id=$1", [s.av]))
          .rows[0].body,
      ).toBe(s.bodyA);
      const api = await clients.reviewer.get(
        `${base}/quality?domainId=${s.domainId}`,
      );
      expect(await api.text()).not.toContain("snapshot");
    });
    test("계약에 맞지 않는 AI 구절은 후보로 저장하지 않고 사용량과 실패를 남긴다", async () => {
      const s = await seed("품질거짓구절");
      const run = await create(s.domainId, "semantic");
      await job().done;
      await finished(run.id, "failed");
      expect((await data(s.domainId)).findings).toEqual([]);
      const calls = await pool.query(
        "SELECT g.state,g.input_tokens FROM quality_step s JOIN generation g ON g.id=s.generation_id WHERE s.run_id=$1",
        [run.id],
      );
      expect(calls.rows).toEqual([{ state: "failed", input_tokens: 120 }]);
    });
    test("프로젝트별 조건 차이는 비교하지 않으며 다른 범위의 실제 링크를 끊긴 링크로 등록하지 않는다", async () => {
      const s = await seed("프로젝트 분리");
      await pool.query(
        "UPDATE wiki_page SET project_id=CASE WHEN id=$1 THEN $3::uuid ELSE $4::uuid END WHERE id=ANY($2::uuid[])",
        [s.a, [s.a, s.b], s.pa, s.pb],
      );
      const run = await create(s.domainId, "semantic");
      await job().done;
      await finished(run.id);
      expect(
        (await data(s.domainId)).findings.some(
          (f) => f.kind === "contradiction",
        ),
      ).toBe(false);
      const scoped = await create(s.domainId, "structural", s.pa);
      await job().done;
      await finished(scoped.id);
      const d = await data(s.domainId, s.pa);
      expect(d.pages.map((p) => p.id)).toEqual([s.a]);
      expect(
        d.findings
          .filter((f) => f.kind === "broken-link")
          .map((f) => f.target_id),
      ).toEqual([s.broken]);
    });
    test("담당·보류 사유·해결·재발을 같은 항목의 이력으로 관리한다", async () => {
      const s = await seed("처리 이력");
      const run = await create(s.domainId);
      await job().done;
      await finished(run.id);
      const target = (await data(s.domainId)).findings.find(
        (f) => f.kind === "no-evidence",
      );
      if (!target) throw new Error("근거 없는 페이지 후보 없음");
      const action = (action: string, note = "", extra = {}) =>
        clients.reviewer.post(`${base}/review-desk`, {
          data: {
            kind: "quality",
            targetId: target.id,
            action,
            note,
            ...extra,
          },
        });
      expect(
        (
          await action("assign", "검토 담당 지정", { assigneeId: reviewer })
        ).status(),
      ).toBe(201);
      expect((await action("defer")).status()).toBe(400);
      expect((await action("defer", "원문 확보를 기다립니다.")).status()).toBe(
        201,
      );
      expect(
        (
          await action("resolve", "독립 안내문으로 유지하기로 검토했습니다.")
        ).status(),
      ).toBe(201);
      const rerun = await create(s.domainId);
      await job().done;
      await finished(rerun.id);
      const again = (await data(s.domainId)).findings.find(
        (f) => f.id === target.id,
      );
      if (!again) throw new Error("재발 후보 없음");
      expect(again.state).toBe("open");
      expect(again.occurrences).toBe(2);
      expect(again.assignee_name).toContain("reviewer");
      const events = await pool.query(
        "SELECT action FROM review_event WHERE kind='quality' AND target_id=$1 ORDER BY created_at",
        [target.id],
      );
      expect(events.rows.map((e) => e.action)).toEqual([
        "detected",
        "assign",
        "defer",
        "resolve",
        "recurred",
      ]);
    });
    test("공식 수정 변경안·게시 검토 후 구조 재점검으로 해결하고 개정 전 판정을 차단한다", async () => {
      const s = await seed("게시 수정");
      const run = await create(s.domainId);
      await job().done;
      await finished(run.id);
      const before = await data(s.domainId),
        noEvidence = before.findings.find((f) => f.kind === "no-evidence");
      if (!noEvidence) throw new Error("근거 없는 페이지 후보 없음");
      const saved = await clients.writer.post(`${base}/wiki/${s.a}`, {
        data: {
          domainId: s.domainId,
          projectId: null,
          parentVersionId: s.av,
          basePublishedVersionId: s.av,
          title: "게시 수정 보관 안내",
          body: s.bodyB,
          chunkIds: [s.chunkId],
        },
      });
      expect(saved.status(), await saved.text()).toBe(201);
      const draft = await saved.json();
      expect(
        (
          await clients.reviewer.post(`${base}/review-desk`, {
            data: {
              kind: "quality",
              targetId: noEvidence.id,
              action: "resolve",
              note: "이전 판정으로 처리하려는 요청",
            },
          })
        ).status(),
      ).toBe(409);
      expect(
        (
          await clients.writer.post(
            `${base}/wiki-versions/${draft.versionId}/action`,
            { data: { action: "submit", note: "원문과 기간 수정" } },
          )
        ).status(),
      ).toBe(200);
      expect(
        (
          await clients.reviewer.post(
            `${base}/wiki-versions/${draft.versionId}/action`,
            {
              data: {
                action: "approve",
                note: "45일과 적용 제외 조건을 확인했습니다.",
              },
            },
          )
        ).status(),
      ).toBe(200);
      const afterRun = await create(s.domainId);
      await job().done;
      await finished(afterRun.id);
      const after = await data(s.domainId);
      expect(after.findings.find((f) => f.id === noEvidence.id)?.state).toBe(
        "resolved",
      );
      expect(after.findings.find((f) => f.kind === "broken-link")?.state).toBe(
        "resolved",
      );
      expect(after.findings.find((f) => f.id === noEvidence.id)?.current).toBe(
        true,
      );
      const events = await pool.query(
        "SELECT action FROM review_event WHERE target_id=$1",
        [noEvidence.id],
      );
      expect(events.rows.map((e) => e.action)).toContain("auto-resolved");
      await pool.query(
        "UPDATE source_version SET publication='withdrawn' WHERE id=$1",
        [s.sourceVersionId],
      );
      expect((await data(s.domainId)).findings.every((f) => !f.current)).toBe(
        true,
      );
      const stale = await create(s.domainId);
      await job().done;
      await finished(stale.id);
      expect(
        (await data(s.domainId)).findings.filter(
          (f) => f.kind === "stale-evidence",
        ).length,
      ).toBe(2);
    });
    test("실행 중 개정·취소·작업자 중단은 부분 결과를 공개하지 않는다", async () => {
      test.setTimeout(60000);
      const s = await seed("지연 품질");
      const run = await create(s.domainId, "semantic");
      const work = job();
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM quality_step WHERE run_id=$1 AND generation_id IS NOT NULL",
                [run.id],
              )
            ).rows[0].n,
        )
        .toBe(1);
      await pool.query("UPDATE domain SET purpose='개정된 목적' WHERE id=$1", [
        s.domainId,
      ]);
      await work.done;
      await finished(run.id, "outdated");
      expect((await data(s.domainId)).findings).toEqual([]);
      const canceled = await create(s.domainId, "semantic");
      const second = job();
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM quality_step WHERE run_id=$1 AND generation_id IS NOT NULL",
                [canceled.id],
              )
            ).rows[0].n,
        )
        .toBe(1);
      expect(
        (
          await clients.reviewer.patch(`${base}/quality/${canceled.id}`, {
            data: { action: "cancel" },
          })
        ).status(),
      ).toBe(200);
      await second.done;
      await finished(canceled.id, "canceled");
      expect((await data(s.domainId)).findings).toEqual([]);
      const stopped = await create(s.domainId, "semantic");
      const third = job();
      await expect
        .poll(
          async () =>
            (
              await pool.query("SELECT state FROM quality_run WHERE id=$1", [
                stopped.id,
              ])
            ).rows[0].state,
        )
        .toBe("running");
      third.child.kill("SIGKILL");
      await third.done;
      await pool.query(
        "UPDATE quality_run SET updated_at=now()-interval '31 seconds' WHERE id=$1",
        [stopped.id],
      );
      await job("scheduleQuality").done;
      await finished(stopped.id, "interrupted");
      expect((await data(s.domainId)).findings).toEqual([]);
    });
    test("정기·개정 후 점검은 같은 입력을 반복 등록하지 않고 요청자 권한을 다시 확인한다", async () => {
      const s = await seed("정기 점검");
      expect(
        (
          await clients.reviewer.post(`${base}/quality-policy`, {
            data: {
              domainId: s.domainId,
              mode: "structural",
              intervalDays: 1,
              afterRevision: true,
            },
          })
        ).status(),
      ).toBe(201);
      await job("scheduleQuality").done;
      expect((await data(s.domainId)).runs).toEqual([]);
      await pool.query(
        "UPDATE quality_policy SET next_run_at=now()-interval '1 minute' WHERE domain_id=$1",
        [s.domainId],
      );
      await Promise.all([
        job("scheduleQuality").done,
        job("scheduleQuality").done,
      ]);
      expect((await data(s.domainId)).runs).toHaveLength(1);
      await job().done;
      await job("scheduleQuality").done;
      expect((await data(s.domainId)).runs).toHaveLength(1);
      await pool.query(
        "UPDATE domain SET purpose='추가 확인할 목적' WHERE id=$1",
        [s.domainId],
      );
      await job("scheduleQuality").done;
      const d = await data(s.domainId);
      expect(d.runs).toHaveLength(2);
      expect(d.runs[0].origin).toBe("revision");
      await job().done;
      await pool.query(
        "UPDATE membership SET is_active=false WHERE workspace_id=$1 AND user_id=$2",
        [f.workspaceId, reviewer],
      );
      try {
        await pool.query(
          "UPDATE domain SET purpose='권한 철회 뒤 개정' WHERE id=$1",
          [s.domainId],
        );
        await job("scheduleQuality").done;
        expect(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM quality_run WHERE domain_id=$1",
              [s.domainId],
            )
          ).rows[0].n,
        ).toBe(2);
      } finally {
        await pool.query(
          "UPDATE membership SET is_active=true WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, reviewer],
        );
      }
      await clients.reviewer.post(`${base}/quality-policy`, {
        data: {
          domainId: s.domainId,
          mode: "structural",
          intervalDays: 0,
          afterRevision: false,
        },
      });
    });
    test("AI 재점검에서 사라진 후보는 과거 구절과 함께 남기고 직원이 해결을 결정한다", async () => {
      const s = await seed("AI 재점검 이력");
      const initial = await create(s.domainId, "semantic");
      await job().done;
      await finished(initial.id);
      const first = (await data(s.domainId)).findings;
      await pool.query(
        "UPDATE domain SET purpose='품질후보없음 표본' WHERE id=$1",
        [s.domainId],
      );
      const recheck = await create(s.domainId, "semantic");
      await job().done;
      await finished(recheck.id);
      const after = (await data(s.domainId)).findings;
      expect(after.length).toBe(first.length);
      expect(
        after.every((f) => !f.present && f.current && f.state === "open"),
      ).toBe(true);
      expect(after[0].quotes).toEqual(
        first.find((f) => f.id === after[0].id)?.quotes,
      );
      expect(
        (
          await clients.reviewer.post(`${base}/review-desk`, {
            data: {
              kind: "quality",
              targetId: after[0].id,
              action: "resolve",
              note: "현재 원문과 수정 내용을 검토하여 이 후보를 해결했습니다.",
              fixedWikiId: s.b,
            },
          })
        ).status(),
      ).toBe(201);
      expect(
        (
          await pool.query(
            "SELECT action FROM review_event WHERE target_id=$1",
            [after[0].id],
          )
        ).rows.map((e) => e.action),
      ).toContain("not-reproduced");
    });
    test("AI 동시 요청 한도에서는 대기하고 사용량을 중복 기록하지 않는다", async () => {
      const s = await seed("용량 대기");
      const run = await create(s.domainId, "semantic");
      const cap = (
        await pool.query(
          "SELECT COALESCE((SELECT concurrency FROM operations_policy WHERE workspace_id=$1),3) AS n",
          [f.workspaceId],
        )
      ).rows[0].n;
      const ids = Array.from({ length: cap }, () => randomUUID());
      for (const id of ids)
        await pool.query(
          "INSERT INTO generation(id,workspace_id,author_id,request_id,input_hash,kind,state,model) VALUES($1,$2,$3,$1,'quality-capacity-test','capacity-fixture','running','test')",
          [id, f.workspaceId, writer],
        );
      try {
        await job().done;
        await finished(run.id, "queued");
        expect(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM quality_step WHERE run_id=$1 AND generation_id IS NOT NULL",
              [run.id],
            )
          ).rows[0].n,
        ).toBe(0);
      } finally {
        await pool.query(
          "UPDATE generation SET state='failed' WHERE id=ANY($1::uuid[])",
          [ids],
        );
      }
      await job().done;
      await finished(run.id);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM quality_step WHERE run_id=$1 AND generation_id IS NOT NULL",
            [run.id],
          )
        ).rows[0].n,
      ).toBe(3);
    });
    test("점검 실행 중 요청자의 검토 권한이 없어지면 모델 처리를 중지한다", async () => {
      const s = await seed("지연 권한 확인"),
        run = await create(s.domainId, "semantic"),
        work = job();
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM quality_step WHERE run_id=$1 AND generation_id IS NOT NULL",
                [run.id],
              )
            ).rows[0].n,
        )
        .toBe(1);
      await pool.query(
        "UPDATE membership SET role='writer' WHERE workspace_id=$1 AND user_id=$2",
        [f.workspaceId, reviewer],
      );
      try {
        await work.done;
        await finished(run.id, "outdated");
        expect(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM quality_finding WHERE run_id=$1",
              [run.id],
            )
          ).rows[0].n,
        ).toBe(0);
      } finally {
        await pool.query(
          "UPDATE membership SET role='reviewer' WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, reviewer],
        );
      }
    });
    test("모바일 품질 화면에서 범위·비교 구절·담당 처리와 수정 변경안을 탐색한다", async ({
      browser,
    }) => {
      const s = await seed("모바일 품질");
      await pool.query(
        "UPDATE wiki_page SET project_id=$2 WHERE id=ANY($1::uuid[])",
        [[s.a, s.b], s.pa],
      );
      const run = await create(s.domainId, "semantic", s.pa);
      await job().done;
      await finished(run.id);
      const context = await browser.newContext({
        storageState: await clients.reviewer.storageState(),
        viewport: { width: 390, height: 844 },
        timezoneId: "America/New_York",
      });
      const page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        `/w/${f.workspaceId}/quality?domainId=${s.domainId}&projectId=${s.pa}`,
      );
      await expect(
        page.getByRole("heading", { name: "위키 품질 점검" }),
      ).toBeVisible();
      await expect(
        page.getByText("같은 검수 조건의 기간 비교", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("핵심 질문 설명 보완", { exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "test-results/quality-390.png",
        fullPage: true,
      });
      await page
        .getByRole("link", { name: "담당 지정·보류·처리 이력 →" })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "담당 검토·오류 처리" }),
      ).toBeVisible();
      await page
        .getByRole("link", { name: "비교 구절·원문·수정 변경안 확인 →" })
        .click();
      await expect(
        page.getByRole("combobox", { name: "프로젝트", exact: true }),
      ).toContainText("사업 갑");
      await page
        .getByRole("link", { name: "수정 변경안 작성 →" })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "새 변경안 작성" }),
      ).toBeVisible();
      expect(errors).toEqual([]);
      await context.close();
    });
  });
}
