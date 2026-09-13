import "server-only";
import type { ChatWebReference } from "@/lib/chat-web";
import type { ChatScope } from "@/server/db/schema";
import { AccessError } from "@/server/errors";
import {
  availableResearchProviders,
  searchResearchWeb,
} from "@/server/research/search";

export function validateChatWeb(w: string, scope: ChatScope) {
  if (!scope.webProvider) return;
  if (scope.sourceOnly)
    throw new AccessError(
      400,
      "원문만 사용하는 질문에서는 웹 검색을 함께 사용할 수 없습니다.",
    );
  if (
    !availableResearchProviders(w).some(
      (item) => item.provider === scope.webProvider,
    )
  )
    throw new AccessError(
      503,
      "선택한 웹 검색 제공자가 이 작업공간에 연결되어 있지 않습니다. 웹 검색을 끄거나 연결 설정을 확인해 주세요.",
    );
}

export async function searchChatWeb(
  w: string,
  scope: ChatScope,
  query: string,
  signal: AbortSignal,
  existing: ChatWebReference[],
  topK = 5,
) {
  validateChatWeb(w, scope);
  if (!scope.webProvider)
    throw new AccessError(403, "이 질문에서 웹 검색을 허용하지 않았습니다.");
  if (!query.trim() || query.length > 4000)
    throw new AccessError(400, "웹 검색어를 확인해 주세요.");
  const results = await searchResearchWeb(
    w,
    { provider: scope.webProvider, engine: "google", categories: ["general"] },
    query.trim(),
    Math.max(1, Math.min(topK, 10)),
    signal,
  );
  signal.throwIfAborted();
  validateChatWeb(w, scope);
  const refs = [...existing];
  const urls = new Set(refs.map((ref) => ref.url.split("#")[0]));
  const searchedAt = new Date().toISOString();
  for (const result of results) {
    const url = result.url.split("#")[0];
    if (refs.length >= 20) break;
    if (!result.snippet.trim()) continue;
    if (urls.has(url)) {
      const index = refs.findIndex((ref) => ref.url.split("#")[0] === url);
      refs[index] = {
        ...refs[index],
        title: result.title,
        snippet: result.snippet.slice(0, 3000),
        searchedAt,
        query: query.trim(),
      };
      continue;
    }
    urls.add(url);
    refs.push({
      key: `W${refs.length + 1}`,
      title: result.title,
      url: result.url,
      snippet: result.snippet.slice(0, 3000),
      provider: scope.webProvider,
      query: query.trim(),
      searchedAt,
      used: false,
    });
  }
  return refs;
}
