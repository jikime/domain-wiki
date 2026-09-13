import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";
import { analyzeGraph } from "../src/lib/graph-analysis";
import { graphInsights } from "../src/lib/graph-insights";
import type { AnalyzedNode, ViewData, ViewNode } from "../src/lib/graph-view";
import {
  buildKnowledgeGraph,
  graphRelevance,
} from "../src/lib/knowledge-graph";
import { emptyWikiMetadata } from "../src/lib/wiki-metadata";

type Fixture = {
  workspaceId: string;
  outsiderDomainId: string;
  accounts: { id: string; role: string }[];
};
export function registerGraphViewTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("15단계 지식 그래프 화면과 분석", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL }),
      base = `/api/workspaces/${f.workspaceId}`;
    const author = f.accounts.find((a) => a.role === "writer")?.id;
    async function seed(count = 6) {
      const domainId = randomUUID(),
        pa = randomUUID(),
        pb = randomUUID();
      await pool.query(
        "INSERT INTO domain(id,workspace_id,name,purpose) VALUES($1,$2,$3,'관계 확인')",
        [domainId, f.workspaceId, `그래프 화면 ${domainId.slice(0, 6)}`],
      );
      await pool.query(
        "INSERT INTO project(id,workspace_id,domain_id,name,client_name) VALUES($1,$2,$3,'그래프 사업 갑','표본'),($4,$2,$3,'그래프 사업 을','표본')",
        [pa, f.workspaceId, domainId, pb],
      );
      const nodes: ViewNode[] = Array.from({ length: count }, (_, i) => ({
        id: randomUUID(),
        versionId: randomUUID(),
        domainId,
        projectId: i === 3 ? pb : i === 4 ? pa : null,
        title: `연결 위키 ${i + 1}`,
        type: i === 1 ? "concept" : "source",
        aliases: i === 0 ? ["찾기별칭"] : [],
        sources: [
          { id: randomUUID(), versionId: randomUUID(), chunkId: randomUUID() },
        ],
        outLinks: [],
      }));
      nodes[0].outLinks = [nodes[1].id];
      nodes[1].outLinks = [nodes[2].id];
      for (const n of nodes) {
        const s = n.sources[0];
        await pool.query(
          "INSERT INTO source(id,workspace_id,domain_id,project_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,$5,'reference',$6,$7,$7,1)",
          [
            s.id,
            f.workspaceId,
            domainId,
            n.projectId,
            `${n.title} 원문`,
            author,
            s.versionId,
          ],
        );
        await pool.query(
          "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'graph-view.md','text/markdown',$4,$4,100,$5,'published','completed')",
          [s.versionId, f.workspaceId, s.id, randomUUID(), author],
        );
        await pool.query(
          "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,0,'정상 장비는 45일 보관합니다. 장애 장비에는 적용하지 않습니다.',$4)",
          [
            s.chunkId,
            f.workspaceId,
            s.versionId,
            { kind: "lines", startLine: 1, endLine: 1 },
          ],
        );
        await pool.query(
          "INSERT INTO wiki_page(id,workspace_id,domain_id,project_id,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,$5,$6,$6,1)",
          [n.id, f.workspaceId, domainId, n.projectId, author, n.versionId],
        );
        await pool.query(
          "INSERT INTO wiki_version(id,workspace_id,page_id,number,title,body,author_id,state,metadata) VALUES($1,$2,$3,1,$4,$5,$6,'approved',$7)",
          [
            n.versionId,
            f.workspaceId,
            n.id,
            n.title,
            `45일 보관합니다. 장애 장비에는 적용하지 않습니다.\n${n.outLinks.map((id) => `[관련](/w/${f.workspaceId}/wiki/${id})`).join("\n")}`,
            author,
            { type: n.type, aliases: n.aliases, links: [] },
          ],
        );
        await pool.query(
          "INSERT INTO wiki_evidence(workspace_id,version_id,chunk_id) VALUES($1,$2,$3)",
          [f.workspaceId, n.versionId, s.chunkId],
        );
      }
      return { domainId, pa, pb, nodes };
    }
    async function get(domainId: string, query = "", role = "reader") {
      const r = await clients[role].get(
        `${base}/graph?domainId=${domainId}${query}`,
      );
      expect(r.status(), await r.text()).toBe(200);
      return (await r.json()) as ViewData;
    }
    test.afterAll(async () => pool.end());
    test("검색과 같은 관계 신호를 쓰고 군집·공백 결과는 입력 순서를 바꿔도 재현된다", async () => {
      const s = await seed(),
        data = await get(s.domainId),
        result = analyzeGraph(data);
      const graph = buildKnowledgeGraph(
        f.workspaceId,
        data.nodes.map((n) => ({
          ...n,
          body: n.outLinks
            .map((id) => `[관련](/w/${f.workspaceId}/wiki/${id})`)
            .join("\n"),
          metadata: { ...emptyWikiMetadata, type: n.type },
        })),
      );
      for (const edge of result.edges) {
        const a = graph.nodes.get(edge.source),
          b = graph.nodes.get(edge.target);
        expect(a && b).toBeTruthy();
        if (!a || !b) throw new Error("관계 대상 없음");
        const proof = graphRelevance(a, b, graph);
        expect(edge.signals).toEqual(proof?.signals);
        expect(edge.weight).toBe(proof?.score);
      }
      const indirect = result.edges.find(
        (e) =>
          [e.source, e.target].includes(s.nodes[0].id) &&
          [e.source, e.target].includes(s.nodes[2].id),
      );
      expect(indirect?.signals.directLink).toBe(0);
      expect(indirect?.via).toEqual([s.nodes[1].id]);
      const other = analyzeGraph({ ...data, nodes: [...data.nodes].reverse() });
      expect(other.communities).toEqual(result.communities);
      expect(other.edges).toEqual(result.edges);
      expect(other.insights).toEqual(result.insights);
      expect(result.insights.some((i) => i.kind === "isolated")).toBe(true);
      expect(
        result.communities.every((c) => c.cohesion >= 0 && c.cohesion <= 1),
      ).toBe(true);
    });
    test("직원 역할·공간·프로젝트·필터를 먼저 적용하고 숨긴 위키가 이웃 점수를 만들지 않는다", async ({
      request,
    }) => {
      const s = await seed();
      expect(
        (await request.get(`${base}/graph?domainId=${s.domainId}`)).status(),
      ).toBe(401);
      expect(
        (
          await clients.outsider.get(`${base}/graph?domainId=${s.domainId}`)
        ).status(),
      ).toBe(404);
      expect(
        (
          await clients.reader.get(
            `${base}/graph?domainId=${f.outsiderDomainId}`,
          )
        ).status(),
      ).toBe(404);
      expect(
        (
          await clients.reader.get(
            `${base}/graph?domainId=${s.domainId}&projectId=${randomUUID()}`,
          )
        ).status(),
      ).toBe(404);
      for (const role of ["reader", "writer", "reviewer", "admin"])
        expect((await get(s.domainId, "", role)).nodes).toHaveLength(6);
      const project = await get(s.domainId, `&projectId=${s.pa}`);
      expect(JSON.stringify(project)).not.toContain(s.nodes[3].id);
      expect(project.nodes).toHaveLength(5);
      const filtered = await get(s.domainId, "&type=source"),
        analysis = analyzeGraph(filtered);
      expect(JSON.stringify(filtered)).not.toContain(s.nodes[1].id);
      expect(analysis.edges).toHaveLength(0);
      const alias = await get(s.domainId, "&q=찾기별칭");
      expect(alias.nodes.map((n) => n.id)).toEqual([s.nodes[0].id]);
      expect(JSON.stringify(alias)).not.toContain("45일");
      expect(JSON.stringify(alias)).not.toContain("body");
      expect(
        (
          await clients.reader.get(
            `${base}/graph?domainId=${s.domainId}&limit=10000`,
          )
        ).status(),
      ).toBe(400);
    });
    test("범위 탐색과 노드 상한을 명시하며 캐시 조회 후 철회·새 버전을 즉시 반영한다", async () => {
      const s = await seed(55),
        initial = await get(s.domainId, "&limit=50");
      expect(initial.nodes).toHaveLength(50);
      expect(initial.matched).toBe(55);
      expect(initial.truncated).toBe(true);
      const one = await get(s.domainId, `&focusId=${s.nodes[0].id}&hops=1`);
      expect(new Set(one.nodes.map((n) => n.id))).toEqual(
        new Set([s.nodes[0].id, s.nodes[1].id]),
      );
      const two = await get(s.domainId, `&focusId=${s.nodes[0].id}&hops=2`);
      expect(two.nodes).toHaveLength(3);
      const cached = await get(s.domainId);
      expect((await get(s.domainId)).fingerprint).toBe(cached.fingerprint);
      await pool.query(
        "UPDATE wiki_page SET published_version_id=NULL WHERE id=$1",
        [s.nodes[1].id],
      );
      const withdrawn = await get(s.domainId);
      expect(withdrawn.fingerprint).not.toBe(cached.fingerprint);
      expect(JSON.stringify(withdrawn)).not.toContain(s.nodes[1].id);
      expect(analyzeGraph(withdrawn).edges).toHaveLength(0);
      await pool.query(
        "UPDATE wiki_version SET title='개정한 그래프 제목',metadata=jsonb_set(metadata,'{aliases}','[\"새별칭\"]') WHERE id=$1",
        [s.nodes[0].versionId],
      );
      expect((await get(s.domainId, "&q=새별칭")).nodes[0].title).toBe(
        "개정한 그래프 제목",
      );
      await pool.query(
        "UPDATE source SET published_version_id=NULL WHERE id=$1",
        [s.nodes[0].sources[0].id],
      );
      expect((await get(s.domainId, "&q=새별칭")).nodes).toHaveLength(0);
    });
    test("희박한 군집·여러 군집 연결을 실제 구조로 안내하고 200개 분석 시간을 기록한다", async () => {
      const ids = Array.from({ length: 200 }, () => randomUUID()).sort(),
        nodes: ViewNode[] = ids.map((id, i) => ({
          id,
          versionId: randomUUID(),
          domainId: randomUUID(),
          projectId: null,
          title: `규모 ${i}`,
          type: "source",
          aliases: [],
          sources: [],
          outLinks: i < 199 ? [ids[i + 1]] : [],
        }));
      const data: ViewData = {
        fingerprint: "performance",
        nodes,
        matched: 200,
        truncated: false,
        scope: {
          domainId: nodes[0].domainId,
          projectId: null,
          type: "all",
          q: "",
          limit: 200,
          focusId: null,
          hops: 1,
        },
      };
      const analysis = analyzeGraph(data);
      expect(analysis.nodes).toHaveLength(200);
      expect(analysis.edges).toHaveLength(397);
      expect(analysis.durationMs).toBeLessThan(3000);
      test.info().annotations.push({
        type: "performance",
        description: `200개/397연결 ${analysis.durationMs.toFixed(1)}ms`,
      });
      const sample: AnalyzedNode[] = nodes
        .slice(0, 4)
        .map((n, i) => ({ ...n, community: i, degree: 3, x: 0, y: 0 }));
      const edge = (i: number) => ({
        source: sample[0].id,
        target: sample[i].id,
        weight: 3,
        signals: {
          directLink: 3,
          sourceOverlap: 0,
          commonNeighbor: 0,
          typeAffinity: 0,
        },
        via: [],
        sources: [],
      });
      const insights = graphInsights(
        sample,
        [edge(1), edge(2), edge(3)],
        [{ id: 0, nodeIds: ids.slice(0, 10), cohesion: 0.1, topIds: [ids[0]] }],
      );
      expect(insights.some((i) => i.kind === "sparse")).toBe(true);
      expect(insights.find((i) => i.kind === "bridge")?.description).toContain(
        "3개 군집",
      );
      const dense = {
        ...data,
        nodes: nodes.map((n) => ({
          ...n,
          sources: [{ id: "same", versionId: "same", chunkId: "same" }],
        })),
      };
      expect(() => analyzeGraph(dense)).toThrow("밀집");
    });
    test("데스크톱과 모바일에서 작업자 계산·키보드 선택·근거·질문·검토 요청·자료 범위를 연결한다", async ({
      browser,
    }) => {
      const s = await seed();
      for (const width of [1440, 390]) {
        const context = await browser.newContext({
            storageState: await clients.writer.storageState(),
            viewport: { width, height: 900 },
            baseURL: "http://localhost:3101",
          }),
          page = await context.newPage(),
          errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(
          `/w/${f.workspaceId}/graph?domainId=${s.domainId}&projectId=${s.pa}`,
        );
        await expect(
          page.getByRole("status").filter({ hasText: "5개 중" }),
        ).toBeVisible();
        await expect(
          page.locator('.sigma-container[data-ready="true"]'),
        ).toBeVisible();
        await expect(
          page.getByRole("form", { name: "그래프 필터" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("complementary", { name: "그래프 인사이트" }),
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "위키 목록", exact: true })
          .click();
        const list = page.getByRole("group", {
          name: "위키 목록",
          exact: true,
        });
        const first = list.getByRole("button", { name: /연결 위키 1/ });
        await first.focus();
        await page.keyboard.press("Enter");
        const detail = page.getByRole("complementary", {
          name: "선택한 위키 상세",
        });
        await expect(
          detail.getByRole("heading", { name: "연결 위키 1", exact: true }),
        ).toBeVisible();
        const wiki = detail.getByRole("link", { name: "선택한 게시 본문" }),
          source = detail.getByRole("link", { name: "원문 근거 1" });
        expect(await wiki.getAttribute("href")).toContain(
          `version=${s.nodes[0].versionId}`,
        );
        expect(await source.getAttribute("href")).toContain(
          `#chunk-${s.nodes[0].sources[0].chunkId}`,
        );
        for (const link of [wiki, source])
          expect(
            (
              await clients.writer.get(
                (await link.getAttribute("href")) as string,
              )
            ).status(),
          ).toBe(200);
        expect(
          await detail
            .getByRole("link", { name: "이 위키로 질문하기" })
            .getAttribute("href"),
        ).toContain(`projectId=${s.pa}`);
        await detail.getByText("오류 신고·수정 요청", { exact: true }).click();
        await detail
          .getByLabel("확인이 필요한 내용")
          .fill("연결된 설명과 45일 보관 예외를 함께 확인해 주세요.");
        await detail.getByRole("button", { name: "신고 접수" }).click();
        await expect(
          detail.getByText("접수했습니다.", { exact: false }),
        ).toBeVisible();
        await detail
          .getByRole("button", { name: "패널 닫기", exact: true })
          .click();
        const camera = page.locator(".graph-zoom");
        await page.getByRole("button", { name: "확대", exact: true }).click();
        await expect
          .poll(async () =>
            Number(await camera.getAttribute("data-camera-ratio")),
          )
          .toBeLessThan(1);
        await page
          .getByRole("button", { name: "전체 보기", exact: true })
          .click();
        await expect
          .poll(async () =>
            Number(await camera.getAttribute("data-camera-ratio")),
          )
          .toBe(1);
        await expect(page.locator(".graph-stage canvas").first()).toBeVisible();
        await page
          .getByRole("button", { name: "위키 목록", exact: true })
          .click();
        await page
          .getByRole("group", { name: "위키 목록", exact: true })
          .getByRole("button", { name: /연결 위키 1/ })
          .click();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
        await detail.getByRole("link", { name: "이 범위에 자료 등록" }).click();
        await page
          .getByRole("button", { name: "새 자료 등록", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByLabel("프로젝트", { exact: true })).toHaveText(
          "그래프 사업 갑",
        );
        await context.close();
      }
    });
    test("Sigma 캔버스의 노드 클릭·확대·군집 색상·범례 숨김·필터·접힌 인사이트를 조작한다", async ({
      browser,
    }) => {
      const s = await seed();
      const context = await browser.newContext({
        storageState: await clients.reader.storageState(),
        baseURL: "http://localhost:3101",
      });
      const page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/w/${f.workspaceId}/graph?domainId=${s.domainId}`);
      const canvas = page.locator('.sigma-container[data-ready="true"]');
      await expect(canvas).toHaveAttribute("data-node-count", "6");
      await canvas.focus();
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(async () =>
          Number(
            await page.locator(".graph-zoom").getAttribute("data-camera-x"),
          ),
        )
        .toBeGreaterThan(0.5);
      await page
        .getByRole("button", { name: "전체 보기", exact: true })
        .click();

      await page.getByRole("button", { name: "군집", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "그래프 범례" }),
      ).toContainText("지식 군집");
      await page.getByRole("button", { name: "유형", exact: true }).click();
      await page
        .getByRole("region", { name: "그래프 범례" })
        .getByRole("button", { name: /개념·기준/ })
        .click();
      await expect(canvas).toHaveAttribute("data-node-count", "5");
      await page.getByRole("button", { name: "필터", exact: true }).click();
      const filters = page.getByRole("form", { name: "그래프 필터" });
      await filters.getByRole("button", { name: "표시 설정 초기화" }).click();
      await expect(canvas).toHaveAttribute("data-node-count", "6");
      const size = filters.getByRole("slider", {
        name: "노드 크기",
        exact: true,
      });
      await size.focus();
      await page.keyboard.press("ArrowRight");
      await expect(size).toHaveAttribute("aria-valuenow", "1.05");
      await filters.getByLabel("연결 없는 위키 숨기기").check();
      await expect(canvas).toHaveAttribute("data-node-count", "3");
      await filters.getByRole("button", { name: "표시 설정 초기화" }).click();
      await page.keyboard.press("Escape");
      await expect(filters).toHaveCount(0);
      await page
        .getByRole("button", { name: "위키 검색", exact: true })
        .click();
      await page.getByLabel("위키 찾기", { exact: true }).fill("찾기별칭");
      await page.getByRole("button", { name: "검색 적용" }).click();
      await expect(canvas).toHaveAttribute("data-node-count", "1");
      const box = await canvas.boundingBox();
      if (!box) throw new Error("Sigma 영역이 없습니다.");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(
        page.getByRole("complementary", { name: "선택한 위키 상세" }),
      ).toContainText("연결 위키 1");
      await expect
        .poll(async () =>
          canvas
            .locator("canvas")
            .first()
            .evaluate((c) =>
              Math.abs(
                c.getBoundingClientRect().width -
                  (c.parentElement?.getBoundingClientRect().width ?? 0),
              ),
            ),
        )
        .toBeLessThan(1);
      await page.getByRole("button", { name: "패널 닫기" }).click();
      await page.getByRole("button", { name: "인사이트", exact: true }).click();
      await expect(
        page.getByRole("complementary", { name: "그래프 인사이트" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("complementary", { name: "그래프 인사이트" }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
      await context.close();
    });
    test("취소와 늦은 응답을 버리고 필터 변경·캐시·권한 철회 뒤 화면을 다시 검증한다", async ({
      browser,
    }) => {
      const s = await seed(),
        context = await browser.newContext({
          storageState: await clients.reader.storageState(),
          baseURL: "http://localhost:3101",
        }),
        page = await context.newPage();
      let delayed = true;
      await page.route(
        `**/api/workspaces/${f.workspaceId}/graph?**`,
        async (route) => {
          if (delayed) await new Promise((r) => setTimeout(r, 800));
          await route.continue().catch(() => {});
        },
      );
      await page.goto(`/w/${f.workspaceId}/graph?domainId=${s.domainId}`);
      await page
        .getByRole("button", { name: "탐색 중지", exact: true })
        .click();
      await expect(page.locator(".graph-workspace [role=alert]")).toContainText(
        "탐색을 중지",
      );
      await page.waitForTimeout(1000);
      await expect(
        page.getByRole("group", { name: "위키 목록", exact: true }),
      ).toHaveCount(0);
      delayed = false;
      await page
        .getByRole("button", { name: "새로 확인", exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: "6개 중" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "새로 확인", exact: true })
        .click();
      await expect(page.locator("output[data-cached=true]")).toBeVisible();
      await page
        .getByRole("button", { name: "위키 검색", exact: true })
        .click();
      await page.getByLabel("위키 찾기", { exact: true }).fill("찾기별칭");
      await page.getByRole("button", { name: "검색 적용" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "1개 중" }),
      ).toBeVisible();
      await pool.query(
        "UPDATE source SET published_version_id=NULL WHERE id=$1",
        [s.nodes[0].sources[0].id],
      );
      await page
        .getByRole("button", { name: "새로 확인", exact: true })
        .click();
      await expect(
        page.getByText("이 조건에 맞는 공개 위키가 없습니다.", {
          exact: false,
        }),
      ).toBeVisible();
      const reader = f.accounts.find((a) => a.role === "reader")?.id;
      await pool.query(
        "UPDATE membership SET is_active=false WHERE workspace_id=$1 AND user_id=$2",
        [f.workspaceId, reader],
      );
      try {
        await page
          .getByRole("button", { name: "새로 확인", exact: true })
          .click();
        await expect(
          page.locator(".graph-workspace [role=alert]"),
        ).toBeVisible();
        await expect(
          page.getByRole("group", { name: "위키 목록", exact: true }),
        ).toHaveCount(0);
      } finally {
        await pool.query(
          "UPDATE membership SET is_active=true WHERE workspace_id=$1 AND user_id=$2",
          [f.workspaceId, reader],
        );
        await context.close();
      }
    });
  });
}
