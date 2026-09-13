import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { collectResearchSources, researchProviders } from "../src/lib/research";
import {
  availableResearchProviders,
  normalizeResearchSearchResults,
  searchResearchWeb,
} from "../src/server/research/search";

async function main() {
  const w = randomUUID(),
    secret = "test-private-search-key";
  process.env.RESEARCH_SEARCH_PROVIDERS = JSON.stringify(
    researchProviders.map((provider) => ({
      provider,
      baseUrl: `https://search.example/${provider}`,
      apiKey: secret,
      workspaceIds: [w],
    })),
  );
  assert.equal(availableResearchProviders(w).length, 7);
  assert.deepEqual(availableResearchProviders(randomUUID()), []);
  assert.ok(!JSON.stringify(availableResearchProviders(w)).includes(secret));
  const item = {
    title: "공식 자료",
    url: "https://www.source.example/a",
    content: "발췌 내용",
  };
  const payloads = {
    firecrawl: { data: { web: [item] } },
    searxng: { results: [item] },
    tavily: { results: [item] },
    ollama: { results: [item] },
    brave: { web: { results: [item] } },
    bocha: {
      code: 200,
      data: {
        webPages: {
          value: [{ name: item.title, url: item.url, summary: item.content }],
        },
      },
    },
    serpapi: { news_results: [item] },
  };
  const paths = {
    firecrawl: "/firecrawl/v2/search",
    searxng: "/searxng/search",
    tavily: "/tavily/search",
    ollama: "/ollama/api/web_search",
    brave: "/brave/web/search",
    bocha: "/bocha/web-search",
    serpapi: "/serpapi/search",
  };
  for (const provider of researchProviders) {
    const result = await searchResearchWeb(
      w,
      { provider, engine: "google_scholar", categories: ["science", "it"] },
      "검수 검색",
      5,
      new AbortController().signal,
      async (url, options) => {
        const target = new URL(String(url)),
          headers = new Headers(options?.headers),
          body = options?.body ? JSON.parse(String(options.body)) : {};
        assert.equal(target.pathname, paths[provider]);
        assert.equal(options?.redirect, "error");
        assert.equal(body.query ?? target.searchParams.get("q"), "검수 검색");
        assert.equal(
          Number(
            body.limit ??
              body.max_results ??
              body.count ??
              target.searchParams.get("count") ??
              target.searchParams.get("num") ??
              5,
          ),
          5,
        );
        if (["firecrawl", "ollama", "bocha"].includes(provider))
          assert.equal(headers.get("authorization"), `Bearer ${secret}`);
        if (provider === "tavily") {
          assert.equal(body.api_key, secret);
          assert.equal(body.search_depth, "advanced");
          assert.equal(body.include_answer, false);
        }
        if (provider === "bocha") {
          assert.equal(body.summary, true);
          assert.equal(body.freshness, "noLimit");
        }
        if (provider === "brave")
          assert.equal(headers.get("x-subscription-token"), secret);
        if (provider === "serpapi") {
          assert.equal(target.searchParams.get("engine"), "google_scholar");
          assert.equal(target.searchParams.get("api_key"), secret);
        }
        if (provider === "searxng") {
          assert.equal(target.searchParams.get("format"), "json");
          assert.equal(target.searchParams.get("categories"), "science,it");
        }
        return Response.json(payloads[provider]);
      },
    );
    assert.deepEqual(result, [
      {
        title: item.title,
        url: item.url,
        snippet: item.content,
        source: "source.example",
      },
    ]);
  }
  assert.deepEqual(
    normalizeResearchSearchResults("tavily", {
      results: [
        { ...item, url: "javascript:alert(1)" },
        { ...item, url: "https://user:pass@private.example/" },
      ],
    }),
    [],
  );
  for (const [provider, payload] of [
    ["bocha", { code: 500 }],
    ["brave", { message: secret }],
    ["tavily", { success: false, error: secret }],
  ] as const)
    assert.throws(
      () => normalizeResearchSearchResults(provider, payload),
      (error: Error) => !error.message.includes(secret),
    );
  for (const fetcher of [
    async () => {
      throw new Error(secret);
    },
    async () => new Response(secret),
    async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
  ]) {
    await assert.rejects(
      searchResearchWeb(
        w,
        { provider: "tavily", engine: "google", categories: ["general"] },
        "검색",
        5,
        new AbortController().signal,
        fetcher,
      ),
      (error: Error) => !error.message.includes(secret),
    );
  }
  const reference = (n: number) => ({
    title: String(n),
    snippet: `자료${n}`,
    source: "fixture",
    url: `https://source.example/${n}`,
  });
  let localCalls = 0;
  const collected = await collectResearchSources(
    [" q1 ", "fail", "q2", "q3", "q4", "q5"],
    "both",
    {
      web: async (query, limit) => {
        assert.equal(limit, 5);
        if (query === "fail") throw new Error("부분 오류");
        return Array.from({ length: 5 }, (_, n) =>
          reference((Number(query.at(-1)) - 1) * 5 + n),
        );
      },
      local: async (queries, limit) => {
        localCalls++;
        assert.equal(queries[0], "q1");
        assert.equal(limit, 15);
        return [reference(30)];
      },
    },
  );
  assert.equal(localCalls, 1);
  assert.equal(collected.results.length, 20);
  assert.equal(collected.results[19].title, "19");
  assert.deepEqual(collected.errors, ["부분 오류"]);
  const duplicate = await collectResearchSources(["one", "two"], "web", {
    web: async (query) => [
      {
        ...reference(1),
        url:
          query === "one"
            ? "https://SOURCE.example/1"
            : "https://source.example/1",
      },
    ],
  });
  assert.equal(duplicate.results.length, 1);
  console.log(
    "7개 제공자 요청·응답, 키 비노출, 오류·응답 크기, 병합 순서·부분 실패·중복·20개 제한 검증 통과",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
