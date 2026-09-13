// Copied from llm_wiki src/lib/ingest.ts. Copyright (C) 2024-2026 YongSu.
// SPDX-License-Identifier: GPL-3.0-only. See licenses/NOTICE.md.

export function currentWikiDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildDeterministicIngestLog(
  existing: string,
  sourceIdentity: string,
  date = currentWikiDate(),
): string {
  const entry = `## [${date}] ingest | ${sourceIdentity}`;
  return existing.trim()
    ? `${existing.trimEnd()}\n\n${entry}\n`
    : `# Wiki Log\n\n${entry}\n`;
}

export function updateBoundedRecentIndexSection(
  index: string,
  additions: string[],
): string {
  const section = "## Recently Updated";
  const lines = index.trimEnd().split("\n");
  const start = lines.findIndex((line) => line.trim() === section);
  const prefix = start >= 0 ? lines.slice(0, start) : lines;
  const sectionEnd =
    start >= 0
      ? lines.findIndex(
          (line, position) => position > start && /^##\s+/.test(line),
        )
      : -1;
  const existing =
    start >= 0
      ? lines
          .slice(start + 1, sectionEnd >= 0 ? sectionEnd : undefined)
          .filter((line) => /^-\s+/.test(line))
      : [];
  const suffix = sectionEnd >= 0 ? lines.slice(sectionEnd) : [];
  const recent = Array.from(new Set([...additions, ...existing])).slice(0, 200);
  return [
    ...prefix,
    "",
    section,
    ...recent,
    ...(suffix.length ? ["", ...suffix] : []),
    "",
  ].join("\n");
}
