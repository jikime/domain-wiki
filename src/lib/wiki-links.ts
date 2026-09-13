import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { z } from "zod";
import { parseFrontmatter } from "./reference/frontmatter";
import {
  emptyWikiMetadata,
  type WikiMetadata,
  wikiMetadataSchema,
} from "./wiki-metadata";
import { normalizeWikiReference } from "./wiki-reference-index";

type Node = {
  type: string;
  url?: string;
  identifier?: string;
  value?: string;
  children?: Node[];
  position?: { start: { offset: number }; end: { offset: number } };
};
const parser = unified().use(remarkParse).use(remarkGfm);
export function markdownReferences(markdown: string) {
  const root = parser.parse(markdown) as Node;
  const nodes: Node[] = [];
  const visit = (node: Node) => {
    nodes.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  const definitions = new Map(
    nodes
      .filter((n) => n.type === "definition" && n.identifier && n.url)
      .map((n) => [n.identifier?.toLowerCase(), n.url]),
  );
  const urls = nodes.flatMap((node) =>
    node.type === "link" && node.url
      ? [node.url]
      : node.type === "linkReference" && node.identifier
        ? definitions.get(node.identifier.toLowerCase())
          ? [definitions.get(node.identifier.toLowerCase()) as string]
          : []
        : [],
  );
  return {
    urls: [...new Set(urls)],
    hasImages: nodes.some(
      (n) => n.type === "image" || n.type === "imageReference",
    ),
    hasHtml: nodes.some((n) => n.type === "html"),
    hasUnresolvedWikiLinks: nodes.some(
      (n) => n.type === "text" && /\[\[[^\]]+\]\]/.test(n.value ?? ""),
    ),
  };
}
export function wikiPageFromHref(href: string, workspaceId: string) {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(href, "https://wiki.invalid");
  } catch {
    return null;
  }
  const match = /^\/w\/([^/]+)\/wiki\/([^/]+)\/?$/.exec(url.pathname);
  if (
    !match ||
    match[1] !== workspaceId ||
    !z.uuid().safeParse(match[2]).success
  )
    return null;
  return match[2];
}
export function nativeWikiLinks(markdown: string) {
  const links: { target: string; start: number; end: number }[] = [];
  const visit = (node: Node) => {
    if (node.type === "text" && node.position) {
      const start = node.position.start.offset;
      const text = markdown.slice(start, node.position.end.offset);
      for (const match of text.matchAll(
        /(?<!!)\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g,
      )) {
        if (match.index > 0 && text[match.index - 1] === "\\") continue;
        links.push({
          target: match[1].trim(),
          start: start + match.index,
          end: start + match.index + match[0].length,
        });
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(parser.parse(markdown) as Node);
  return links;
}
export function wikiLinksFromMarkdown(
  markdown: string,
  workspaceId: string,
  index?: Map<string, string | null>,
) {
  return [
    ...new Set([
      ...markdownReferences(markdown).urls.flatMap((href) => {
        const pageId = wikiPageFromHref(href, workspaceId);
        return pageId ? [pageId] : [];
      }),
      ...nativeWikiLinks(markdown).flatMap((link) => {
        const key = normalizeWikiReference(link.target.split("#")[0]);
        const id = index
          ? index.get(key)
          : z.uuid().safeParse(key).success
            ? key
            : null;
        return id ? [id] : [];
      }),
    ]),
  ];
}
export function escapeMarkdownLabel(text: string) {
  return text.replace(/[\\[\]`*_<>]/g, "\\$&").replace(/\r?\n/g, " ");
}

// Keep the original stored Markdown intact; chat may only expose links inside its current scope.
export function wikiContextLinkRanges(
  markdown: string,
  workspaceId: string,
  index?: Map<string, string | null>,
) {
  const root = parser.parse(markdown) as Node;
  const definitions = new Map<string, string>();
  const collect = (node: Node) => {
    if (node.type === "definition" && node.identifier && node.url)
      definitions.set(node.identifier.toLowerCase(), node.url);
    for (const child of node.children ?? []) collect(child);
  };
  collect(root);
  const links: { pageId: string | null; start: number; end: number }[] = [];
  const visit = (node: Node) => {
    const href = ["link", "definition"].includes(node.type)
      ? node.url
      : node.type === "linkReference" && node.identifier
        ? definitions.get(node.identifier.toLowerCase())
        : undefined;
    if (href && /^\/w\/[^/]+\/wiki\//.test(href) && node.position) {
      links.push({
        pageId: wikiPageFromHref(href, workspaceId),
        start: node.position.start.offset,
        end: node.position.end.offset,
      });
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  for (const link of nativeWikiLinks(markdown)) {
    const key = normalizeWikiReference(link.target.split("#")[0]);
    const pageId = index
      ? index.get(key)
      : z.uuid().safeParse(key).success
        ? key
        : null;
    links.push({ pageId: pageId ?? null, start: link.start, end: link.end });
  }
  return links;
}

export function metadataFromMarkdown(
  body: string,
  workspaceId: string,
  pageId: string,
  previous: WikiMetadata = emptyWikiMetadata,
  index?: Map<string, string | null>,
): WikiMetadata {
  const reasons = new Map(previous.links.map((l) => [l.pageId, l.reason]));
  const frontmatter = parseFrontmatter(body).frontmatter;
  return wikiMetadataSchema.parse({
    ...previous,
    ...(frontmatter
      ? {
          frontmatter,
          ...(typeof frontmatter.type === "string"
            ? { type: frontmatter.type }
            : {}),
          ...(Array.isArray(frontmatter.aliases)
            ? { aliases: frontmatter.aliases }
            : {}),
        }
      : {}),
    links: wikiLinksFromMarkdown(body, workspaceId, index)
      .filter((id) => id !== pageId)
      .map((pageId) => ({
        pageId,
        reason: reasons.get(pageId) ?? "본문에서 연결한 위키",
      })),
  });
}
