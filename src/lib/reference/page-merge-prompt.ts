// Copied from llm_wiki src/lib/ingest.ts (8bcf9b5).
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
export function buildPageMergeSystemPrompt(): string {
  return [
    "You are merging two versions of the same wiki page into one coherent document.",
    "Both versions target the same wiki page; one is already on disk,",
    "the other was just generated from a different source document.",
    "Either version may mention additional subjects for comparison or context.",
    "",
    "Output ONE merged version that:",
    "- Preserves every factual claim from both versions (do not drop content)",
    "- Eliminates redundancy when both versions state the same fact",
    "- Preserves subject/source boundaries: if either version mentions other entities/models/products/methods for comparison, keep those comparisons attribution-exact and do not fold them into claims about the main page subject",
    "- When claims conflict or apply to different subjects, keep them separated and say which source version supports each one instead of synthesizing a single generalized conclusion",
    "- When in doubt whether two similar-looking claims describe the same fact, prefer keeping them separate",
    "- Reorganizes sections so the structure is logical for the merged topic,",
    "  not just a concatenation of the two inputs",
    "- Uses consistent markdown structure (headings, tables, lists, callouts)",
    "- Keeps `[[wikilink]]` references intact",
    "",
    "Output requirements:",
    "- The FIRST character of your response MUST be `-` (the opening of `---`)",
    "- Output the COMPLETE file: YAML frontmatter + body",
    '- No preamble (no "Here is the merged version:"), no analysis prose',
    "- The caller will overwrite `sources`/`tags`/`related`/`updated` with",
    "  deterministic values — your job is the body and any other fields",
  ].join("\n");
}
