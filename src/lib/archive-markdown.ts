import { posix } from "node:path";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { archivePath } from "./project-archive";

type Node = {
  type: string;
  url?: string;
  children?: Node[];
  position?: { start: { offset: number }; end: { offset: number } };
};
const parser = unified().use(remarkParse).use(remarkGfm);
// Work on Markdown URL nodes, keeping code fences, labels and prose untouched.
export function rewriteMarkdownUrls(
  body: string,
  transform: (url: string) => string | undefined,
) {
  const replacements: { start: number; end: number; value: string }[] = [];
  const visit = (node: Node) => {
    if (
      node.url &&
      node.position &&
      ["link", "image", "definition"].includes(node.type)
    ) {
      const next = transform(node.url);
      if (next !== undefined && next !== node.url) {
        const start = node.position.start.offset,
          end = node.position.end.offset;
        const raw = body.slice(start, end);
        const position = raw.lastIndexOf(node.url);
        if (position >= 0)
          replacements.push({
            start: start + position,
            end: start + position + node.url.length,
            value: next,
          });
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(parser.parse(body) as Node);
  for (const r of replacements.sort((a, b) => b.start - a.start))
    body = body.slice(0, r.start) + r.value + body.slice(r.end);
  return body;
}

export function resolveArchiveReference(
  pagePath: string,
  raw: string,
  paths: Set<string>,
) {
  let value: string;
  try {
    value = decodeURIComponent(raw.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  if (
    !value ||
    /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(value) ||
    value.includes("\\")
  )
    return null;
  // Native images can be project-relative or relative to the current wiki page.
  for (const candidate of [
    value,
    posix.normalize(posix.join(posix.dirname(pagePath), value)),
  ]) {
    const path = archivePath(candidate);
    if (path && paths.has(path)) return path;
  }
  return null;
}
