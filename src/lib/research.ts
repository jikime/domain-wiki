import { z } from "zod";
import type { CitationSnapshot } from "@/server/db/schema";

export const researchProviders = [
  "firecrawl",
  "searxng",
  "tavily",
  "ollama",
  "brave",
  "bocha",
  "serpapi",
] as const;
export const researchProviderLabels: Record<
  (typeof researchProviders)[number],
  string
> = {
  firecrawl: "Firecrawl",
  searxng: "SearXNG",
  tavily: "Tavily",
  ollama: "Ollama",
  brave: "Brave",
  bocha: "Bocha",
  serpapi: "SerpApi",
};
export const researchEngines = [
  "google",
  "google_news",
  "google_scholar",
  "google_patents",
  "bing",
  "duckduckgo",
  "google_images",
  "google_videos",
  "youtube",
] as const;
export const researchCategories = [
  "general",
  "news",
  "science",
  "it",
  "images",
  "videos",
  "files",
  "map",
  "music",
  "social media",
] as const;
export const researchScopeInput = z.object({
  domainId: z.uuid(),
  projectId: z.uuid().nullable().default(null),
});
export const researchOriginInput = z
  .object({
    kind: z.enum(["manual", "graph", "review"]).default("manual"),
    reviewId: z.uuid().optional(),
    pageIds: z.array(z.uuid()).max(20).default([]),
    description: z.string().trim().max(4000).default(""),
    gapType: z.string().trim().max(80).default("suggestion"),
  })
  .strict()
  .refine(
    (origin) =>
      origin.kind === "review" ? !!origin.reviewId : !origin.reviewId,
    "검토 항목 연결을 확인해 주세요.",
  );
export const researchInput = researchScopeInput
  .extend({
    requestId: z.uuid(),
    topic: z.string().trim().min(1).max(150),
    queries: z.array(z.string().trim().min(1).max(400)).min(1).max(10),
    sourceMode: z.enum(["web", "local", "both"]).default("local"),
    provider: z.enum(researchProviders).nullable().default(null),
    engine: z.enum(researchEngines).default("google"),
    categories: z
      .array(z.enum(researchCategories))
      .min(1)
      .max(10)
      .default(["general"]),
    origin: researchOriginInput.default({
      kind: "manual",
      pageIds: [],
      description: "",
      gapType: "suggestion",
    }),
  })
  .strict();
export type ResearchInput = z.infer<typeof researchInput>;
export type ResearchReference = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  citation?: CitationSnapshot;
};
export const researchStates: Record<string, string> = {
  queued: "대기",
  searching: "자료 수집 중",
  synthesizing: "조사 내용 작성 중",
  saving: "초안 저장 중",
  completed: "완료",
  failed: "실패",
  canceled: "중지",
  outdated: "근거 변경",
};
export const activeResearchStates = [
  "queued",
  "searching",
  "synthesizing",
  "saving",
];

// Same ordering, limits and URL identity as upstream collectResearchSources;
// local search is provided by the server's scoped corpus instead of a desktop file index.
export async function collectResearchSources(
  queries: string[],
  mode: ResearchInput["sourceMode"],
  deps: {
    web?: (query: string, limit: number) => Promise<ResearchReference[]>;
    local?: (queries: string[], limit: number) => Promise<ResearchReference[]>;
  },
) {
  const calls: Promise<ResearchReference[]>[] = [];
  const normalized = queries.map((query) => query.trim()).filter(Boolean);
  if (mode !== "local" && deps.web)
    for (const query of normalized) calls.push(deps.web(query, 5));
  if (mode !== "web" && deps.local && normalized.length)
    calls.push(deps.local(normalized, 15));
  const results: ResearchReference[] = [],
    errors: string[] = [],
    seen = new Set<string>();
  for (const item of await Promise.allSettled(calls)) {
    if (item.status === "rejected") {
      errors.push(
        item.reason instanceof Error
          ? item.reason.message
          : "자료 검색에 실패했습니다.",
      );
      continue;
    }
    for (const result of item.value) {
      if (results.length >= 20) break;
      const key = (
        result.url || `${result.source}:${result.title}:${result.snippet}`
      ).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        results.push(result);
      }
    }
  }
  return { results, errors };
}

export const researchEngineLabels: Record<
  (typeof researchEngines)[number],
  string
> = {
  google: "Google 일반",
  google_news: "Google 뉴스",
  google_scholar: "Google 학술",
  google_patents: "Google 특허",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
  google_images: "Google 이미지",
  google_videos: "Google 동영상",
  youtube: "YouTube",
};
export const researchCategoryLabels: Record<
  (typeof researchCategories)[number],
  string
> = {
  general: "일반",
  news: "뉴스",
  science: "과학",
  it: "정보기술",
  images: "이미지",
  videos: "동영상",
  files: "파일",
  map: "지도",
  music: "음악",
  "social media": "소셜 미디어",
};
