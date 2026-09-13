// Ported from llm_wiki src-tauri/src/commands/search.rs (8bcf9b5).
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
export const REFERENCE_SEARCH = {
  filenameExact: 200,
  titlePhrase: 50,
  contentPhrase: 20,
  phraseOccurrences: 10,
  titleToken: 5,
  contentToken: 1,
  rrfK: 60,
} as const;
export function referenceKeywordScore(input: {
  title: string;
  filename: string;
  content: string;
  query: string;
  groups: string[][];
}) {
  const phrase = input.query.trim().toLowerCase();
  const title = `${input.title} ${input.filename}`.toLowerCase();
  const content = input.content.toLowerCase();
  const stem = input.filename.toLowerCase().replace(/\.md$/, "");
  const occurrences = phrase ? content.split(phrase).length - 1 : 0;
  return (
    Number(!!phrase && stem === phrase) * REFERENCE_SEARCH.filenameExact +
    Number(!!phrase && title.includes(phrase)) * REFERENCE_SEARCH.titlePhrase +
    Math.min(occurrences, REFERENCE_SEARCH.phraseOccurrences) *
      REFERENCE_SEARCH.contentPhrase +
    input.groups.filter((g) => g.some((t) => title.includes(t.toLowerCase())))
      .length *
      REFERENCE_SEARCH.titleToken +
    input.groups.filter((g) => g.some((t) => content.includes(t.toLowerCase())))
      .length *
      REFERENCE_SEARCH.contentToken
  );
}
export function referenceGraphQuota(limit: number, vectorHits: number) {
  if (limit < 2) return 0;
  const coverage = Math.min(vectorHits, limit) / limit;
  return Math.max(
    1,
    Math.min(limit - 1, Math.ceil(limit * (0.3 - 0.15 * coverage))),
  );
}

// SQL expression inputs are trusted identifiers/placeholders, never user text.
// Phrase occurrences are non-overlapping, matching Rust str::matches.
export function referenceKeywordSql(input: {
  title: string;
  filename: string;
  content: string;
  groups: string;
  phrase: string;
}) {
  const t = `lower(${input.title}||' '||${input.filename})`,
    c = `lower(${input.content})`,
    q = input.phrase;
  const tokenScore = (column: string) =>
    `(SELECT count(*) FROM jsonb_array_elements(${input.groups}::jsonb) terms WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(terms) token WHERE strpos(${column},token)>0))`;
  return `(CASE WHEN ${q}<>'' AND regexp_replace(lower(${input.filename}), '\\.md$', '')=${q} THEN 200 ELSE 0 END
    + CASE WHEN ${q}<>'' AND strpos(${t},${q})>0 THEN 50 ELSE 0 END
    + LEAST(10,COALESCE((length(${c})-length(replace(${c},${q},'')))/NULLIF(length(${q}),0),0))*20
    + ${tokenScore(t)}*5 + ${tokenScore(c)})`;
}
