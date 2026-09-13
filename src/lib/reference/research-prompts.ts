// Ported from llm_wiki, Git 8bcf9b5.
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
export function researchLanguageDirective(promptLang = "Korean") {
  return [
    `## ⚠️ MANDATORY OUTPUT LANGUAGE: ${promptLang}`,
    "",
    `Write surrounding natural-language prose in **${promptLang}**.`,
    `All generated prose, including prose titles and section headings, must be in ${promptLang}.`,
    `Do not translate, transliterate, or describe proper nouns and technical identifiers unless the source already uses a well-established localized form.`,
    `Preserve organization names, product names, model names, dataset names, tool/library names, acronyms, code identifiers, file names, URLs, paper titles, citation strings, and technical terms that have no widely-used localized equivalent in their standard original form.`,
    `The source material or wiki content may be in a different language; use it as evidence, but keep generated prose in ${promptLang}.`,
    `This language rule overrides weaker style instructions, but it does not override the proper-noun and technical-identifier preservation rule above.`,
  ].join("\n");
}
export function optimizeResearchPrompt(
  gapTitle: string,
  gapDescription: string,
  gapType: string,
  overview: string,
  purpose: string,
) {
  const prompt = [
    "You are a research assistant. Given a knowledge gap found in a personal wiki, generate a precise research topic and search queries.",
    "",
    researchLanguageDirective(),
    "",
    "## Wiki Context",
    purpose ? `### Purpose\n${purpose}` : "",
    overview ? `### Current Overview\n${overview}` : "",
    "",
    "## Knowledge Gap",
    `Type: ${gapType}`,
    `Title: ${gapTitle}`,
    `Description: ${gapDescription}`,
    "",
    "## Task",
    "Generate a research topic and search queries that are specific to this wiki's domain and purpose.",
    "The topic should precisely describe what information would fill this knowledge gap.",
    "The search queries should be optimized for web search engines — keyword-rich, specific, not generic.",
    "",
    "## Output Format (STRICT — follow exactly, no other text)",
    "Respond with EXACTLY 4 lines, no more:",
    "TOPIC: <one sentence — MUST be in the mandatory output language declared above>",
    "QUERY: <query 1 — may use English keywords if they better match search engines>",
    "QUERY: <query 2>",
    "QUERY: <query 3>",
  ]
    .filter(Boolean)
    .join("\n");

  return prompt;
}
export function parseOptimizedResearchTopic(result: string, gapTitle: string) {
  // Parse response
  const topicMatch = result.match(/^TOPIC:\s*(.+)$/m);
  const queryMatches = [...result.matchAll(/^QUERY:\s*(.+)$/gm)];

  const topic = topicMatch?.[1]?.trim() ?? gapTitle;
  const searchQueries = queryMatches
    .slice(0, 3)
    .map((m) => m[1].trim())
    .filter((q) => q.length > 0);

  return {
    topic,
    searchQueries: searchQueries.length > 0 ? searchQueries : [topic],
  };
}
export function researchSynthesisPrompt(wikiIndex: string) {
  const systemPrompt = [
    "You are a research assistant. Synthesize the collected research sources into a comprehensive wiki page.",
    "",
    researchLanguageDirective(),
    "",
    "## Cross-referencing (IMPORTANT)",
    "- The wiki already has existing pages listed in the Wiki Index below.",
    "- When your synthesis mentions an entity or concept that exists in the wiki, ALWAYS use [[wikilink]] syntax to link to it.",
    "- For example, if the wiki has an entity 'anthropic', write [[anthropic]] when mentioning it.",
    "- This is critical for connecting new research to existing knowledge in the graph.",
    "",
    "## Writing Rules",
    "- Organize into clear sections with headings",
    "- Cite sources using [N] notation",
    "- Note contradictions or gaps",
    "- Suggest additional sources worth finding",
    "- Neutral, encyclopedic tone",
    "",
    wikiIndex
      ? `## Existing Wiki Index (link to these pages with [[wikilink]])\n${wikiIndex}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return systemPrompt;
}
