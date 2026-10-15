import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Root, RootContent } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import {
  workbookDownloadHref,
  workbookDownloads,
  workbookHref,
  workbookPages,
} from "@/lib/workbook";

export async function readWorkbookFile(file: string) {
  if (!workbookDownloads.includes(file)) return null;
  return readFile(path.join(process.cwd(), "docs/training", file));
}

export function workbookLink(
  file: string,
  href: string,
  print = false,
): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(href)) return href;
  const base = new URL(`https://workbook.invalid/docs/training/${file}`);
  const target = new URL(href, base);
  const relative = decodeURIComponent(target.pathname).replace(
    /^\/docs\/training\//,
    "",
  );
  const page = workbookPages.find((item) => item.file === relative);
  if (page) {
    if (print) {
      return `#${page.slug}${target.hash ? `--${target.hash.slice(1)}` : ""}`;
    }
    return `${workbookHref(page.slug)}${target.hash}`;
  }
  if (workbookDownloads.includes(relative))
    return workbookDownloadHref(relative);
  return `https://github.com/jikime/domain-wiki/blob/main${target.pathname}${target.hash}`;
}

function plainText(node: Root | RootContent): string {
  if ("value" in node) return node.value;
  if ("children" in node)
    return node.children
      .map((child) => plainText(child as RootContent))
      .join("");
  return "";
}

export type WorkbookHeading = { id: string; text: string; level: number };
export function prepareWorkbook(markdown: string, prefix = "") {
  const headings: WorkbookHeading[] = [];
  const ids = new Set<string>();
  const tree = unified().use(remarkParse).parse(markdown);
  for (const node of tree.children) {
    if (node.type !== "heading") continue;
    const text = plainText(node);
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
      .replace(/ /g, "-");
    let id = base;
    let suffix = 0;
    while (ids.has(id)) id = `${base}-${++suffix}`;
    ids.add(id);
    headings.push({ id: `${prefix}${id}`, text, level: node.depth });
  }
  return headings;
}

export function workbookMarkdownPlugin(options: {
  file: string;
  print?: boolean;
  prefix?: string;
}) {
  return (tree: Root) => {
    const ids = new Set<string>();
    const walk = (node: Root | RootContent) => {
      if (node.type === "heading") {
        const base = plainText(node)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
          .replace(/ /g, "-");
        let id = base;
        let suffix = 0;
        while (ids.has(id)) id = `${base}-${++suffix}`;
        ids.add(id);
        node.data = {
          ...node.data,
          hProperties: { id: `${options.prefix ?? ""}${id}` },
        };
      }
      if (node.type === "link" || node.type === "definition")
        node.url = workbookLink(options.file, node.url, options.print);
      if ("children" in node)
        for (const child of node.children) walk(child as RootContent);
    };
    walk(tree);
  };
}
