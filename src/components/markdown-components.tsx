"use client";
import { Children, isValidElement } from "react";
import type { Components } from "react-markdown";
import { MarkdownImage, MermaidDiagram } from "./markdown-media";

// Shared by wiki, source previews and chat so the same document renders alike.
export const markdownComponents: Components = {
  img: ({ src, alt }) => (
    <MarkdownImage
      key={typeof src === "string" ? src : ""}
      src={typeof src === "string" ? src : undefined}
      alt={alt}
    />
  ),
  code: ({ children, className, node: _node, ...props }) =>
    className === "language-mermaid" ? (
      <MermaidDiagram code={String(children).replace(/\n$/, "")} />
    ) : (
      <code className={className} {...props}>
        {children}
      </code>
    ),
  pre: ({ children }) => {
    const nodes = Children.toArray(children);
    const child = nodes.length === 1 ? nodes[0] : null;
    // ReactMarkdown's custom code renderer has not run yet at this boundary.
    if (
      isValidElement<{ className?: string }>(child) &&
      child.props.className === "language-mermaid"
    )
      return <>{children}</>;
    return <pre>{children}</pre>;
  },
};
