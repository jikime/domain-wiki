import type { researchProviders } from "./research";
import { escapeMarkdownLabel } from "./wiki-links";

export type ChatWebProvider = (typeof researchProviders)[number];
export type ChatWebReference = {
  key: string;
  title: string;
  url: string;
  snippet: string;
  provider: ChatWebProvider;
  query: string;
  searchedAt: string;
  used: boolean;
};

export function chatWebContext(refs: ChatWebReference[], budget: number) {
  const fitted: ChatWebReference[] = [];
  let used = 2;
  for (const ref of refs) {
    const base = JSON.stringify({
      id: ref.key,
      title: ref.title,
      url: ref.url,
      searchedAt: ref.searchedAt,
      quote: "",
    }).length;
    let quote = ref.snippet.slice(
      0,
      Math.max(0, Math.min(3000, budget - used - base - 10)),
    );
    while (quote && JSON.stringify(quote).length > budget - used - base)
      quote = quote.slice(0, Math.floor(quote.length * 0.9));
    if (quote.length < Math.min(80, ref.snippet.length) || !quote) continue;
    fitted.push({ ...ref, snippet: quote });
    used += base + JSON.stringify(quote).length + 2;
  }
  return {
    refs: fitted,
    text: JSON.stringify(
      fitted.map((ref) => ({
        id: ref.key,
        title: ref.title,
        url: ref.url,
        searchedAt: ref.searchedAt,
        quote: ref.snippet,
      })),
    ),
  };
}

export function chatWebAppendix(refs: ChatWebReference[]) {
  const used = refs.filter((ref) => ref.used);
  if (!used.length) return "";
  return `\n\n## 웹 검색 참고\n\n검색 당시의 발췌입니다. 업무 기준에 적용하기 전에 원문과 적용 조건을 검토해 주세요.\n\n${used.map((ref) => `[${ref.key}]: <${ref.url}>\n\n- [${escapeMarkdownLabel(ref.title)}](<${ref.url}>) · ${ref.searchedAt} 검색\n\n> ${ref.snippet.replace(/\r?\n/g, "\n> ")}`).join("\n\n")}`;
}
