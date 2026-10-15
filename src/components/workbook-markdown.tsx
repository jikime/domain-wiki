import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { workbookMarkdownPlugin } from "@/server/workbook";
import { WorkbookCode } from "./workbook-controls";

function textOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number")
        return String(child);
      return isValidElement<{ children?: ReactNode }>(child)
        ? textOf(child.props.children)
        : "";
    })
    .join("");
}

export function WorkbookMarkdown({
  content,
  file,
  print = false,
  prefix = "",
}: {
  content: string;
  file: string;
  print?: boolean;
  prefix?: string;
}) {
  return (
    <div className="wb-prose">
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          [workbookMarkdownPlugin, { file, print, prefix }],
        ]}
        components={{
          table: ({ children }) => (
            <section
              className="wb-table"
              aria-label="가로로 넘겨 볼 수 있는 표"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: 가로로 넘치는 표를 키보드로 스크롤합니다.
              tabIndex={0}
            >
              <table>{children}</table>
            </section>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              {...(href?.startsWith("https:")
                ? { target: "_blank", rel: "noreferrer" }
                : {})}
            >
              {children}
            </a>
          ),
          pre: ({ children }) => {
            const code = Children.toArray(children).find((child) =>
              isValidElement(child),
            );
            const language = isValidElement<{ className?: string }>(code)
              ? code.props.className?.replace("language-", "")
              : undefined;
            return (
              <WorkbookCode
                language={language}
                text={textOf(children).replace(/\n$/, "")}
              />
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
