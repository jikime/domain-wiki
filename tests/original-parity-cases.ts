import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { Pool } from "pg";
import { parseAgentAction, runAgentLoop } from "../src/lib/chat-agent";

type Fixture = {
  workspaceId: string;
  accounts: { id: string; role: string }[];
};
export function registerOriginalParityTests(
  f: Fixture,
  clients: Record<string, APIRequestContext>,
) {
  test.describe("원본 기능 복원 — 채팅 에이전트", () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const domain = randomUUID(),
      source = randomUUID(),
      version = randomUUID();
    const base = `/api/workspaces/${f.workspaceId}/conversations`;
    let conversation = "";
    test.beforeAll(async () => {
      const author = f.accounts.find((a) => a.role === "writer")?.id;
      await pool.query(
        "INSERT INTO domain(id,workspace_id,name,purpose,purpose_markdown,schema_markdown) VALUES($1,$2,'원본 반복 탐색 표본','원본 동작 비교','# Purpose\n정합기초 설명을 정확히 읽는다.','# Page Types\n- methodology: wiki/methodologies/')",
        [domain, f.workspaceId],
      );
      await pool.query(
        "INSERT INTO source(id,workspace_id,domain_id,title,category,created_by,latest_version_id,published_version_id,version_count) VALUES($1,$2,$3,'참조 안내서','guideline',$4,$5,$5,1)",
        [source, f.workspaceId, domain, author, version],
      );
      await pool.query(
        "INSERT INTO source_version(id,workspace_id,source_id,number,filename,mime_type,storage_key,sha256,byte_size,uploaded_by,publication,processing) VALUES($1,$2,$3,1,'reference.md','text/markdown',$4,$4,100,$5,'published','completed')",
        [version, f.workspaceId, source, randomUUID(), author],
      );
      for (let i = 0; i < 12; i++)
        await pool.query(
          "INSERT INTO source_chunk(id,workspace_id,version_id,ordinal,text,locator) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            f.workspaceId,
            version,
            i,
            i === 0
              ? "정합기초 안내: 자세한 운영 조건은 문서 마지막 부분을 확인한다."
              : i === 11
                ? "최종 대기 기간은 72시간이다."
                : `부록 ${i}의 참고 정보이다.`,
            { kind: "lines", startLine: i + 1, endLine: i + 1 },
          ],
        );
    });
    test.afterAll(async () => {
      await pool.end();
    });
    test("원본 JSON 동작·일반 답변 호환, 중복·원문 전용·취소를 보존한다", async () => {
      expect(
        parseAgentAction(
          '```json\n{"action":"tool","tool":"source.search","query":"질문"}\n```',
        )?.action,
      ).toBe("tool");
      expect(parseAgentAction("근거를 확인했습니다. [E1]")?.action).toBe(
        "final",
      );
      expect(
        parseAgentAction(
          '{"action":"tool","tool":"shell.exec","command":"echo x"}',
        ),
      ).toBeNull();
      for (const answer of [
        "[[concepts/검수기초|검수 기준]]에 따라 확인합니다. [E1]",
        "[기준](https://example.org)입니다. [E1]",
        "[E1]에 따른 결과입니다.",
      ]) {
        expect(parseAgentAction(answer)).toEqual({ action: "final", answer });
      }
      expect(
        parseAgentAction('[{"action":"tool","tool":"source.search"}]'),
      ).toBeNull();
      expect(parseAgentAction("")).toBeNull();
      const executed: string[] = [],
        observations: string[] = [];
      const replies = [
        { action: "tool", tool: "wiki.search", query: "금지" },
        { action: "tool", tool: "source.search", query: "정합기초" },
        { action: "tool", tool: "source.search", query: "정합기초" },
        { action: "final", answer: "확인한 내용입니다. [E1]" },
      ];
      const result = await runAgentLoop({
        sourceOnly: true,
        signal: new AbortController().signal,
        generate: async (seen) => {
          observations.push(JSON.stringify(seen));
          return {
            text: JSON.stringify(replies.shift()),
            inputTokens: 10,
            outputTokens: 5,
          };
        },
        execute: async (action) => {
          executed.push(action.tool);
          return "공개 원문";
        },
      });
      expect(executed).toEqual(["source.search"]);
      expect(observations.at(-1)).toContain("중복 탐색");
      expect(result.inputTokens).toBe(40);
      const abort = new AbortController();
      abort.abort();
      await expect(
        runAgentLoop({
          sourceOnly: false,
          signal: abort.signal,
          generate: async () => {
            throw new Error("호출하면 안 됨");
          },
          execute: async () => "",
        }),
      ).rejects.toThrow();
    });
    test("빈 첫 검색에서 검색어 보완→뒤쪽 원문 읽기→인용 답변을 완성한다", async () => {
      const created = await clients.reader.post(base, {
        data: { scope: { domainId: domain, agentMode: "deep" } },
      });
      expect(created.status()).toBe(201);
      conversation = (await created.json()).id;
      const response = await clients.reader.post(
        `${base}/${conversation}/stream`,
        { data: { requestId: randomUUID(), prompt: "반복탐색계약" } },
      );
      const events = (await response.text())
        .split("\n")
        .filter((s) => s.startsWith("data:"))
        .map((s) => JSON.parse(s.slice(5)));
      expect(events.find((e) => e.type === "sources").citations).toHaveLength(
        0,
      );
      expect(events.find((e) => e.type === "error")).toBeUndefined();
      const run = events.find((e) => e.type === "done").runs.at(-1);
      expect(run.state).toBe("completed");
      expect(
        run.toolEvents
          .filter((e: { status: string }) => e.status === "completed")
          .map((e: { tool: string }) => e.tool),
      ).toEqual(["wiki.search", "source.search", "source.read"]);
      expect(
        run.messages.find((m: { role: string }) => m.role === "assistant").body,
      ).toContain("72시간");
      expect(
        run.citations.find((c: { used: boolean }) => c.used).snapshot.text,
      ).toContain("72시간");
      const stats = await (
        await clients.reader.get("http://127.0.0.1:3102/stats")
      ).json();
      const calls = stats.calls.filter(
        (messages: { content: string }[]) =>
          messages.at(-1)?.content === "반복탐색계약",
      );
      expect(calls).toHaveLength(3);
      expect(calls[0][0].content).not.toContain("72시간");
      expect(calls[0][0].content).toContain("정합기초 설명을 정확히 읽는다.");
      expect(calls[0][0].content).toContain("wiki/methodologies/");
      expect(calls[2][0].content).toContain("72시간");
    });
    test("브라우저에서 도구 진행 이력과 탐색 깊이를 확인하고 새로고침한다", async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: await clients.reader.storageState(),
        viewport: { width: 390, height: 844 },
      });
      try {
        const page = await context.newPage();
        await page.goto(
          `/w/${f.workspaceId}/chat?conversation=${conversation}`,
        );
        await page.getByText("자료 탐색 3단계", { exact: true }).click();
        await expect(page.locator(".chat-tool-events")).toContainText(
          "원문 읽기",
        );
        await expect(
          page.getByRole("combobox", { name: "자료 탐색 깊이" }),
        ).toContainText("깊은 탐색");
        await page.reload();
        await expect(
          page.getByText("자료 탐색 3단계", { exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
        ).toBe(false);
      } finally {
        await context.close();
      }
    });
    test("읽은 원문이 철회되면 이전 답변과 도구 이력도 함께 숨긴다", async () => {
      await pool.query(
        "UPDATE source SET published_version_id=NULL WHERE id=$1",
        [source],
      );
      const detail = await (
        await clients.reader.get(`${base}/${conversation}`)
      ).json();
      const run = detail.runs.at(-1);
      expect(run.state).toBe("restricted");
      expect(run.toolEvents).toEqual([]);
      expect(JSON.stringify(run.messages)).not.toContain("72시간");
    });
  });
}
