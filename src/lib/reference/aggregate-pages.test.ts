// Original ingest-parse.test.ts assertions. GPL-3.0-only; see licenses/NOTICE.md.
import { describe, expect, it } from "vitest";
import {
  buildDeterministicIngestLog,
  updateBoundedRecentIndexSection,
} from "./aggregate-pages";

describe("deterministic aggregate pages", () => {
  it("builds an append-only log entry without another LLM call", () => {
    expect(
      buildDeterministicIngestLog("", "raw/sources/a.pdf", "2026-07-20"),
    ).toBe("# Wiki Log\n\n## [2026-07-20] ingest | raw/sources/a.pdf\n");
    expect(
      buildDeterministicIngestLog(
        "# Wiki Log\n",
        "raw/sources/b.pdf",
        "2026-07-20",
      ),
    ).toBe("# Wiki Log\n\n## [2026-07-20] ingest | raw/sources/b.pdf\n");
  });
  it("bounds recent entries and preserves following sections", () => {
    const existing = [
      "# Wiki Index",
      "",
      "## Recently Updated",
      ...Array.from({ length: 205 }, (_, i) => `- [[old-${i}]] — Old ${i}`),
      "",
      "## Other",
      "Keep me",
    ].join("\n");
    const result = updateBoundedRecentIndexSection(existing, [
      "- [[new]] — New",
    ]);
    const recent = result.split("## Recently Updated")[1].split("## Other")[0];
    expect(recent.match(/^- \[\[/gm)).toHaveLength(200);
    expect(recent).toContain("[[new]]");
    expect(result).toContain("## Other\nKeep me");
  });
});
