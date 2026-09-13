import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";
import { buildChatContext, evidenceExcerpt } from "../src/lib/chat-context";
import { emptyPurposeGuide } from "../src/lib/domain-purpose";
import {
  buildKnowledgeGraph,
  type GraphPage,
  graphRelevance,
  relatedGraphPages,
} from "../src/lib/knowledge-graph";
import { emptyWikiMetadata } from "../src/lib/wiki-metadata";
import type { ChatScope, CitationSnapshot } from "../src/server/db/schema";

type Fixture = {
  workspaceId: string;
  outsiderDomainId: string;
  accounts: { id: string; role: string }[];
};
type Doc = { id: string; versionId: string; chunkId: string };
type Page = { id: string; versionId: string; body: string };
export function registerGraphSearchTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("13단계 범위별 관계 검색과 문맥", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const base = `/api/workspaces/${f.workspaceId}`;
    const domainId = randomUUID();
    const secondDomain = randomUUID();
    const projectA = randomUUID();
    const projectB = randomUUID();
    const author = f.accounts.find((a) => a.role === "writer")?.id;
    let a: Page, middle: Page, z: Page;
    let sourceA: Doc, sourceM: Doc, sourceZ: Doc;
    let initialConversation = "";
    const scope: ChatScope = {
      domainId,
      projectId: null,
      sourceId: null,
      wikiId: null,
    };
    const events = (text: string) =>
      text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => JSON.parse(l.slice(5)));
    async function ask(prompt = "출발단서", value = scope) {
      const response = await clients.reader.post(`${base}/conversations`, {
        data: { scope: value },
      });
      expect(response.status()).toBe(201);
      const conversation = (await response.json()).id;
      const stream = events(
        await (
          await clients.reader.post(
            `${base}/conversations/${conversation}/stream`,
            { data: { prompt, requestId: randomUUID() } },
          )
        ).text(),
      );
      expect(
        stream.find((e) => e.type === "error"),
        JSON.stringify(stream),
      ).toBeUndefined();
      expect(stream.find((e) => e.type === "done")).toBeTruthy();
      return {
        conversation,
        sources: stream.find((e) => e.type === "sources") as {
          citations: CitationSnapshot[];
          mode: string;
          notice: string;
        },
      };
    }
    async function doc(
      title: string,
      body: string,
      d = domainId,
    ): Promise<Doc> {
      const id = randomUUID(),
        versionId = randomUUID(),
        chunkId = randomUUID();
      await pool.query(
        "INSERT INTO source(id,workspace_id,domain_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,'reference',$5,$6,$6,1)",
        [id, f.workspaceId, d, title, author, versionId],
      );
      await pool.query(
        "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'graph.md','text/markdown',$4,$4,100,$5,'published','completed')",
        [versionId, f.workspaceId, id, randomUUID(), author],
      );
      await pool.query(
        "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,0,$4,$5)",
        [
          chunkId,
          f.workspaceId,
          versionId,
          body,
          { kind: "lines", startLine: 10, endLine: 20, heading: title },
        ],
      );
      return { id, versionId, chunkId };
    }
    async function page(
      title: string,
      body: string,
      docs: Doc[],
    ): Promise<Page> {
      const id = randomUUID(),
        versionId = randomUUID();
      await pool.query(
        "INSERT INTO wiki_page(id,workspace_id,domain_id,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,$4,$5,$5,1)",
        [id, f.workspaceId, domainId, author, versionId],
      );
      await pool.query(
        "INSERT INTO wiki_version(id,workspace_id,page_id,number,title,body,author_id,state) VALUES($1,$2,$3,1,$4,$5,$6,'approved')",
        [versionId, f.workspaceId, id, title, body, author],
      );
      for (const d of docs)
        await pool.query(
          "INSERT INTO wiki_evidence(workspace_id,version_id,chunk_id) VALUES($1,$2,$3)",
          [f.workspaceId, versionId, d.chunkId],
        );
      return { id, versionId, body };
    }
    test.beforeAll(async () => {
      await pool.query(
        "INSERT INTO domain(id,workspace_id,name,purpose,purpose_guide,terms) VALUES($1,$2,'관계 검색 표본','검수 연결망 이해',$3,$4),($5,$2,'별도 기준 표본','별도 도메인의 시범 목적',$6,'[]')",
        [
          domainId,
          f.workspaceId,
          {
            ...emptyPurposeGuide,
            keyQuestions: "어떤 조건에서 보관 기간을 확인하나요?",
            workingAssumptions:
              "표본 가정: 999일이라는 잠정 판단은 원문 확인 전이다.",
          },
          JSON.stringify([
            {
              term: "출발단서",
              definition: "시작점을 가리키는 표본 용어",
              aliases: ["시작별명"],
            },
          ]),
          secondDomain,
          emptyPurposeGuide,
        ],
      );
      await pool.query(
        "INSERT INTO project(id,workspace_id,domain_id,name,client_name) VALUES($1,$2,$3,'사업 갑','표본'),($4,$2,$3,'사업 을','표본')",
        [projectA, f.workspaceId, domainId, projectB],
      );
      sourceA = await doc("시작 자료", "출발단서는 계약 접수 업무를 뜻합니다.");
      for (let ordinal = 1; ordinal <= 8; ordinal++)
        await pool.query(
          "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,$4,'출발단서는 계약 접수 업무를 뜻합니다.',$5)",
          [
            randomUUID(),
            f.workspaceId,
            sourceA.versionId,
            ordinal,
            {
              kind: "lines",
              startLine: ordinal + 20,
              endLine: ordinal + 20,
              heading: "추가 시작 문단",
            },
          ],
        );
      sourceM = await doc("이음 자료", "안내 담당자가 관련 조건을 확인합니다.");
      sourceZ = await doc(
        "보관 규칙 원문",
        "납품 직후 기록을 72시간 보관합니다. 장애가 난 장비에는 이 조건을 적용하지 않습니다.",
      );
      z = await page("보관 규칙", "기록 보관과 장애 예외를 확인합니다.", [
        sourceZ,
      ]);
      middle = await page(
        "업무 연결 안내",
        `[후속 규칙](/w/${f.workspaceId}/wiki/${z.id})`,
        [sourceM],
      );
      a = await page(
        "시작 위키",
        `출발단서 업무의 [연결 안내](/w/${f.workspaceId}/wiki/${middle.id})를 확인합니다.`,
        [sourceA],
      );
    });
    test.afterAll(async () => {
      await pool.end();
    });

    test("네 신호를 보존하고 유형만 같은 노드·코드 링크·다른 공간 링크를 제외한다", () => {
      const w = randomUUID(),
        one = randomUUID(),
        two = randomUUID(),
        bridge = randomUUID(),
        isolated = randomUUID();
      const source = {
        id: randomUUID(),
        versionId: randomUUID(),
        chunkId: randomUUID(),
      };
      const p = (id: string, body: string, sources = [source]): GraphPage => ({
        id,
        versionId: randomUUID(),
        domainId,
        projectId: null,
        title: "같은 이름",
        body,
        sources,
        metadata: { type: "concept", aliases: ["중복 별명"], links: [] },
      });
      const graph = buildKnowledgeGraph(w, [
        p(one, `[둘](/w/${w}/wiki/${two}) [연결](/w/${w}/wiki/${bridge})`),
        p(two, `[하나](/w/${w}/wiki/${one}) [연결](/w/${w}/wiki/${bridge})`),
        p(bridge, "", []),
        p(
          isolated,
          `\`[코드](/w/${w}/wiki/${one})\` [타 공간](/w/${randomUUID()}/wiki/${one})`,
          [],
        ),
      ]);
      const first = graph.nodes.get(one),
        second = graph.nodes.get(two);
      if (!first || !second) throw new Error("표본 없음");
      const proof = graphRelevance(first, second, graph);
      expect(proof?.signals).toMatchObject({
        directLink: 6,
        sourceOverlap: 4,
        typeAffinity: 0.8,
      });
      expect(proof?.signals.commonNeighbor).toBeCloseTo(1.5 / Math.log(2));
      expect(proof?.pages.map((p) => p.id)).toContain(bridge);
      expect(
        relatedGraphPages(graph, [one], 10).map((r) => r.node.id),
      ).not.toContain(isolated);
      const withoutBridge = buildKnowledgeGraph(
        w,
        [...graph.nodes.values()].filter((n) => n.id !== bridge),
      );
      expect(withoutBridge.nodes.get(one)?.outLinks.has(bridge)).toBe(false);
      expect(() =>
        buildKnowledgeGraph(
          w,
          Array.from({ length: 1001 }, () => p(randomUUID(), "", [])),
        ),
      ).toThrow("처리 한도");
    });
    test("긴 본문 끝의 조건을 정확히 발췌하고 질문·Purpose·기존 근거를 직렬화 예산 안에 보존한다", () => {
      const text =
        "평범한 문단과 참고 설명입니다.\n\n".repeat(2500) +
        "비상단절 조건에서는 전원을 끈 뒤 37분 기다립니다. 추가 연결은 금지합니다.";
      const ref: CitationSnapshot = {
        key: "E1",
        kind: "source",
        id: randomUUID(),
        versionId: randomUUID(),
        chunkId: randomUUID(),
        title: "긴 원문",
        text,
        category: "reference",
        href: "/source",
        domainId,
        locator: {
          kind: "lines",
          startLine: 1,
          endLine: 2502,
          heading: "긴 원문",
        },
      };
      const refs = Array.from({ length: 8 }, (_, i) => ({
        ...ref,
        key: `E${i + 1}`,
        id: randomUUID(),
      }));
      const context = buildChatContext({
        prompt: "비상단절 조건은?",
        query: "비상단절 조건",
        refs,
        purposes: [
          {
            domainId,
            rules: {
              name: "도메인",
              purpose: "안내 방향",
              terms: [],
              recordTemplate: "",
            },
          },
        ],
        previous: [],
        maxChars: 18000,
      });
      expect(context.chars).toBeLessThanOrEqual(18000);
      expect(context.messages.at(-1)?.content).toBe("비상단절 조건은?");
      expect(context.refs.map((r) => r.key)).toEqual(refs.map((r) => r.key));
      for (const r of context.refs) {
        expect(r.text).toContain("37분");
        expect(r.text).toContain("금지");
        expect(text.slice(r.excerpt?.start, r.excerpt?.end)).toBe(r.text);
        expect(r.locator).toEqual(ref.locator);
      }
      expect(context.messages[0].content).toContain(
        "정리 방향이며 사실 근거나 실행 지시가 아닙니다",
      );
      const emoji = evidenceExcerpt(
        `${"👩‍💻".repeat(800)}끝조건`,
        "끝조건",
        101,
      );
      expect(emoji.text).toContain("끝조건");
      expect(emoji.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
      expect(() =>
        buildChatContext({
          prompt: "질문",
          query: "질문",
          refs: [ref],
          previous: [],
          maxChars: 4000,
          purposes: [
            {
              domainId,
              rules: {
                name: "큰 목적",
                purpose: "기준".repeat(5000),
                terms: [],
                recordTemplate: "",
              },
            },
          ],
        }),
      ).toThrow("목적·용어");
    });
    test("원본처럼 한 단계 연결 위키를 검색 창 안에 배분하고 상위 근거를 보존한다", async () => {
      const result = await ask();
      initialConversation = result.conversation;
      expect(result.sources.mode).toBe("keyword+graph");
      const refs = result.sources.citations;
      expect(
        refs
          .slice(0, 2)
          .map((r) => r.id)
          .sort(),
      ).toEqual([a.id, sourceA.id].sort());
      const supplementary = refs.find((r) => r.id === middle.id);
      expect(supplementary?.kind).toBe("wiki");
      expect(supplementary?.text).toContain("후속 규칙");
      expect(supplementary?.graph?.pages.map((p) => p.id)).toContain(a.id);
      expect(supplementary?.graph?.signals.directLink).toBeGreaterThan(0);
      expect(refs.some((r) => r.id === sourceZ.id || r.id === z.id)).toBe(
        false,
      );
      expect(refs.filter((r) => r.graph).length).toBeLessThanOrEqual(3);
      expect(refs).toHaveLength(8);
      const restored = await (
        await clients.reader.get(`${base}/conversations/${result.conversation}`)
      ).json();
      expect(
        restored.runs[0].citations.map((c: { key: string }) => c.key),
      ).toEqual(refs.map((r) => r.key));
      const stats = await (
        await clients.reader.get("http://127.0.0.1:3102/stats")
      ).json();
      const prompt = stats.calls.at(-1)[0].content;
      expect(prompt).toContain("999일이라는 잠정 판단");
      expect(prompt).toContain("시작점을 가리키는 표본 용어");
      expect(prompt).not.toContain("별도 도메인의 시범 목적");
    });
    test("원문만 사용은 저장·재조회하고 위키 및 관계 확장을 제외한다", async () => {
      const result = await ask("출발단서", { ...scope, sourceOnly: true });
      expect([...new Set(result.sources.citations.map((r) => r.id))]).toEqual([
        sourceA.id,
      ]);
      expect(
        result.sources.citations.every((r) => r.kind === "source" && !r.graph),
      ).toBe(true);
      expect(
        (
          await (
            await clients.reader.get(
              `${base}/conversations/${result.conversation}`,
            )
          ).json()
        ).conversation.scope.sourceOnly,
      ).toBe(true);
      expect(
        (
          await clients.outsider.get(
            `${base}/conversations/${result.conversation}`,
          )
        ).status(),
      ).toBe(404);
      const onlyWiki = await ask("출발단서", {
        ...scope,
        wikiId: a.id,
        sourceOnly: true,
      });
      expect(onlyWiki.sources.citations.map((r) => r.id)).toEqual([sourceA.id]);
      const onlySource = await ask("출발단서", {
        ...scope,
        sourceId: sourceA.id,
      });
      expect(
        onlySource.sources.citations.some((r) => r.id === sourceZ.id),
      ).toBe(false);
    });
    test("프로젝트 밖 중간 위키는 노드·이웃 점수·추가 근거에 포함되지 않는다", async () => {
      await pool.query("UPDATE wiki_page SET project_id=$2 WHERE id=$1", [
        middle.id,
        projectB,
      ]);
      try {
        const result = await ask("출발단서", { ...scope, projectId: projectA });
        expect(
          result.sources.citations.some(
            (r) => r.id === sourceZ.id || r.id === sourceM.id,
          ),
        ).toBe(false);
        expect(JSON.stringify(result.sources)).not.toContain(middle.id);
        expect(JSON.stringify(result.sources)).not.toContain("업무 연결 안내");
      } finally {
        await pool.query("UPDATE wiki_page SET project_id=NULL WHERE id=$1", [
          middle.id,
        ]);
      }
    });
    test("캐시를 읽은 뒤 중간 위키가 철회되면 관계와 기존 답변을 즉시 숨긴다", async () => {
      await ask();
      expect(
        (
          await clients.reviewer.post(
            `${base}/wiki-versions/${middle.versionId}/action`,
            { data: { action: "withdraw", note: "중간 경로 철회 표본" } },
          )
        ).status(),
      ).toBe(200);
      try {
        const result = await ask();
        expect(result.sources.citations.some((r) => r.id === sourceZ.id)).toBe(
          false,
        );
        const old = await (
          await clients.reader.get(
            `${base}/conversations/${initialConversation}`,
          )
        ).json();
        expect(old.runs[0].state).toBe("restricted");
        expect(old.runs[0].citations).toHaveLength(0);
      } finally {
        await pool.query(
          "UPDATE wiki_version SET state='approved' WHERE id=$1",
          [middle.versionId],
        );
        await pool.query(
          "UPDATE wiki_page SET published_version_id=$2 WHERE id=$1",
          [middle.id, middle.versionId],
        );
      }
    });
    test("같은 별칭의 여러 위키를 구분하고 공식 변경안 게시 후 제목과 유형을 갱신한다", async () => {
      const duplicate = await page(
        "같은 이름",
        "동일 별칭을 사용하는 별개 문서입니다.",
        [sourceM],
      );
      await pool.query("UPDATE wiki_version SET metadata=$2 WHERE id=$1", [
        duplicate.versionId,
        { ...emptyWikiMetadata, aliases: ["업무별칭"] },
      ]);
      const data = {
        title: "같은 이름",
        body: a.body,
        domainId,
        projectId: null,
        parentVersionId: a.versionId,
        basePublishedVersionId: a.versionId,
        chunkIds: [sourceA.chunkId],
        classification: { type: "procedure", aliases: ["업무별칭"] },
      };
      const saved = await clients.writer.post(`${base}/wiki/${a.id}`, { data });
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
      a.versionId = versionId;
      const hits = await (
        await clients.reader.get(
          `${base}/search?kind=wiki&domainId=${domainId}&q=${encodeURIComponent("업무별칭")}`,
        )
      ).json();
      expect(
        hits
          .slice(0, 2)
          .map((p: { id: string }) => p.id)
          .sort(),
      ).toEqual([a.id, duplicate.id].sort());
      const result = await ask("출발단서");
      expect(result.sources.citations.find((r) => r.id === a.id)?.title).toBe(
        "같은 이름",
      );
      expect(result.sources.citations.some((r) => r.id === middle.id)).toBe(
        true,
      );
      expect(result.sources.citations.some((r) => r.id === sourceZ.id)).toBe(
        false,
      );
    });
    test("1만 자 뒤의 위키 문구와 여러 도메인의 목적을 읽되 적용 기준을 구분한다", async () => {
      const long = await page(
        "긴 문서",
        "반복 설명입니다.\n".repeat(2200) +
          "끝부분고유조건은 대기 후 83분을 기록하는 것입니다.",
        [sourceA],
      );
      const result = await ask("끝부분고유조건");
      expect(
        result.sources.citations.some(
          (r) => r.id === long.id && r.text.includes("83분"),
        ),
      ).toBe(true);
      await doc(
        "별도 표본",
        "출발단서는 이 도메인에서는 시험 시작을 뜻합니다.",
        secondDomain,
      );
      await ask("출발단서", { ...scope, domainId: null });
      const stats = await (
        await clients.reader.get("http://127.0.0.1:3102/stats")
      ).json();
      const prompt = stats.calls.at(-1)[0].content;
      expect(prompt).toContain(secondDomain);
      expect(prompt).toContain(domainId);
      expect(prompt).toContain("별도 도메인의 시범 목적");
      expect(prompt).toContain("혼합하지 마세요");
    });
    test("관계 범위 한도를 넘으면 기본 검색 근거로 되돌아간다", async () => {
      const ids = Array.from({ length: 1001 }, () => randomUUID());
      try {
        await pool.query(
          "INSERT INTO wiki_page(id,workspace_id,domain_id,created_by,latest_version_id,published_version_id,version_count) SELECT id,$2,$3,$4,id,id,1 FROM unnest($1::uuid[]) id",
          [ids, f.workspaceId, domainId, author],
        );
        await pool.query(
          "INSERT INTO wiki_version(id,workspace_id,page_id,number,title,body,author_id,state) SELECT id,$2,id,1,'한도 표본','연결 없는 본문',$3,'approved' FROM unnest($1::uuid[]) id",
          [ids, f.workspaceId, author],
        );
        const result = await ask();
        expect(result.sources.notice).toContain("관계 검색을 완료하지 못해");
        expect(result.sources.citations.every((r) => !r.graph)).toBe(true);
        expect(result.sources.citations.some((r) => r.id === sourceA.id)).toBe(
          true,
        );
      } finally {
        await pool.query("DELETE FROM wiki_page WHERE id=ANY($1::uuid[])", [
          ids,
        ]);
      }
    });
    test("390px에서 원문만 사용을 저장·복원하고 위키 유형·별칭 편집 폼을 제공한다", async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: await clients.writer.storageState(),
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await page.goto(`/w/${f.workspaceId}/chat?domainId=${domainId}`);
        const checkbox = page.getByRole("checkbox", { name: "원문만 사용" });
        await checkbox.check();
        await page.getByLabel("업무 질문", { exact: true }).fill("출발단서");
        await page.getByRole("button", { name: "질문 보내기" }).click();
        await expect(page.getByText("답변 완료", { exact: true })).toHaveCount(
          0,
        );
        await expect(
          page.getByRole("button", { name: "답변 복사" }).first(),
        ).toBeVisible({ timeout: 20000 });
        await page.reload();
        await expect(
          page.getByRole("checkbox", { name: "원문만 사용" }),
        ).toBeChecked();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: "test-results/graph-chat-source-only-390.png",
        });
        await page.goto(`/w/${f.workspaceId}/wiki/${a.id}/edit`);
        await expect(
          page.getByRole("combobox", { name: "위키 유형" }),
        ).toContainText("절차");
        await expect(page.getByLabel("별칭", { exact: true })).toHaveValue(
          "업무별칭",
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: "test-results/graph-wiki-classification-390.png",
        });
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  });
}
