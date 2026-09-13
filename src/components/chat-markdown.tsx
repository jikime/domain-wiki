"use client";
import { type ComponentProps, createContext, useContext } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Button } from "@/components/ui/button";
import { safeMarkdownImageSrc } from "@/lib/markdown-image";
import {
  transformImageEmbeds,
  transformWikilinks,
} from "@/lib/reference/wikilink-transform";
import { markdownComponents } from "./markdown-components";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};
const CitationContext = createContext<{
  references: Map<string, string>;
  onCitationClick: (key: string) => void;
  linkDestinations?: Record<string, string>;
} | null>(null);

function CitationLink({ href, children }: ComponentProps<"a">) {
  const context = useContext(CitationContext);
  const key = href?.startsWith("#chat-citation-")
    ? href.slice("#chat-citation-".length)
    : "";
  if (!context?.references.has(key))
    return (
      <a href={href ? (context?.linkDestinations?.[href] ?? href) : undefined}>
        {children}
      </a>
    );
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="chat-citation"
      data-citation-trigger={key}
      aria-label={`출처 ${key}: ${context.references.get(key)}`}
      onClick={() => context.onCitationClick(key)}
    >
      {children}
    </Button>
  );
}
// 렌더러의 타입을 고정해 패널을 열고 닫아도 인용 버튼과 포커스를 유지한다.
const components = { ...markdownComponents, a: CitationLink };
// 인용은 본문 텍스트에서만 연결한다. 링크·코드의 내용과 검증되지 않은 ID는 보존한다.
export function ChatMarkdown({
  children,
  citations,
  onCitationClick,
  linkDestinations,
}: {
  children: string;
  citations: { key: string; title: string }[];
  onCitationClick: (key: string) => void;
  linkDestinations?: Record<string, string>;
}) {
  const references = new Map(citations.map((c) => [c.key, c.title]));
  const citationLinks = () => (tree: MarkdownNode) => {
    const walk = (node: MarkdownNode) => {
      if (
        !node.children ||
        [
          "link",
          "linkReference",
          "code",
          "inlineCode",
          "html",
          "image",
        ].includes(node.type)
      )
        return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value) {
          walk(child);
          return [child];
        }
        const value = child.value;
        const parts: MarkdownNode[] = [];
        let offset = 0;
        for (const match of value.matchAll(/\[([EW]?\d+)\]/g)) {
          if (!references.has(match[1])) continue;
          if (match.index > offset)
            parts.push({
              type: "text",
              value: value.slice(offset, match.index),
            });
          parts.push({
            type: "link",
            url: `#chat-citation-${match[1]}`,
            children: [{ type: "text", value: match[0] }],
          });
          offset = match.index + match[0].length;
        }
        if (offset < value.length)
          parts.push({ type: "text", value: value.slice(offset) });
        return parts;
      });
    };
    walk(tree);
  };
  return (
    <CitationContext value={{ references, onCitationClick, linkDestinations }}>
      <div className="wiki-markdown">
        <ReactMarkdown
          skipHtml
          urlTransform={(url, key) =>
            key === "src"
              ? safeMarkdownImageSrc(linkDestinations?.[url] ?? url)
              : defaultUrlTransform(url)
          }
          remarkPlugins={[remarkGfm, remarkMath, citationLinks]}
          rehypePlugins={[
            [rehypeKatex, { throwOnError: false, strict: false, trust: false }],
          ]}
          components={components}
        >
          {transformWikilinks(transformImageEmbeds(children))}
        </ReactMarkdown>
      </div>
    </CitationContext>
  );
}
