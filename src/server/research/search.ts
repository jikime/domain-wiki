import "server-only";
import { z } from "zod";
import {
  type ResearchInput,
  type ResearchReference,
  researchProviderLabels,
  researchProviders,
} from "@/lib/research";
import { AccessError } from "@/server/errors";

const defaults = {
  firecrawl: "https://api.firecrawl.dev",
  searxng: "",
  tavily: "https://api.tavily.com",
  ollama: "https://ollama.com",
  brave: "https://api.search.brave.com/res/v1",
  bocha: "https://api.bocha.cn/v1",
  serpapi: "https://serpapi.com",
};
const configSchema = z
  .array(
    z
      .object({
        provider: z.enum(researchProviders),
        baseUrl: z.url().optional(),
        apiKey: z.string().optional(),
        workspaceIds: z.array(z.uuid()).optional(),
      })
      .strict(),
  )
  .max(7);
export function searchProviderConfigs() {
  try {
    const configs = configSchema.parse(
      JSON.parse(process.env.RESEARCH_SEARCH_PROVIDERS || "[]"),
    );
    if (new Set(configs.map((c) => c.provider)).size !== configs.length)
      throw new Error("duplicate");
    for (const config of configs) {
      const url = new URL(config.baseUrl ?? defaults[config.provider]);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error("url");
      if (
        !["searxng", "firecrawl"].includes(config.provider) &&
        !config.apiKey?.trim()
      )
        throw new Error("key");
    }
    return configs;
  } catch {
    throw new AccessError(
      503,
      "운영자의 RESEARCH_SEARCH_PROVIDERS 설정을 확인해 주세요.",
    );
  }
}
export function availableResearchProviders(w: string) {
  return searchProviderConfigs()
    .filter((c) => !c.workspaceIds || c.workspaceIds.includes(w))
    .map((c) => ({
      provider: c.provider,
      label: researchProviderLabels[c.provider],
    }));
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
const string = (value: unknown) => (typeof value === "string" ? value : "");
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
export function normalizeResearchSearchResults(
  provider: NonNullable<ResearchInput["provider"]>,
  payload: unknown,
  limit = 5,
): ResearchReference[] {
  const value = object(payload);
  if (
    value.success === false ||
    typeof value.error === "string" ||
    (provider === "bocha" && value.code !== 200) ||
    (provider === "brave" && !value.web && value.message)
  )
    throw new AccessError(
      502,
      `${researchProviderLabels[provider]} 검색 제공자가 요청을 완료하지 못했습니다.`,
    );
  let items: unknown[] = [];
  if (provider === "brave") items = array(object(value.web).results);
  else if (provider === "bocha")
    items = array(object(object(value.data).webPages).value);
  else if (provider === "serpapi") {
    for (const key of [
      "organic_results",
      "news_results",
      "images_results",
      "video_results",
      "videos_results",
      "shopping_results",
    ])
      if (Array.isArray(value[key])) {
        items = array(value[key]);
        break;
      }
  } else if (provider === "firecrawl") {
    for (const key of ["data", "results"]) {
      if (Array.isArray(value[key])) {
        items = array(value[key]);
        break;
      }
      const nested = object(value[key]);
      const found = ["web", "results", "items"].find((name) =>
        Array.isArray(nested[name]),
      );
      if (found) {
        items = array(nested[found]);
        break;
      }
    }
  } else items = array(value.results);
  return items.slice(0, limit).flatMap((raw) => {
    const item = object(raw),
      meta = object(item.metadata);
    const title =
      provider === "bocha"
        ? string(item.name) || "Untitled"
        : string(item.title ?? meta.title) || "Untitled";
    const link = string(
      item.url ??
        item.link ??
        meta.sourceURL ??
        meta.url ??
        item.original ??
        item.thumbnail,
    );
    const snippet =
      provider === "bocha"
        ? string(item.summary ?? item.snippet)
        : string(
            item.snippet ??
              item.content ??
              item.description ??
              meta.description ??
              item.summary ??
              item.markdown,
          );
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      return [];
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      link.length > 2000
    )
      return [];
    return [
      {
        title: title.slice(0, 500),
        url: url.href,
        snippet: snippet.slice(0, 12000),
        source: url.hostname.replace(/^www\./, ""),
      },
    ];
  });
}

async function requestResearchWeb(
  w: string,
  input: Pick<ResearchInput, "provider" | "engine" | "categories">,
  query: string,
  limit: number,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const config = searchProviderConfigs().find(
    (c) =>
      c.provider === input.provider &&
      (!c.workspaceIds || c.workspaceIds.includes(w)),
  );
  if (!config)
    throw new AccessError(
      503,
      "선택한 검색 제공자가 이 작업공간에 설정되어 있지 않습니다.",
    );
  const { provider } = config,
    base = (config.baseUrl ?? defaults[provider]).replace(/\/+$/, ""),
    key = config.apiKey?.trim();
  let url: URL, body: object | undefined;
  const headers: Record<string, string> = { Accept: "application/json" };
  const count = Math.max(1, Math.min(limit, provider === "bocha" ? 50 : 20));
  switch (provider) {
    case "firecrawl":
      url = new URL(`${base}/v2/search`);
      body = { query, limit: count };
      if (key) headers.Authorization = `Bearer ${key}`;
      break;
    case "tavily":
      url = new URL(`${base}/search`);
      body = {
        api_key: key,
        query,
        max_results: count,
        search_depth: "advanced",
        include_answer: false,
      };
      break;
    case "ollama":
      url = new URL(`${base}/api/web_search`);
      headers.Authorization = `Bearer ${key}`;
      body = { query, max_results: count };
      break;
    case "bocha":
      url = new URL(`${base}/web-search`);
      headers.Authorization = `Bearer ${key}`;
      body = { query, freshness: "noLimit", summary: true, count };
      break;
    case "brave":
      url = new URL(`${base}/web/search`);
      url.search = new URLSearchParams({
        q: query,
        count: String(count),
      }).toString();
      headers["X-Subscription-Token"] = key ?? "";
      break;
    case "serpapi":
      url = new URL(`${base}/search`);
      url.search = new URLSearchParams({
        engine: input.engine,
        q: query,
        api_key: key ?? "",
        num: String(count),
      }).toString();
      break;
    case "searxng":
      url = new URL(base.endsWith("/search") ? base : `${base}/search`);
      url.search = new URLSearchParams({
        q: query,
        format: "json",
        categories: input.categories.join(","),
      }).toString();
      break;
  }
  if (body) headers["Content-Type"] = "application/json";
  // Endpoints are operator configuration, never browser input. A redirect must
  // not carry a provider's credentials to a different endpoint.
  const response = await fetcher(url, {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok || !response.body)
    throw new AccessError(
      502,
      `${researchProviderLabels[provider]} 검색 응답을 받지 못했습니다. HTTP ${response.status}`,
    );
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024)
        throw new AccessError(413, "검색 결과가 2MiB를 넘었습니다.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AccessError(
      502,
      `${researchProviderLabels[provider]} 검색 응답 형식이 올바르지 않습니다.`,
    );
  }
  return normalizeResearchSearchResults(provider, parsed, count);
}

export async function searchResearchWeb(
  ...args: Parameters<typeof requestResearchWeb>
) {
  try {
    return await requestResearchWeb(...args);
  } catch (error) {
    if (args[4].aborted) throw args[4].reason;
    if (error instanceof AccessError) throw error;
    throw new AccessError(
      502,
      "검색 제공자와 연결하지 못했습니다. 설정과 연결 상태를 확인해 주세요.",
    );
  }
}
