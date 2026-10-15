import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Root, RootContent } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { workbookDownloads, workbookPages } from "../lib/workbook";
import {
  prepareWorkbook,
  readWorkbookFile,
  workbookLink,
  workbookMarkdownPlugin,
} from "./workbook";

test("다운로드는 등록된 교육 자료만 읽고 설정 파일·상위 경로를 거부한다", async () => {
  for (const file of [
    "../../.env.local",
    ".env.local",
    "/etc/passwd",
    "samples/../README.md",
    "instructor/secret.md",
    "preparation.md",
    "instructor/guide.md",
    "instructor/materials/rfp-answer.md",
    "instructor/reference/term-aliases.ts.txt",
  ]) {
    assert.equal(await readWorkbookFile(file), null);
  }
  for (const file of workbookDownloads) {
    const result = await readWorkbookFile(file);
    assert.ok(result && result.length > 0, file);
  }
});

test("중첩 원고의 상대 링크와 한글 앵커를 웹 문서·실습 다운로드로 연결한다", () => {
  assert.equal(
    workbookLink("weeks/03-domain.md", "../samples/01-project-a.md"),
    "/workbook/sample-project-a",
  );
  assert.equal(
    decodeURIComponent(
      workbookLink(
        "wiki-chat-guide.md",
        "weeks/01-experience.md#6-실습-c--자료-한-건으로-업무-흐름-확인하기",
      ),
    ),
    "/workbook/week-01#6-실습-c--자료-한-건으로-업무-흐름-확인하기",
  );
  assert.equal(
    workbookLink(
      "weeks/04-evaluation.md",
      "../samples/evaluation-questions.csv",
    ),
    "/workbook/files/samples/evaluation-questions.csv",
  );
  assert.equal(
    workbookLink("README.md", "https://example.com/reference"),
    "https://example.com/reference",
  );
});

test("한글·서식·중복 제목의 목차와 실제 본문 앵커가 일치한다", () => {
  const content =
    "# 안내\n\n## 1. **자료** · 확인\n\n## 1. 자료 · 확인\n\n## 1. 자료 · 확인-1\n\n## 1. 자료 · 확인\n";
  const headings = prepareWorkbook(content, "chapter--");
  const tree = unified().use(remarkParse).parse(content);
  workbookMarkdownPlugin({ file: "README.md", prefix: "chapter--" })(tree);
  const rendered = tree.children
    .filter((node) => node.type === "heading")
    .map((node) => node.data?.hProperties?.id);
  assert.deepEqual(
    rendered,
    headings.map((heading) => heading.id),
  );
  assert.equal(new Set(rendered).size, rendered.length);
  assert.ok(rendered.includes("chapter--1-자료--확인"));
});

test("인쇄본 내부 이동은 후반 실습 자료까지 문서별 앵커로 연결한다", () => {
  assert.equal(
    decodeURIComponent(
      workbookLink("README.md", "start-here.md#어디에-입력하나요", true),
    ),
    "#start-here--어디에-입력하나요",
  );
  assert.equal(
    workbookLink("README.md", "instructor/materials/acceptance-v2.md", true),
    "#acceptance-v2",
  );
  assert.equal(
    workbookLink("README.md", "instructor/materials/new-rfp.md", true),
    "#new-rfp",
  );
});

test("전체 교재의 내부 링크와 소목차가 실제 문서·제목으로 이어진다", async () => {
  const all = new Map(
    await Promise.all(
      workbookPages.map(
        async (page) =>
          [
            page.slug,
            prepareWorkbook(
              await readFile(`docs/training/${page.file}`, "utf8"),
            ),
          ] as const,
      ),
    ),
  );
  assert.equal(
    new Set(workbookPages.map((page) => page.slug)).size,
    workbookPages.length,
  );
  const broken: string[] = [];
  for (const page of workbookPages) {
    const content = await readFile(`docs/training/${page.file}`, "utf8");
    const tree = unified().use(remarkParse).parse(content);
    const visit = (node: Root | RootContent) => {
      if (node.type === "link" || node.type === "definition") {
        const url = new URL(
          workbookLink(page.file, node.url),
          "https://workbook.invalid",
        );
        if (
          url.origin === "https://workbook.invalid" &&
          url.pathname.startsWith("/workbook/") &&
          !url.pathname.startsWith("/workbook/files/")
        ) {
          const target = all.get(url.pathname.slice("/workbook/".length));
          if (
            !target ||
            (url.hash &&
              !target.some(
                (heading) =>
                  heading.id === decodeURIComponent(url.hash.slice(1)),
              ))
          )
            broken.push(`${page.file}: ${node.url}`);
        }
      }
      if ("children" in node)
        node.children.forEach((child) => {
          visit(child as RootContent);
        });
    };
    visit(tree);
  }
  assert.deepEqual(broken, []);
});
