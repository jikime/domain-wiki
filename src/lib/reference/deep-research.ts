// Ported from llm_wiki, Git 8bcf9b5.
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
import { stripBodyWikilinkPathPrefixes } from "./page-merge";
import { makeQueryFileName } from "./wiki-filename";

const MIN_RESEARCH_CONTENT_CHARS = 120;
const MIN_RESEARCH_BLOCK_CHARS = 40;

export interface ResearchSynthesisValidation {
  valid: boolean;
  cleaned: string;
  citedSourceIndexes: number[];
  error: string | null;
}

export function buildResearchPageContent(
  topic: string,
  date: string,
  synthesis: string,
  references: string,
): string {
  const displayTopic = topic.replace(/\s+/g, " ").trim();
  return stripBodyWikilinkPathPrefixes(
    [
      "---",
      "type: query",
      `title: ${JSON.stringify(`Research: ${displayTopic}`)}`,
      `created: ${date}`,
      "origin: deep-research",
      "tags: [research]",
      "---",
      "",
      `# Research: ${displayTopic}`,
      "",
      synthesis,
      "",
      "## References",
      "",
      references,
      "",
    ].join("\n"),
  );
}

export async function makeAvailableResearchFilePath(
  directory: string,
  fileName: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string> {
  const basePath = `${directory}/${fileName}`;
  if (!(await exists(basePath))) return basePath;

  const extensionIndex = fileName.toLowerCase().endsWith(".md")
    ? fileName.length - 3
    : fileName.length;
  const stem = fileName.slice(0, extensionIndex);
  const extension = fileName.slice(extensionIndex);
  for (let suffix = 2; suffix <= 999; suffix++) {
    const candidate = `${directory}/${stem}-${suffix}${extension}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${directory}/${stem}-${Date.now()}${extension}`;
}

export function addResearchTaskDiscriminator(
  fileName: string,
  taskId: string,
): string {
  const safeTaskId = taskId.replace(/[^A-Za-z0-9-]/g, "-").replace(/-+/g, "-");
  const extensionIndex = fileName.toLowerCase().endsWith(".md")
    ? fileName.length - 3
    : fileName.length;
  return `${fileName.slice(0, extensionIndex)}-${safeTaskId || "task"}${fileName.slice(extensionIndex)}`;
}

export function researchPageIdFromPath(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  return fileName.replace(/\.md$/i, "");
}

export function noResearchSourcesTaskPatch(sourceErrors: string[]): {
  status: "done" | "error";
  synthesis: string;
  error: string | null;
} {
  // If every selected source produced zero usable results and at least
  // one source failed, surface the failure state explicitly. Otherwise
  // the UI shows "completed" for a task that could not actually search.
  if (sourceErrors.length > 0) {
    return {
      status: "error",
      synthesis: "",
      error: sourceErrors.join("\n"),
    };
  }
  return {
    status: "done",
    synthesis: "No research sources found.",
    error: null,
  };
}

export function makeDeepResearchFileName(
  topic: string,
  now: Date = new Date(),
): {
  fileName: string;
  date: string;
} {
  const { fileName } = makeQueryFileName(`research-${topic}`, now);
  return { fileName, date: currentWikiDate(now) };
}

/**
 * Remove private reasoning before validating or persisting model output. Keep
 * this shared with the completion gate so content cannot pass validation and
 * then become empty after a different save-time cleanup.
 */
export function cleanResearchSynthesis(content: string): string {
  return content
    .replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>\s*/gi, "")
    .replace(/<think(?:ing)?>\s*[\s\S]*$/gi, "")
    .trim();
}

function meaningfulCharacterCount(content: string): number {
  // Unicode letters and numbers work across languages without relying on
  // localized section names or language-specific tokenization.
  return (content.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/** Return one-based source indexes cited with Markdown-style [N] markers. */
export function citedResearchSourceIndexes(
  content: string,
  sourceCount: number,
): number[] {
  const cited = new Set<number>();
  for (const match of content.matchAll(/\[([\d,\-\s]+)\]/g)) {
    for (const part of match[1].split(",")) {
      const range = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        if (start <= end && end - start <= sourceCount) {
          for (let index = start; index <= end; index++) {
            if (index >= 1 && index <= sourceCount) cited.add(index);
          }
        }
        continue;
      }
      const index = Number(part.trim());
      if (Number.isInteger(index) && index >= 1 && index <= sourceCount)
        cited.add(index);
    }
  }
  return [...cited].sort((a, b) => a - b);
}

/**
 * A completed research task must contain substantive prose and cite at least
 * one collected source. This is deliberately language-neutral: it evaluates
 * Unicode text structure rather than requiring named English/Chinese sections.
 */
export function validateResearchSynthesis(
  content: string,
  sourceCount: number,
): ResearchSynthesisValidation {
  const cleaned = cleanResearchSynthesis(content);
  const blocks = cleaned
    .split(/\n\s*\n/)
    .map((block) => block.replace(/^\s{0,3}#{1,6}\s+/gm, ""))
    .map(meaningfulCharacterCount)
    .filter((count) => count >= MIN_RESEARCH_BLOCK_CHARS);
  const meaningfulChars = meaningfulCharacterCount(cleaned);
  const citedSourceIndexes = citedResearchSourceIndexes(cleaned, sourceCount);

  if (meaningfulChars < MIN_RESEARCH_CONTENT_CHARS || blocks.length === 0) {
    return {
      valid: false,
      cleaned,
      citedSourceIndexes,
      error: "The research synthesis was empty or incomplete. Please retry.",
    };
  }
  if (sourceCount > 0 && citedSourceIndexes.length === 0) {
    return {
      valid: false,
      cleaned,
      citedSourceIndexes,
      error:
        "The research synthesis did not cite any collected sources. Please retry.",
    };
  }
  return { valid: true, cleaned, citedSourceIndexes, error: null };
}

export function currentWikiDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
