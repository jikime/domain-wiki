import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";
import type { RfpSection } from "../src/server/db/schema";

type Fixture = {
  workspaceId: string;
  domainId: string;
  outsiderWorkspaceId: string;
  outsiderDomainId: string;
  accounts: { id: string; role: string; email: string; password: string }[];
};
export function registerBusinessTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("8단계 공식 자료와 RFP", () => {
    const base = `/api/workspaces/${f.workspaceId}`;
    const root = `/w/${f.workspaceId}`;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    let worker: ChildProcess;
    let siteId: string;
    let pathSite: string;
    let candidateId: string;
    let guideline: { sourceId: string; versionId: string };
    let guidelineChunk: string;
    let rfp: { sourceId: string; versionId: string };
    let rfpChunk: string;
    let caseSource: { sourceId: string; versionId: string };
    let caseChunk: string;
    let report: { reportId: string; versionId: string };
    let sections: RfpSection[];
    let draftVersion: string;
    const capture = (
      client = clients.writer,
      url = "https://official.example.test/notice",
      requestId = randomUUID(),
      title = "가상 기관 개발 기준",
    ) =>
      client.post(`${base}/official`, {
        data: { requestId, url, title, domainId: f.domainId, projectId: null },
      });
    const details = async (s: { sourceId: string }) =>
      (await clients.writer.get(`${base}/sources/${s.sourceId}`)).json();
    const ready = async (s: { sourceId: string }) =>
      expect
        .poll(async () => (await details(s)).version.processing, {
          timeout: 30000,
        })
        .toBe("completed");
    const sourceAction = (s: { versionId: string }, action: string) =>
      clients.reviewer.post(`${base}/source-versions/${s.versionId}/action`, {
        data: { action, note: "8단계 개발 시험 원문 검토" },
      });
    const input = (
      title = "RFP 개발 검토 보고서",
      rows = sections,
      parent: string | null = null,
      published: string | null = null,
    ) => ({
      sourceId: rfp.sourceId,
      title,
      sections: rows,
      parentVersionId: parent,
      basePublishedVersionId: published,
    });
    const reportAction = (
      id: string,
      action: string,
      client = clients.reviewer,
    ) =>
      client.post(`${base}/rfp-versions/${id}/action`, {
        data: {
          action,
          note: "개발 문서의 요구·예외·관련 원문을 대조했습니다.",
        },
      });
    const review = (id = candidateId, client = clients.reviewer, extra = {}) =>
      client.post(`${base}/official/${id}/action`, {
        data: {
          action: "verify",
          confirmed: true,
          publishedDate: "2026-08-01",
          effectiveDate: "2026-09-01",
          note: "가상 기관 원문과 발행일·시행일·첨부 주소를 확인했습니다.",
          ...extra,
        },
      });
    test.beforeAll(async () => {
      for (const a of f.accounts)
        expect(
          (
            await clients[a.role].post("/api/auth/sign-in/email", {
              data: { email: a.email, password: a.password },
            })
          ).status(),
        ).toBe(200);
      worker = spawn(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", "src/worker/index.ts"],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      worker.stdout?.on("data", (b) => {
        output += b;
      });
      worker.stderr?.on("data", () => {});
      await expect
        .poll(() => output, { timeout: 15000 })
        .toContain("작업자가 준비");
    });
    test.afterAll(async () => {
      if (worker && worker.exitCode === null) {
        const stopped = new Promise<void>((r) =>
          worker.once("exit", () => r()),
        );
        worker.kill("SIGTERM");
        await stopped;
      }
      await pool.end();
    });
    test("기관·경로 허용은 관리자만 설정하고 URL·범위 경계를 검사한다", async () => {
      const d = {
        name: "가상 기관",
        url: "https://official.example.test/notices",
        confirmed: true,
      };
      expect(
        (
          await clients.writer.post(`${base}/official-sites`, { data: d })
        ).status(),
      ).toBe(403);
      expect(
        (await clients.reader.get(`${base}/official-sites`)).status(),
      ).toBe(403);
      expect(
        (
          await clients.admin.post(`${base}/official-sites`, {
            data: { ...d, confirmed: false },
          })
        ).status(),
      ).toBe(400);
      for (const url of [
        "http://official.example.test/",
        "https://127.0.0.1/",
        "https://official.example.test:444/",
      ])
        expect(
          (
            await clients.admin.post(`${base}/official-sites`, {
              data: { ...d, url },
            })
          ).status(),
        ).toBe(400);
      const one = await clients.admin.post(`${base}/official-sites`, {
        data: d,
      });
      expect(one.status()).toBe(201);
      pathSite = (await one.json()).id;
      expect(
        (
          await capture(
            clients.writer,
            "https://official.example.test/notices-other/x",
          )
        ).status(),
      ).toBe(403);
      const rootSite = await clients.admin.post(`${base}/official-sites`, {
        data: { ...d, url: "https://official.example.test/" },
      });
      expect(rootSite.status()).toBe(201);
      siteId = (await rootSite.json()).id;
      expect(
        (
          await clients.outsider.patch(`${base}/official-sites/${siteId}`, {
            data: { active: false },
          })
        ).status(),
      ).toBe(404);
    });
    test("실제 수집 경로에서 HTML 원문·문단·표·날짜 후보·첨부와 요청 중복을 확인한다", async () => {
      const requestId = randomUUID();
      const r = await capture(clients.writer, undefined, requestId);
      expect(r.status(), await r.text()).toBe(201);
      const saved = await r.json();
      candidateId = saved.id;
      guideline = saved;
      const repeat = await capture(clients.writer, undefined, requestId);
      expect((await repeat.json()).id).toBe(candidateId);
      expect(
        (
          await capture(clients.writer, undefined, requestId, "다른 제목")
        ).status(),
      ).toBe(409);
      await ready(guideline);
      const info = await details(guideline);
      guidelineChunk = info.chunks.find((c: { text: string }) =>
        c.text.includes("30초마다"),
      ).id;
      expect(
        info.chunks.some((c: { text: string }) =>
          c.text.includes("일괄 적용하지 않습니다"),
        ),
      ).toBe(true);
      expect(
        info.chunks.some(
          (c: { text: string; locator: { table?: number } }) =>
            c.locator.table === 1 && c.text.includes("2열(조건)"),
        ),
      ).toBe(true);
      expect(JSON.stringify(info.chunks)).not.toContain("실행되면 안 됨");
      const file = await clients.writer.get(
        `${base}/source-versions/${guideline.versionId}/file?inline=true`,
      );
      expect(file.headers()["content-type"]).toBe("text/html");
      expect(file.headers()["content-disposition"]).toContain("attachment");
      expect(
        createHash("sha256")
          .update(await file.body())
          .digest("hex"),
      ).toBe(info.version.sha256);
      const item = await (
        await clients.writer.get(`${base}/official/${candidateId}`)
      ).json();
      expect(item.candidate.state).toBe("captured");
      expect(item.candidate.publishedHint).toBe("2026-08-01");
      expect(item.candidate.publishedDate).toBeNull();
      expect(item.candidate.attachments).toHaveLength(2);
      expect((await clients.reader.get(`${base}/official`)).status()).toBe(403);
      expect(
        (
          await clients.outsider.get(`${base}/official/${candidateId}`)
        ).status(),
      ).toBe(404);
    });
    test("내부 IP·허용 밖 이동·과대 응답·수집 중 허용 철회는 원본을 만들지 않는다", async () => {
      expect(
        (
          await clients.admin.post(`${base}/official-sites`, {
            data: {
              name: "내부 주소 검사 표본",
              url: "https://private.example.test/",
              confirmed: true,
            },
          })
        ).status(),
      ).toBe(201);
      const before = Number(
        (
          await pool.query(
            "SELECT count(*) FROM source WHERE workspace_id=$1",
            [f.workspaceId],
          )
        ).rows[0].count,
      );
      expect(
        (
          await capture(clients.writer, "https://private.example.test/x")
        ).status(),
      ).toBe(403);
      expect(
        (
          await capture(
            clients.writer,
            "https://official.example.test/redirect-out",
          )
        ).status(),
      ).toBe(403);
      expect(
        (
          await capture(
            clients.writer,
            "https://official.example.test/oversize",
          )
        ).status(),
      ).toBe(413);
      expect(
        (
          await capture(
            clients.writer,
            "https://official.example.test/forbidden",
          )
        ).status(),
      ).toBe(502);
      const slow = capture(
        clients.writer,
        "https://official.example.test/slow",
      );
      await expect
        .poll(async () =>
          Number(
            (
              await pool.query(
                "SELECT count(*) FROM official_candidate WHERE workspace_id=$1 AND state='fetching'",
                [f.workspaceId],
              )
            ).rows[0].count,
          ),
        )
        .toBe(1);
      expect(
        (
          await clients.admin.patch(`${base}/official-sites/${siteId}`, {
            data: { active: false },
          })
        ).status(),
      ).toBe(200);
      expect((await slow).status()).toBe(409);
      expect((await capture()).status()).toBe(403);
      expect(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM source WHERE workspace_id=$1",
              [f.workspaceId],
            )
          ).rows[0].count,
        ),
      ).toBe(before);
      expect(
        (
          await clients.admin.patch(`${base}/official-sites/${siteId}`, {
            data: { active: true },
          })
        ).status(),
      ).toBe(200);
      const moved = await capture(
        clients.writer,
        "https://official.example.test/redirect-ok",
      );
      expect(moved.status()).toBe(201);
      const item = await (
        await clients.writer.get(`${base}/official/${(await moved.json()).id}`)
      ).json();
      expect(item.candidate.finalUrl).toBe(
        "https://official.example.test/notice",
      );
    });
    test("원본 공개·다른 직원 대조 후에만 공식 확인을 기록하고 첨부를 따로 수집한다", async () => {
      expect((await review()).status()).toBe(409);
      expect((await sourceAction(guideline, "approve")).status()).toBe(200);
      expect((await review(candidateId, clients.reader)).status()).toBe(403);
      expect(
        (
          await review(candidateId, clients.reviewer, { confirmed: false })
        ).status(),
      ).toBe(400);
      expect(
        (
          await review(candidateId, clients.reviewer, {
            publishedDate: "2026-02-30",
          })
        ).status(),
      ).toBe(400);
      expect((await review()).status()).toBe(200);
      const self = await capture(clients.reviewer);
      expect(self.status()).toBe(201);
      expect((await review((await self.json()).id)).status()).toBe(409);
      const attachment = await capture(
        clients.writer,
        "https://official.example.test/files/guide.pdf",
      );
      expect(attachment.status()).toBe(201);
      const a = await attachment.json();
      await ready(a);
      expect((await details(a)).version.mimeType).toBe("application/pdf");
      expect(
        (
          await capture(clients.writer, "https://outside.example.test/a.pdf")
        ).status(),
      ).toBe(403);
    });
    test("RFP 원문과 별도 사례를 준비하고 인용 구절·분류·범위 검사를 적용한다", async () => {
      async function upload(title: string, text: string) {
        const r = await clients.writer.post(`${base}/sources`, {
          multipart: {
            title,
            category: "project",
            domainId: f.domainId,
            projectId: "",
            file: {
              name: `${title}.md`,
              mimeType: "text/markdown",
              buffer: Buffer.from(text),
            },
          },
        });
        expect(r.status()).toBe(201);
        const s = await r.json();
        await ready(s);
        expect((await sourceAction(s, "approve")).status()).toBe(200);
        return s;
      }
      rfp = await upload(
        "관제 RFP 개발 표본",
        "# RFP 개발 표본\n\n관제 화면은 30초마다 갱신해야 합니다. 모든 화면에 일괄 적용하지 않습니다. 대상 화면 목록은 별도 협의합니다.\n\n실제 발주 문서가 아닌 시험 표본입니다.",
      );
      caseSource = await upload(
        "과거 사업 개발 사례",
        "# 개발 사례\n\n과거 관제 시범 사업에서는 재연결 상태를 확인한 뒤 갱신했습니다. 모든 화면에 일괄 적용하지 않았습니다.",
      );
      const rfpInfo = await details(rfp);
      const clause = rfpInfo.chunks.find((c: { text: string }) =>
        c.text.includes("30초마다"),
      );
      rfpChunk = clause.id;
      const caseInfo = await details(caseSource);
      const caseText = caseInfo.chunks.find((c: { text: string }) =>
        c.text.includes("재연결 상태"),
      );
      caseChunk = caseText.id;
      const guide = (await details(guideline)).chunks.find(
        (c: { id: string }) => c.id === guidelineChunk,
      );
      sections = [
        {
          kind: "requirement",
          title: "화면 갱신 요구",
          meaning:
            "지정된 화면에 30초 갱신 조건을 적용하되 일괄 적용은 제외합니다.",
          quote: clause.text,
          chunkIds: [rfpChunk],
          questions: ["대상 화면의 확정 목록은 무엇인가요?"],
        },
        {
          kind: "standard",
          title: "참고할 관제 기준",
          meaning: "본 사업에 적용되는지 대조할 기준입니다.",
          quote: guide.text,
          chunkIds: [guidelineChunk],
          questions: ["해당 기준의 적용 범위에 본 사업이 포함되나요?"],
        },
        {
          kind: "case",
          title: "과거 시범 사업 사례",
          meaning: "과거 처리 경험으로, 이번 사업의 의무는 아닙니다.",
          quote: caseText.text,
          chunkIds: [caseChunk],
          questions: [],
        },
        {
          kind: "inference",
          title: "설계 검토 의견",
          meaning: "예외 화면을 나누어 검토할 필요가 있다는 추론입니다.",
          quote: "",
          chunkIds: [],
          questions: ["예외 화면의 처리 방식은 무엇인가요?"],
        },
        {
          kind: "unclear",
          title: "대상 목록 미확정",
          meaning: "적용할 화면 목록의 확정이 필요합니다.",
          quote: "대상 화면 목록은 별도 협의합니다.",
          chunkIds: [rfpChunk],
          questions: ["화면 목록은 언제 확정하나요?"],
        },
      ];
      expect(
        (
          await clients.writer.post(`${base}/rfp`, {
            data: input("없는 구절", [
              { ...sections[0], quote: "원문에 없는 수치 10초" },
            ]),
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await clients.writer.post(`${base}/rfp`, {
            data: input("사례를 의무로", [
              sections[0],
              { ...sections[2], kind: "standard" },
            ]),
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await clients.writer.post(`${base}/rfp`, {
            data: input("다른 범위", [
              { ...sections[0], chunkIds: [f.outsiderDomainId] },
            ]),
          })
        ).status(),
      ).toBe(404);
      expect(
        (await clients.reader.post(`${base}/rfp`, { data: input() })).status(),
      ).toBe(403);
      const saved = await clients.writer.post(`${base}/rfp`, { data: input() });
      expect(saved.status(), await saved.text()).toBe(201);
      report = await saved.json();
      expect(
        (await clients.reader.get(`${base}/rfp/${report.reportId}`)).status(),
      ).toBe(404);
      expect(
        (await clients.admin.get(`${base}/rfp/${report.reportId}`)).status(),
      ).toBe(200);
      expect(
        (await clients.outsider.get(`${base}/rfp/${report.reportId}`)).status(),
      ).toBe(404);
    });
    test("보고서 제출·담당·검토·공유·내보내기와 자기 승인을 확인한다", async () => {
      expect(
        (
          await reportAction(report.versionId, "submit", clients.writer)
        ).status(),
      ).toBe(200);
      const desk = await (
        await clients.reviewer.get(`${base}/review-desk`)
      ).json();
      expect(
        desk.targets.some(
          (t: { kind: string; id: string }) =>
            t.kind === "rfp" && t.id === report.versionId,
        ),
      ).toBe(true);
      expect(
        (
          await clients.reviewer.post(`${base}/review-desk`, {
            data: {
              kind: "rfp",
              targetId: report.versionId,
              action: "assign",
              assigneeId: f.accounts.find((a) => a.role === "reviewer")?.id,
            },
          })
        ).status(),
      ).toBe(201);
      expect((await reportAction(report.versionId, "approve")).status()).toBe(
        200,
      );
      const visible = await (
        await clients.reader.get(`${base}/rfp/${report.reportId}`)
      ).json();
      expect(visible.version.sections).toHaveLength(5);
      expect(visible.evidenceValid).toBe(true);
      expect(visible.evidence).toHaveLength(3);
      const file = await clients.reader.get(
        `${base}/rfp/${report.reportId}/file`,
      );
      expect(file.status()).toBe(200);
      const body = await file.text();
      expect(body).toContain("RFP 명시 요구");
      expect(body).toContain("과거 사례");
      expect(body).toContain("분석·추론");
      expect(body).toContain(`#chunk-${rfpChunk}`);
      const own = await clients.reviewer.post(`${base}/rfp`, {
        data: input("검토 직원 작성 표본"),
      });
      const self = await own.json();
      expect((await reportAction(self.versionId, "submit")).status()).toBe(200);
      expect((await reportAction(self.versionId, "approve")).status()).toBe(
        409,
      );
    });
    test("새 보고서 버전은 기존 게시본을 보존하고 충돌·수정 요청을 기록한다", async () => {
      const saved = await clients.writer.post(
        `${base}/rfp/${report.reportId}`,
        {
          data: input(
            "수정 초안",
            sections,
            report.versionId,
            report.versionId,
          ),
        },
      );
      expect(saved.status()).toBe(201);
      draftVersion = (await saved.json()).versionId;
      expect(
        (
          await clients.writer.post(`${base}/rfp/${report.reportId}`, {
            data: input("충돌", sections, report.versionId, report.versionId),
          })
        ).status(),
      ).toBe(409);
      expect(
        (
          await (
            await clients.reader.get(`${base}/rfp/${report.reportId}`)
          ).json()
        ).version.id,
      ).toBe(report.versionId);
      expect(
        (
          await clients.reader.get(
            `${base}/rfp/${report.reportId}?version=${draftVersion}`,
          )
        ).status(),
      ).toBe(404);
      expect(
        (await reportAction(draftVersion, "submit", clients.writer)).status(),
      ).toBe(200);
      expect((await reportAction(draftVersion, "reject")).status()).toBe(200);
      const edit = await clients.writer.post(`${base}/rfp/${report.reportId}`, {
        data: input(
          "RFP 개발 최종 보고서",
          sections,
          draftVersion,
          report.versionId,
        ),
      });
      expect(edit.status()).toBe(201);
      const next = await edit.json();
      expect(
        (await reportAction(next.versionId, "submit", clients.writer)).status(),
      ).toBe(200);
      expect((await reportAction(next.versionId, "approve")).status()).toBe(
        200,
      );
      report = next;
      const history = await (
        await clients.writer.get(`${base}/rfp/${report.reportId}`)
      ).json();
      expect(history.versions).toHaveLength(3);
    });
    test("AI RFP 초안은 구조·원문 구절·근거 ID·중복 요청과 사용량 기록을 검증한다", async () => {
      const data = {
        requestId: randomUUID(),
        sourceId: rfp.sourceId,
        chunkIds: [rfpChunk],
        contextChunkIds: [guidelineChunk],
        focus: "갱신 조건",
      };
      const before = Number(
        (
          await pool.query(
            "SELECT count(*) FROM rfp_report WHERE workspace_id=$1",
            [f.workspaceId],
          )
        ).rows[0].count,
      );
      const result = await clients.writer.post(`${base}/rfp-generations`, {
        data,
      });
      expect(result.status(), await result.text()).toBe(201);
      const r = await result.json();
      expect(r.state).toBe("completed");
      expect(
        (await clients.reader.get(`${base}/rfp/${r.result.reportId}`)).status(),
      ).toBe(404);
      const repeat = await clients.writer.post(`${base}/rfp-generations`, {
        data,
      });
      expect((await repeat.json()).result.reportId).toBe(r.result.reportId);
      expect(
        (
          await clients.writer.post(`${base}/rfp-generations`, {
            data: { ...data, focus: "다른 요청" },
          })
        ).status(),
      ).toBe(409);
      expect(
        (
          await clients.writer.post(`${base}/rfp-generations`, {
            data: { ...data, requestId: randomUUID(), focus: "거짓근거" },
          })
        ).status(),
      ).toBe(502);
      expect(
        (
          await clients.writer.post(`${base}/rfp-generations`, {
            data: { ...data, requestId: randomUUID(), focus: "잘못된구절" },
          })
        ).status(),
      ).toBe(400);
      expect(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM rfp_report WHERE workspace_id=$1",
              [f.workspaceId],
            )
          ).rows[0].count,
        ),
      ).toBe(before + 1);
      const run = (
        await pool.query(
          "SELECT input_tokens,output_tokens,state FROM generation WHERE request_id=$1",
          [data.requestId],
        )
      ).rows[0];
      expect(run).toMatchObject({
        input_tokens: 120,
        output_tokens: 40,
        state: "completed",
      });
    });
    test("브라우저에서 RFP 직접 작성·원문 인용·검토 게시와 공식 날짜 대조를 수행한다", async ({
      browser,
    }) => {
      const wc = await browser.newContext({
        storageState: await clients.writer.storageState(),
        viewport: { width: 390, height: 844 },
        timezoneId: "Asia/Seoul",
      });
      const rc = await browser.newContext({
        storageState: await clients.reviewer.storageState(),
        viewport: { width: 390, height: 844 },
        timezoneId: "Asia/Seoul",
      });
      const page = await wc.newPage();
      const reviewer = await rc.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      reviewer.on("pageerror", (e) => errors.push(e.message));
      try {
        await page.goto(`${root}/tools/rfp/new?sourceId=${rfp.sourceId}`);
        await page
          .getByLabel("보고서 제목", { exact: true })
          .fill("브라우저 RFP 분석 표본");
        await page
          .getByLabel("항목 1 제목", { exact: true })
          .fill("갱신 범위 확인");
        await page
          .getByLabel("항목 1 의미·적용 범위", { exact: true })
          .fill("30초 갱신의 대상 화면과 일괄 적용 제외를 확인합니다.");
        await page
          .getByText("근거 문단 선택 · 현재 0개", { exact: true })
          .click();
        await page
          .getByLabel("항목 1 원문 검색", { exact: true })
          .fill("30초마다");
        await page
          .getByRole("button", { name: "이 문단 인용", exact: true })
          .click();
        await expect(
          page.getByLabel("항목 1 원문 구절", { exact: true }),
        ).toHaveValue(/30초마다/);
        await page
          .getByRole("button", { name: "검토 전 초안 저장", exact: true })
          .click();
        await page.waitForURL(/\/tools\/rfp\/[0-9a-f-]{36}$/);
        const url = page.url();
        await page
          .getByRole("button", { name: "검토 요청", exact: true })
          .click();
        await expect(
          page.getByText("검토 대기 · 버전 1", { exact: true }),
        ).toBeVisible();
        await reviewer.goto(url);
        await reviewer
          .getByLabel(
            "검토한 범위·원문·적용 조건 (승인·수정 요청·철회 시 필수)",
          )
          .fill("원문의 조건과 적용 예외를 직접 확인했습니다.");
        await reviewer
          .getByRole("button", { name: "검토 완료·게시", exact: true })
          .click();
        await expect(
          reviewer.getByText("검토 완료·게시 · 버전 1", { exact: true }),
        ).toBeVisible();
        const captureResult = await capture();
        const newCandidate = (await captureResult.json()).id;
        await reviewer.goto(`${root}/tools/official/${newCandidate}`);
        await reviewer.getByLabel("원문에서 확인한 발행일").fill("2026-08-01");
        await reviewer.getByLabel("원문에서 확인한 시행일").fill("2026-09-01");
        await reviewer
          .getByLabel("기관·날짜·첨부 확인 내용")
          .fill("가상 기관의 날짜와 첨부 주소를 대조했습니다.");
        await reviewer
          .getByRole("checkbox", {
            name: "기관·원문·발행/시행 정보와 첨부를 직접 대조했습니다.",
          })
          .press("Space");
        await reviewer
          .getByRole("button", { name: "공식 자료 확인 기록", exact: true })
          .click();
        await expect(
          reviewer.getByText("발행일: 2026-08-01 · 시행일: 2026-09-01", {
            exact: true,
          }),
        ).toBeVisible();
        expect(errors).toEqual([]);
      } finally {
        await wc.close();
        await rc.close();
      }
    });
    test("새 도구·사이트·수집·보고서·편집 화면을 390px에서 확인한다", async ({
      browser,
    }) => {
      mkdirSync("docs/stages/08-business/screenshots", { recursive: true });
      for (const [role, pages] of Object.entries({
        reader: ["tools", "tools/rfp", `tools/rfp/${report.reportId}`],
        writer: [
          "tools/official",
          `tools/official/${candidateId}`,
          `tools/rfp/${report.reportId}/edit`,
        ],
        admin: ["admin/sites"],
      })) {
        const context = await browser.newContext({
          storageState: await clients[role].storageState(),
          viewport: { width: 390, height: 844 },
          timezoneId: "Asia/Seoul",
        });
        try {
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          for (const path of pages) {
            await page.goto(`${root}/${path}`);
            await expect(page.locator("h1").first()).toBeVisible();
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            ).toBe(true);
            await page.screenshot({
              path: `docs/stages/08-business/screenshots/${role}-${path.replace(/[0-9a-f-]{36}/g, "detail").replaceAll("/", "-")}.png`,
              fullPage: true,
            });
          }
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      }
    });
    test("기준 개정·철회는 RFP 공유·내보내기·진행 중 AI 저장과 원본 삭제에 반영된다", async () => {
      const slow = clients.writer.post(`${base}/rfp-generations`, {
        data: {
          requestId: randomUUID(),
          sourceId: rfp.sourceId,
          chunkIds: [rfpChunk],
          contextChunkIds: [guidelineChunk],
          focus: "지연 분석",
        },
      });
      await expect
        .poll(async () =>
          Number(
            (
              await pool.query(
                "SELECT count(*) FROM generation WHERE workspace_id=$1 AND kind='rfp' AND state='running'",
                [f.workspaceId],
              )
            ).rows[0].count,
          ),
        )
        .toBe(1);
      expect((await sourceAction(guideline, "withdraw")).status()).toBe(200);
      expect((await slow).status()).toBe(409);
      const invalidated = await pool.query(
        "SELECT e.version_id, ch.id, source_is_current(ch.version_id) AS current FROM rfp_evidence e JOIN source_chunk ch ON ch.id=e.chunk_id WHERE e.version_id=$1",
        [report.versionId],
      );
      expect(invalidated.rows.some((r) => !r.current)).toBe(true);
      const sharedAfter = await clients.reader.get(
        `${base}/rfp/${report.reportId}`,
      );
      expect(sharedAfter.status()).toBe(404);
      const visibleReports = await (
        await clients.reader.get(`${base}/rfp`)
      ).json();
      expect(
        visibleReports.some(
          (r: { report: { id: string } }) => r.report.id === report.reportId,
        ),
      ).toBe(false);
      expect(
        (
          await clients.reader.get(`${base}/rfp/${report.reportId}/file`)
        ).status(),
      ).toBe(404);
      expect(
        (
          await clients.writer.get(`${base}/rfp/${report.reportId}/file`)
        ).status(),
      ).toBe(409);
      const own = await (
        await clients.writer.get(`${base}/rfp/${report.reportId}`)
      ).json();
      expect(own.evidenceValid).toBe(false);
      expect(
        own.evidence.some((e: { id: string }) => e.id === guidelineChunk),
      ).toBe(false);
      const impact = await (
        await clients.writer.get(`${base}/source-impact/${guideline.sourceId}`)
      ).json();
      expect(
        impact.reports.some((r: { id: string }) => r.id === report.reportId),
      ).toBe(true);
      await pool.query(
        "UPDATE source SET updated_at=now()-interval '400 days' WHERE id=$1",
        [guideline.sourceId],
      );
      expect(
        (
          await clients.admin.post(`${base}/retirements`, {
            data: { action: "preview", sourceId: guideline.sourceId },
          })
        ).status(),
      ).toBe(409);
    });
    test("수집 프로세스가 끊긴 실행은 작업자가 실패 상태로 정리한다", async () => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO official_candidate(id,workspace_id,site_id,domain_id,author_id,request_id,input_hash,url,title,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'test','https://official.example.test/lost','연결 중단 표본','fetching',now()-interval '3 minutes')",
        [
          id,
          f.workspaceId,
          siteId,
          f.domainId,
          f.accounts.find((a) => a.role === "writer")?.id,
          randomUUID(),
        ],
      );
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT state FROM official_candidate WHERE id=$1",
                [id],
              )
            ).rows[0].state,
          { timeout: 10000 },
        )
        .toBe("failed");
      expect(pathSite).toBeTruthy();
    });
  });
}
