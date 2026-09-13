import type { Term } from "@/server/db/schema";
import { retrievalTokens } from "./chat";

const normalize = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Only administrator-declared equivalents are expanded; definitions are not treated as synonyms.
export function searchGroups(
  query: string,
  terms: Term[],
  natural = false,
): string[][] {
  let rest = normalize(query);
  const matched: string[][] = [];
  const declared = terms
    .filter((t) => t.aliases?.length)
    .map((t) => [...new Set([t.term, ...(t.aliases ?? [])].map(normalize))])
    .sort(
      (a, b) =>
        Math.max(...b.map((s) => s.length)) -
        Math.max(...a.map((s) => s.length)),
    );
  for (const group of declared) {
    const variants = [...group]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegex)
      .join("|");
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])(?:${variants})(?:에서는|에서|으로|에는|은|는|을|를|이|가|와|과|의)?(?=$|[^\\p{L}\\p{N}])`,
      "gu",
    );
    if (pattern.test(rest)) {
      matched.push(group);
      rest = rest.replace(pattern, " ");
    }
  }
  const words = natural
    ? retrievalTokens(rest)
    : rest.split(/\s+/).filter(Boolean);
  return [...matched, ...[...new Set(words)].map((w) => [w])].slice(0, 24);
}
