// Ported from llm_wiki, Git 8bcf9b5.
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
import { normalizeReviewTitle } from "./review-utils";
export type ReviewItem = {
  id: string;
  type: string;
  title: string;
  description?: string;
  affectedPages?: string[];
};
interface WikiPageSummary {
  id: string; // filename without .md
  title: string | null; // from frontmatter
}

export interface WikiIndex {
  byId: Set<string>;
  byTitle: Set<string>;
  pages: WikiPageSummary[];
}

function extractCandidateNames(item: ReviewItem): string[] {
  const names = new Set<string>();

  // The review title itself is often the missing page name
  // e.g. "Missing page: 注意力机制" or "注意力机制"
  const cleaned = normalizeReviewTitle(item.title);
  if (cleaned && cleaned.length <= 100) {
    names.add(cleaned);
  }

  // Also check affectedPages — these reference files directly
  for (const page of item.affectedPages ?? []) {
    const base = page.split("/").pop()?.replace(/\.md$/, "");
    if (base) names.add(base.toLowerCase());
  }

  return Array.from(names);
}

/** Check if a candidate name matches an existing wiki page */
function pageExists(name: string, index: WikiIndex): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;

  // Exact filename match (kebab-case or matching existing id)
  if (index.byId.has(normalized)) return true;
  if (index.byId.has(normalized.replace(/\s+/g, "-"))) return true;

  // Exact title match (from frontmatter)
  if (index.byTitle.has(normalized)) return true;

  return false;
}

/**
 * Extract a JSON object from an LLM response.
 *
 * Handles:
 *   - Bare JSON: `{...}`
 *   - Fenced: ` ```json\n{...}\n``` ` or single-line ` ```{...}``` `
 *   - Wrapped in prose: find the first balanced `{...}` object via brace depth
 *
 * Returns empty string if no balanced object is found.
 *
 * @internal Exported for unit tests only.
 */
export function extractJsonObject(raw: string): string {
  let text = raw.trim();

  // Strip an opening ```json or ``` fence (with or without newline)
  text = text.replace(/^```(?:json)?\s*/i, "");
  // Strip a trailing ``` fence
  text = text.replace(/\s*```\s*$/i, "");
  text = text.trim();

  // Walk brace depth to find the first complete {...}, respecting strings/escapes
  const start = text.indexOf("{");
  if (start === -1) return "";

  let depth = 0;
  let inString = false;
  // biome-ignore lint/suspicious/noShadowRestrictedNames: Preserve the upstream JSON parser.
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return "";
}

export function sweepJudgePrompt(
  batch: ReviewItem[],
  index: WikiIndex,
): string {
  const pages = index.pages.slice(0, 300);

  const pageList = pages
    .map((p) => (p.title ? `- ${p.id}  (title: ${p.title})` : `- ${p.id}`))
    .join("\n");

  const reviewList = batch
    .map((r) => {
      const affected = r.affectedPages?.length
        ? ` | affected: ${r.affectedPages.join(", ")}`
        : "";
      const desc = r.description ? ` — ${r.description.slice(0, 200)}` : "";
      return `- id=${r.id} [${r.type}] "${r.title}"${desc}${affected}`;
    })
    .join("\n");

  const prompt = [
    "You are cleaning up a stale review queue for a personal wiki.",
    "After recent ingests, some review items may no longer be valid because the missing page now exists, the duplicate was resolved, or the referenced concept has been added.",
    "",
    "Current wiki pages (filename, optional title):",
    pageList || "(no pages yet)",
    "",
    "Pending review items to judge:",
    reviewList,
    "",
    "For each review item, decide whether the underlying condition has been RESOLVED by the current wiki state.",
    "Be conservative: only mark as resolved if you are confident the concern no longer applies.",
    "For contradictions, confirmations, or human-judgment items, default to keeping them pending.",
    "",
    'Respond with ONLY a JSON object in this exact shape: {"resolved": ["id1", "id2"]}',
    'If none of the items are resolved, return exactly: {"resolved": []}',
    "Do not wrap in markdown fences. Do not add commentary.",
  ].join("\n");

  return prompt;
}
export function ruleResolvedReview(
  item: ReviewItem,
  index: WikiIndex,
): boolean {
  if (item.type === "missing-page")
    return extractCandidateNames(item).some((name) => pageExists(name, index));
  if (item.type === "duplicate" && item.affectedPages?.length)
    return !item.affectedPages.every((p) => {
      const base = p.split("/").pop()?.replace(/\.md$/, "").toLowerCase();
      return base ? index.byId.has(base) : false;
    });
  return false;
}
