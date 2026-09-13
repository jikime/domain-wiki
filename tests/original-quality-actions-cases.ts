import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";
import type { qualityOverview } from "../src/server/services/quality";

type Fixture = {
  workspaceId: string;
  accounts: { id: string; role: string }[];
};
type Data = Awaited<ReturnType<typeof qualityOverview>>;
export function registerOriginalQualityActionsTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("원본 기능 복원 — 연결 수정·검토 정리", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const w = f.workspaceId,
      base = `/api/workspaces/${w}`;
    const author = f.accounts.find((a) => a.role === "writer")?.id;
    const reviewer = f.accounts.find((a) => a.role === "reviewer")?.id;
    async function job() {
      const child = spawn(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "--eval",
          "import('./src/server/jobs/quality.ts').then(async m=>{await m.runNextQuality(); const {getPool}=await import('./src/server/db/index.ts');await getPool().end();}).catch(e=>{console.error(e);process.exit(1)})",
        ],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let errors = "";
      child.stderr.on("data", (value) => {
        errors += value;
      });
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(errors)),
        );
      });
    }
    async function inspect(domainId: string): Promise<Data> {
      const response = await clients.reviewer.get(
        `${base}/quality?domainId=${domainId}`,
      );
      expect(response.status(), await response.text()).toBe(200);
      return response.json();
    }
    async function check(domainId: string) {
      const response = await clients.reviewer.post(`${base}/quality`, {
        data: {
          domainId,
          projectId: null,
          mode: "structural",
          requestId: randomUUID(),
          force: true,
        },
      });
      expect(response.status()).toBe(201);
      const run = await response.json();
      await job();
      const data = await inspect(domainId);
      expect(data.runs.find((r) => r.id === run.id)?.state).toBe("completed");
      return data;
    }
    async function seed() {
      const domainId = randomUUID(),
        a = randomUUID(),
        av = randomUUID(),
        b = randomUUID(),
        bv = randomUUID(),
        sourceId = randomUUID(),
        sv = randomUUID(),
        chunkId = randomUUID();
      const bodyA =
        "# 검수 transformer 안내\n\n공통 검수 보관 안내입니다. [[transfomer|변환기 안내]]와 [[없는설계자리]]를 확인합니다.";
      const bodyB = "# transformer\n\n공통 검수 보관 안내와 기준을 설명합니다.";
      await pool.query(
        "INSERT INTO domain(id,workspace_id,name,purpose) VALUES($1,$2,$3,'원본 검토 동작 검증')",
        [domainId, w, `연결 수정 표본 ${domainId.slice(0, 8)}`],
      );
      await pool.query(
        "INSERT INTO source(id,workspace_id,domain_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,'검수 원문','reference',$4,$5,$5,1)",
        [sourceId, w, domainId, author, sv],
      );
      await pool.query(
        "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'quality.md','text/markdown',$4,$4,100,$5,'published','completed')",
        [sv, w, sourceId, randomUUID(), author],
      );
      await pool.query(
        "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,0,'공통 검수 보관 기준입니다.',$4)",
        [chunkId, w, sv, { kind: "lines", startLine: 1, endLine: 1 }],
      );
      for (const [id, versionId, title, body, path] of [
        [a, av, "검수 transformer 안내", bodyA, "wiki/guides/inspection.md"],
        [b, bv, "transformer", bodyB, "wiki/entities/transformer.md"],
      ]) {
        await pool.query(
          "INSERT INTO wiki_page(id,workspace_id,domain_id,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,$5,$5,1)",
          [id, w, domainId, author, versionId],
        );
        await pool.query(
          "INSERT INTO wiki_version(id,workspace_id,page_id,number,title,body,metadata,author_id,state) VALUES($1,$2,$3,1,$4,$5,$6,$7,'approved')",
          [
            versionId,
            w,
            id,
            title,
            body,
            { type: "concept", aliases: [], links: [], path },
            author,
          ],
        );
        await pool.query(
          "INSERT INTO wiki_evidence(workspace_id,version_id,chunk_id) VALUES($1,$2,$3)",
          [w, versionId, chunkId],
        );
      }
      return {
        domainId,
        a,
        av,
        b,
        bv,
        sourceId,
        sv,
        chunkId,
        bodyA,
        bodyB,
        data: await check(domainId),
      };
    }
    const fix = (
      domainId: string,
      findingIds: string[],
      action = "preview",
      basis?: string,
    ) =>
      clients.reviewer.post(`${base}/quality-fixes`, {
        data: {
          domainId,
          projectId: null,
          findingIds,
          action,
          ...(basis ? { basis } : {}),
        },
      });
    async function review(
      domainId: string,
      kind: string,
      title: string,
      pageIds: string[] = [],
    ) {
      const id = randomUUID();
      const {
        rows: [run],
      } = await pool.query(
        "SELECT id,basis_hash FROM quality_run WHERE workspace_id=$1 AND domain_id=$2 ORDER BY created_at DESC LIMIT 1",
        [w, domainId],
      );
      await pool.query(
        "INSERT INTO quality_finding(id,workspace_id,domain_id,scope_key,finding_key,mode,kind,severity,title,note,page_ids,quotes,run_id,basis_hash) VALUES($1::uuid,$2,$3,$4,$1::text,'semantic',$5,'info',$6,'후속 문서 반영 여부를 확인합니다.',$7,'[]',$8,$9)",
        [
          id,
          w,
          domainId,
          `${domainId}:*`,
          kind,
          title,
          JSON.stringify(pageIds),
          run.id,
          run.basis_hash,
        ],
      );
      return id;
    }
    const sweep = (domainId: string, extra: object = {}) =>
      clients.reviewer.post(`${base}/quality-sweep`, {
        data: {
          domainId,
          projectId: null,
          action: "preview",
          requestId: randomUUID(),
          useAi: false,
          ...extra,
        },
      });
    test.afterAll(async () => {
      await pool.end();
    });

    test("여러 연결을 페이지별로 합쳐 별칭·게시본·근거를 보존한 초안을 만들고 빈 문서를 생성한다", async () => {
      const s = await seed();
      const broken = s.data.findings.filter((f) => f.kind === "broken-link");
      expect(broken).toHaveLength(2);
      expect(
        broken.find((f) => f.suggestion.brokenTarget === "transfomer")
          ?.suggestion.targetId,
      ).toBe(s.b);
      expect(
        broken.find((f) => f.suggestion.brokenTarget === "없는설계자리")
          ?.suggestion.targetId,
      ).toBeUndefined();
      const out = s.data.findings.find(
        (f) => f.kind === "no-outlinks" && f.page_ids[0] === s.b,
      );
      expect(out?.suggestion.targetId).toBe(s.a);
      const ids = [...broken.map((f) => f.id), out?.id as string];
      const response = await fix(s.domainId, ids);
      expect(response.status(), await response.text()).toBe(200);
      const preview = await response.json();
      expect(preview.changes).toHaveLength(3);
      const edited = preview.changes.find(
        (p: { pageId: string }) => p.pageId === s.a,
      );
      expect(edited.before).toBe(s.bodyA);
      expect(edited.after).toContain("[[entities/transformer|변환기 안내]]");
      expect(edited.after).toContain("[[queries/없는설계자리]]");
      const applied = await fix(s.domainId, ids, "apply", preview.basis);
      expect(applied.status(), await applied.text()).toBe(200);
      const { drafts } = await applied.json();
      expect(drafts).toHaveLength(3);
      expect(
        drafts.filter((d: { newStub: boolean }) => d.newStub),
      ).toHaveLength(1);
      const { rows } = await pool.query(
        "SELECT p.id,p.published_version_id,v.state,v.body,v.author_id,v.metadata,(SELECT count(*)::int FROM wiki_evidence WHERE version_id=v.id) AS evidence FROM wiki_page p JOIN wiki_version v ON v.id=p.latest_version_id WHERE p.domain_id=$1",
        [s.domainId],
      );
      expect(rows.find((p) => p.id === s.a)).toMatchObject({
        published_version_id: s.av,
        state: "draft",
        body: edited.after,
        author_id: reviewer,
        evidence: 1,
      });
      expect(rows.find((p) => p.published_version_id === null)).toMatchObject({
        state: "draft",
        evidence: 0,
        metadata: { type: "query", path: "wiki/queries/없는설계자리.md" },
      });
      expect(
        (await pool.query("SELECT body FROM wiki_version WHERE id=$1", [s.av]))
          .rows[0].body,
      ).toBe(s.bodyA);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM quality_finding WHERE id=ANY($1::uuid[]) AND state='resolved'",
            [ids],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM review_event WHERE target_id=ANY($1::uuid[]) AND action='fix-draft'",
            [ids],
          )
        ).rows[0].n,
      ).toBe(3);
      expect(
        (await fix(s.domainId, ids, "apply", preview.basis)).status(),
      ).toBe(409);
    });
    test("읽기·작성 직원과 외부인은 수정할 수 없고 다른 프로젝트의 제안을 적용하지 않는다", async () => {
      const s = await seed(),
        item = s.data.findings.find(
          (f) => f.suggestion.brokenTarget === "transfomer",
        );
      for (const role of ["reader", "writer", "outsider"])
        expect(
          (
            await clients[role].post(`${base}/quality-fixes`, {
              data: {
                domainId: s.domainId,
                action: "preview",
                findingIds: [item?.id],
              },
            })
          ).status(),
        ).toBe(role === "outsider" ? 404 : 403);
      const projectId = randomUUID();
      await pool.query(
        "INSERT INTO project(id,workspace_id,domain_id,name,client_name) VALUES($1,$2,$3,'분리 사업','시험')",
        [projectId, w, s.domainId],
      );
      await pool.query("UPDATE wiki_page SET project_id=$2 WHERE id=$1", [
        s.b,
        projectId,
      ]);
      const data = await check(s.domainId),
        f = data.findings.find(
          (f) => f.suggestion.brokenTarget === "transfomer",
        );
      const response = await fix(s.domainId, [f?.id as string]);
      expect(response.status()).toBe(409);
      expect(await response.text()).toContain("프로젝트 범위");
    });
    test("미리보기 후 사람의 초안이 저장되면 전체 수정을 거부한다", async () => {
      const s = await seed(),
        ids = s.data.findings
          .filter((f) => f.kind === "broken-link")
          .map((f) => f.id);
      const preview = await (await fix(s.domainId, ids)).json();
      const save = await clients.writer.post(`${base}/wiki/${s.a}`, {
        data: {
          domainId: s.domainId,
          projectId: null,
          title: "직원 수정",
          body: `${s.bodyA}\n\n직원 검토 메모`,
          parentVersionId: s.av,
          basePublishedVersionId: s.av,
          chunkIds: [s.chunkId],
        },
      });
      expect(save.status(), await save.text()).toBe(201);
      expect(
        (await fix(s.domainId, ids, "apply", preview.basis)).status(),
      ).toBe(409);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM wiki_page WHERE domain_id=$1",
            [s.domainId],
          )
        ).rows[0].n,
      ).toBe(2);
      expect(
        (
          await pool.query(
            "SELECT v.body FROM wiki_page p JOIN wiki_version v ON v.id=p.latest_version_id WHERE p.id=$1",
            [s.a],
          )
        ).rows[0].body,
      ).toContain("직원 검토 메모");
    });
    test("대상 경로의 게시 전 초안과 개정된 원문을 덮어쓰지 않는다", async () => {
      const s = await seed(),
        id = s.data.findings.find(
          (f) => f.suggestion.brokenTarget === "없는설계자리",
        )?.id as string;
      const preview = await (await fix(s.domainId, [id])).json();
      const p = randomUUID(),
        v = randomUUID();
      await pool.query(
        "INSERT INTO wiki_page(id,workspace_id,domain_id,created_by,latest_version_id,version_count) VALUES($1,$2,$3,$4,$5,1)",
        [p, w, s.domainId, author, v],
      );
      await pool.query(
        "INSERT INTO wiki_version(id,workspace_id,page_id,number,title,body,metadata,author_id) VALUES($1,$2,$3,1,'직원 비공개 초안','작성 중입니다.',$4,$5)",
        [
          v,
          w,
          p,
          {
            type: "query",
            aliases: [],
            links: [],
            path: "wiki/queries/없는설계자리.md",
          },
          author,
        ],
      );
      const collision = await fix(s.domainId, [id], "apply", preview.basis);
      expect(collision.status()).toBe(409);
      expect(await collision.text()).toContain("게시 전 초안");
      expect(
        (await pool.query("SELECT body FROM wiki_version WHERE id=$1", [v]))
          .rows[0].body,
      ).toBe("작성 중입니다.");
      const typo = s.data.findings.find(
        (f) => f.suggestion.brokenTarget === "transfomer",
      )?.id as string;
      const fresh = await (await fix(s.domainId, [typo])).json();
      await pool.query(
        "UPDATE source SET published_version_id=NULL WHERE id=$1",
        [s.sourceId],
      );
      expect(
        (await fix(s.domainId, [typo], "apply", fresh.basis)).status(),
      ).toBe(409);
      expect(
        (
          await pool.query(
            "SELECT latest_version_id FROM wiki_page WHERE id=$1",
            [s.a],
          )
        ).rows[0].latest_version_id,
      ).toBe(s.av);
    });
    test("390px 화면에서 비교 후 초안을 저장한다", async ({ page }) => {
      const s = await seed();
      await page
        .context()
        .addCookies((await clients.reviewer.storageState()).cookies);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/w/${w}/quality?domainId=${s.domainId}`);
      const panel = page.locator("section.panel").filter({
        has: page.getByRole("heading", { name: "연결 수정·검토 정리" }),
      });
      await panel.getByText(/수정 가능한 연결/).click();
      await panel
        .getByRole("checkbox", {
          name: "끊긴 연결 · 검수 transformer 안내",
          exact: true,
        })
        .first()
        .check();
      await panel
        .getByRole("button", { name: /선택한 연결 수정 미리보기/ })
        .click();
      await expect(
        panel.getByRole("button", { name: "확인한 수정 내용을 초안으로 저장" }),
      ).toBeVisible();
      await expect(panel.locator("ins").first()).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await panel.screenshot({ path: ".local/parity-quality-actions-390.png" });
      await panel
        .getByRole("button", { name: "확인한 수정 내용을 초안으로 저장" })
        .click();
      await expect(
        panel.getByText(
          "연결 수정 초안을 저장했습니다. 각 초안에서 검토를 요청할 수 있습니다.",
        ),
      ).toBeVisible();
      await expect(
        panel.getByRole("link", {
          name: /검수 transformer 안내 · 수정 초안 확인/,
        }),
      ).toBeVisible();
    });
    test("이름·제목 대조와 삭제된 중복 문서를 후보로 제시하고 확인한 항목만 이력과 함께 해결한다", async () => {
      const s = await seed();
      const missing = await review(
        s.domainId,
        "missing-page",
        "Missing page: transformer",
      );
      const duplicate = await review(
        s.domainId,
        "duplicate",
        "Duplicate page: 보관",
        [randomUUID(), s.b],
      );
      const contradiction = await review(
        s.domainId,
        "contradiction",
        "정리완료 상충 조건",
        [s.a, s.b],
      );
      const suggestion = await review(
        s.domainId,
        "suggestion",
        "정리완료 확인 제안",
      );
      for (const role of ["reader", "writer", "outsider"])
        expect(
          (
            await clients[role].post(`${base}/quality-sweep`, {
              data: {
                domainId: s.domainId,
                action: "preview",
                requestId: randomUUID(),
                useAi: false,
              },
            })
          ).status(),
        ).toBe(role === "outsider" ? 404 : 403);
      const response = await sweep(s.domainId);
      expect(response.status(), await response.text()).toBe(200);
      const p = await response.json();
      expect(p.candidates.map((c: { id: string }) => c.id).sort()).toEqual(
        [missing, duplicate].sort(),
      );
      expect(
        (
          await pool.query("SELECT state FROM quality_finding WHERE id=$1", [
            missing,
          ])
        ).rows[0].state,
      ).toBe("open");
      expect(
        (
          await sweep(s.domainId, {
            action: "apply",
            id: p.id,
            basis: p.basis,
            findingIds: [contradiction],
          })
        ).status(),
      ).toBe(400);
      const apply = await sweep(s.domainId, {
        action: "apply",
        id: p.id,
        basis: p.basis,
        findingIds: [missing],
      });
      expect(apply.status()).toBe(200);
      expect(await apply.json()).toEqual({ resolved: 1 });
      expect(
        (
          await pool.query(
            "SELECT state FROM quality_finding WHERE id=ANY($1::uuid[])",
            [[duplicate, contradiction, suggestion]],
          )
        ).rows.every((r) => r.state === "open"),
      ).toBe(true);
      expect(
        (
          await pool.query(
            "SELECT action FROM review_event WHERE target_id=$1 ORDER BY created_at DESC LIMIT 1",
            [missing],
          )
        ).rows[0].action,
      ).toBe("sweep-resolved");
    });
    test("AI 정리는 40건씩 재판정하고 무관한 ID·사람 판단 항목을 제외하며 사용량을 남긴다", async () => {
      const s = await seed();
      await pool.query(
        "UPDATE quality_finding SET state='resolved' WHERE domain_id=$1",
        [s.domainId],
      );
      const ids: string[] = [];
      for (let i = 0; i < 45; i++)
        ids.push(await review(s.domainId, "stale", `정리완료 보관 정책 ${i}`));
      const human = await review(s.domainId, "contradiction", "정리완료 상충");
      const response = await sweep(s.domainId, { useAi: true });
      expect(response.status(), await response.text()).toBe(200);
      const p = await response.json();
      expect(p.judged).toBe(45);
      expect(p.candidates).toHaveLength(45);
      expect(
        p.candidates.every(
          (c: { id: string; method: string }) =>
            ids.includes(c.id) && c.method === "model",
        ),
      ).toBe(true);
      const record = (
        await pool.query(
          "SELECT state,input_tokens,output_tokens,result FROM generation WHERE id=$1",
          [p.id],
        )
      ).rows[0];
      expect(record.state).toBe("completed");
      expect(record.input_tokens).toBeGreaterThan(0);
      expect(record.output_tokens).toBeGreaterThan(0);
      expect(JSON.stringify(record.result)).not.toContain("보관 정책");
      expect(
        (
          await pool.query("SELECT state FROM quality_finding WHERE id=$1", [
            human,
          ])
        ).rows[0].state,
      ).toBe("open");
      await pool.query(
        "UPDATE quality_finding SET note=note||' 새 확인' WHERE id=$1",
        [ids[0]],
      );
      expect(
        (
          await sweep(s.domainId, {
            action: "apply",
            id: p.id,
            basis: p.basis,
            findingIds: [ids[0]],
          })
        ).status(),
      ).toBe(409);
    });
    test("불완전한 AI 응답은 해결 후보를 만들지 않고 진행 중 자료 변경도 거부한다", async () => {
      const s = await seed();
      await pool.query(
        "UPDATE quality_finding SET state='resolved' WHERE domain_id=$1",
        [s.domainId],
      );
      const id = await review(s.domainId, "stale", "정리응답오류");
      const p = await (await sweep(s.domainId, { useAi: true })).json();
      expect(p.candidates).toEqual([]);
      expect(p.judged).toBe(1);
      await pool.query(
        "UPDATE quality_finding SET title='정리완료 지연' WHERE id=$1",
        [id],
      );
      const requestId = randomUUID();
      const pending = sweep(s.domainId, { requestId, useAi: true });
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM generation WHERE request_id=$1 AND state='running'",
                [requestId],
              )
            ).rows[0].n,
        )
        .toBe(1);
      await pool.query(
        "UPDATE wiki_page SET published_version_id=NULL WHERE id=$1",
        [s.b],
      );
      const response = await pending;
      expect(response.status()).toBe(409);
      expect(await response.text()).toContain("변경");
      expect(
        (
          await pool.query("SELECT state FROM quality_finding WHERE id=$1", [
            id,
          ])
        ).rows[0].state,
      ).toBe("open");
      expect(
        (
          await pool.query("SELECT state FROM generation WHERE request_id=$1", [
            requestId,
          ])
        ).rows[0].state,
      ).toBe("failed");
    });
  });
}
