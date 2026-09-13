// Ported from llm_wiki, Git 8bcf9b5.
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  addResearchTaskDiscriminator,
  buildResearchPageContent,
  citedResearchSourceIndexes,
  makeAvailableResearchFilePath,
  makeDeepResearchFileName,
  noResearchSourcesTaskPatch,
  researchPageIdFromPath,
  validateResearchSynthesis,
} from "./deep-research";

describe("makeDeepResearchFileName", () => {
  it("keeps Unicode topics and includes time to avoid same-day overwrite", () => {
    const first = makeDeepResearchFileName(
      "反硝化除磷",
      new Date("2026-06-06T10:00:00.000Z"),
    );
    const second = makeDeepResearchFileName(
      "反硝化除磷",
      new Date("2026-06-06T10:00:01.000Z"),
    );

    expect(first.fileName).toBe("research-反硝化除磷-2026-06-06-100000.md");
    expect(second.fileName).toBe("research-反硝化除磷-2026-06-06-100001.md");
    expect(first.fileName).not.toBe(second.fileName);
  });

  it("uses the local calendar date for frontmatter metadata", () => {
    const localMorning = new Date(2026, 5, 6, 1, 30, 0);

    expect(makeDeepResearchFileName("政策版本差异", localMorning).date).toBe(
      "2026-06-06",
    );
  });
});

describe("buildResearchPageContent", () => {
  it("normalizes path-prefixed page links without changing code or embeds", () => {
    const content = buildResearchPageContent(
      "AI research",
      "2026-08-20",
      [
        "See [[concepts/adaptation|adaptation]] and [[entities/person#work]].",
        "Keep `[[concepts/code-example]]` and ![[media/chart.png]].",
      ].join("\n"),
      "1. [Source](https://example.com)",
    );

    expect(content).toContain("[[adaptation|adaptation]]");
    expect(content).toContain("[[person#work]]");
    expect(content).toContain("`[[concepts/code-example]]`");
    expect(content).toContain("![[media/chart.png]]");
  });

  it("keeps multiline topics inside one safe YAML scalar and heading", () => {
    const content = buildResearchPageContent(
      'first line\nsecond: "quoted"',
      "2026-08-20",
      "Substantive synthesis [1].",
      "1. [Source](https://example.com)",
    );
    expect(content).toContain(
      'title: "Research: first line second: \\"quoted\\""',
    );
    expect(content).toContain('# Research: first line second: "quoted"');
    expect(content).not.toContain("first line\nsecond");
  });
});

describe("makeAvailableResearchFilePath", () => {
  it("adds a suffix instead of overwriting a same-second research result", async () => {
    const existing = new Set([
      "/project/wiki/queries/research-topic-2026-08-20-120000.md",
      "/project/wiki/queries/research-topic-2026-08-20-120000-2.md",
    ]);
    await expect(
      makeAvailableResearchFilePath(
        "/project/wiki/queries",
        "research-topic-2026-08-20-120000.md",
        async (path) => existing.has(path),
      ),
    ).resolves.toBe(
      "/project/wiki/queries/research-topic-2026-08-20-120000-3.md",
    );
  });

  it("gives concurrent tasks distinct readable filenames before existence checks", () => {
    const fileName = "research-topic-2026-08-20-120000.md";
    expect(addResearchTaskDiscriminator(fileName, "research-41")).toBe(
      "research-topic-2026-08-20-120000-research-41.md",
    );
    expect(addResearchTaskDiscriminator(fileName, "research-42")).not.toBe(
      addResearchTaskDiscriminator(fileName, "research-41"),
    );
  });

  it("derives the vector page id from the final collision-safe path", () => {
    expect(
      researchPageIdFromPath(
        "/project/wiki/queries/research-topic-2026-08-20-120000-research-41-2.md",
      ),
    ).toBe("research-topic-2026-08-20-120000-research-41-2");
    expect(
      researchPageIdFromPath("C:\\project\\wiki\\queries\\research-topic-3.MD"),
    ).toBe("research-topic-3");
  });
});

describe("validateResearchSynthesis", () => {
  const substantiveChinese = [
    "解离是一类涉及记忆、身份、意识与环境感知连续性受扰的心理现象。[1]",
    "现有研究通常区分短暂的正常体验与造成显著痛苦或功能损害的临床表现。评估时需要结合持续时间、诱因、共病情况以及对日常生活的影响，不能仅凭单一症状下结论。[2]",
    "不同理论模型对其机制仍有分歧，因此研究结论需要结合样本来源、测量工具与临床背景解释。现有证据更适合支持分层评估，而不是把单项自评结果直接视为诊断。",
  ].join("\n\n");

  it("rejects empty, reasoning-only, and short output", () => {
    expect(validateResearchSynthesis("", 2).valid).toBe(false);
    expect(
      validateResearchSynthesis("<think>private reasoning only</think>", 2)
        .valid,
    ).toBe(false);
    expect(validateResearchSynthesis("## 概述\n\n内容很短。[1]", 2).valid).toBe(
      false,
    );
  });

  it("accepts substantive Unicode prose with a valid citation", () => {
    const result = validateResearchSynthesis(substantiveChinese, 2);

    expect(result.valid).toBe(true);
    expect(result.citedSourceIndexes).toEqual([1, 2]);
  });

  it("rejects substantive output that cites no collected source", () => {
    const result = validateResearchSynthesis(
      substantiveChinese.replace(/\[\d+\]/g, ""),
      2,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("did not cite");
  });

  it("extracts valid citation groups and bounded ranges", () => {
    expect(
      citedResearchSourceIndexes(
        "Evidence [3, 1] and comparison [4-5], ignore [0] [8].",
        5,
      ),
    ).toEqual([1, 3, 4, 5]);
  });
});

describe("noResearchSourcesTaskPatch", () => {
  it("marks source failures as an error instead of completed", () => {
    expect(
      noResearchSourcesTaskPatch([
        "Firecrawl blocked this IP",
        "AnyTXT offline",
      ]),
    ).toEqual({
      status: "error",
      synthesis: "",
      error: "Firecrawl blocked this IP\nAnyTXT offline",
    });
  });

  it("marks an empty successful search as done", () => {
    expect(noResearchSourcesTaskPatch([])).toEqual({
      status: "done",
      synthesis: "No research sources found.",
      error: null,
    });
  });
});
