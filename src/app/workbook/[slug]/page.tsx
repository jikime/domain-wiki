import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  WorkbookNavigation,
  WorkbookPrintButton,
} from "@/components/workbook-controls";
import { WorkbookMarkdown } from "@/components/workbook-markdown";
import {
  workbookDownloadHref,
  workbookGroups,
  workbookHref,
  workbookPages,
} from "@/lib/workbook";
import { prepareWorkbook, readWorkbookFile } from "@/server/workbook";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return {
    title:
      workbookPages.find((page) => page.slug === slug)?.title ??
      "문서를 찾을 수 없습니다",
  };
}

export default async function WorkbookDocument({ params }: Props) {
  const { slug } = await params;
  const index = workbookPages.findIndex((page) => page.slug === slug);
  const page = workbookPages[index];
  if (!page) notFound();
  const file = await readWorkbookFile(page.file);
  if (!file) notFound();
  const content = file.toString("utf8");
  const headings = prepareWorkbook(content).filter(
    (heading) => heading.level === 2 || heading.level === 3,
  );
  const group = workbookGroups.find((item) => item.items.includes(page));
  const prev = workbookPages[index - 1],
    next = workbookPages[index + 1];
  return (
    <div className="wb-document-layout">
      <aside className="wb-sidebar">
        <WorkbookNavigation />
      </aside>
      <main id="workbook-main" className="wb-document">
        <div className="wb-document-meta">
          <Link href="/workbook">워크북</Link>
          <span>/ {group?.label}</span>
          <span>
            {index + 1} / {workbookPages.length}
          </span>
        </div>
        <div className="wb-document-actions">
          <a href={workbookDownloadHref(page.file)} download>
            원고 내려받기 ↓
          </a>
          <WorkbookPrintButton />
        </div>
        <WorkbookMarkdown content={content} file={page.file} />
        <nav className="wb-page-turn" aria-label="이전 다음 문서">
          {prev ? (
            <Link href={workbookHref(prev.slug)}>
              <span>← 이전 문서</span>
              {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={workbookHref(next.slug)}>
              <span>다음 문서 →</span>
              {next.title}
            </Link>
          )}
        </nav>
      </main>
      <aside className="wb-toc">
        <nav aria-label="이 문서의 목차">
          <p className="wb-kicker">이 문서에서</p>
          <ul>
            {headings.map((heading) => (
              <li key={heading.id} data-level={heading.level}>
                <a href={`#${heading.id}`}>{heading.text}</a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </div>
  );
}
