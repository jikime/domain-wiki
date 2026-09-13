"use client";
import type { Element, Root } from "hast";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { safeMarkdownImageSrc } from "@/lib/markdown-image";
import { parseFrontmatter } from "@/lib/reference/frontmatter";
import { normalizeEditableMarkdown } from "@/lib/reference/selection-edit";
import {
  transformImageEmbeds,
  transformWikilinks,
} from "@/lib/reference/wikilink-transform";
import { markdownComponents } from "./markdown-components";
export function Markdown({
  children,
  linkDestinations,
}: {
  children: string;
  linkDestinations?: Record<string, string>;
}) {
  const parsed = parseFrontmatter(normalizeEditableMarkdown(children));
  const content = transformWikilinks(transformImageEmbeds(parsed.body));
  // Original WikiReader maps transformed Markdown blocks through source line starts.
  const sourceLines = [0];
  for (let index = 0; index < parsed.body.length; index++) {
    if (parsed.body.charCodeAt(index) === 10) sourceLines.push(index + 1);
  }
  const sourcePositions = () => (tree: Root) => {
    const walk = (node: Root | Element) => {
      if (
        node.type === "element" &&
        [
          "p",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "li",
          "blockquote",
          "td",
          "th",
          "pre",
        ].includes(node.tagName)
      ) {
        const startLine = node.position?.start.line,
          endLine = node.position?.end.line;
        if (startLine && endLine && sourceLines[startLine - 1] !== undefined) {
          node.properties["data-source-start"] =
            parsed.rawBlock.length + sourceLines[startLine - 1];
          node.properties["data-source-end"] =
            parsed.rawBlock.length +
            (sourceLines[endLine] ?? parsed.body.length);
        }
      }
      for (const child of node.children)
        if (child.type === "element") walk(child);
    };
    walk(tree);
  };
  return (
    <div className="wiki-markdown">
      {parsed.frontmatter && (
        <details className="markdown-frontmatter">
          <summary>문서 속성</summary>
          <dl>
            {Object.entries(parsed.frontmatter).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{Array.isArray(value) ? value.join(", ") : value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <ReactMarkdown
        components={
          linkDestinations
            ? {
                ...markdownComponents,
                a: ({ href, children }) => (
                  <a href={href ? (linkDestinations[href] ?? href) : undefined}>
                    {children}
                  </a>
                ),
              }
            : markdownComponents
        }
        skipHtml
        urlTransform={(url, key) =>
          key === "src"
            ? safeMarkdownImageSrc(linkDestinations?.[url] ?? url)
            : defaultUrlTransform(url)
        }
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          sourcePositions,
          [rehypeKatex, { throwOnError: false, strict: false, trust: false }],
        ]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
