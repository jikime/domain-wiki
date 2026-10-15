import { WorkbookPrintButton } from "@/components/workbook-controls";
import { WorkbookMarkdown } from "@/components/workbook-markdown";
import { workbookPages } from "@/lib/workbook";
import { readWorkbookFile } from "@/server/workbook";

export const dynamic = "force-dynamic";
export const metadata = { title: "교육생 워크북 인쇄" };
export default async function PrintWorkbook() {
  const pages = workbookPages;
  const documents = await Promise.all(
    pages.map(async (page) => ({
      ...page,
      content: (await readWorkbookFile(page.file))?.toString("utf8") ?? "",
    })),
  );
  return (
    <main id="workbook-main" className="wb-print-book">
      <section className="wb-print-cover">
        <p className="wb-kicker">엠큐닉 · 교육생 워크북</p>
        <h1>
          우리 회사의
          <br />
          도메인 위키 만들기
        </h1>
        <p>회사 자료로 배우는 위키 실습 · 김동학 / Anthony Kim</p>
        <div className="wb-print-instructions">
          <p>
            교육생용 교재를 한곳에 모았습니다. 인쇄 창에서 ‘PDF로 저장’을 선택해
            내려받으세요.
          </p>
          <WorkbookPrintButton />
        </div>
        <ol>
          {pages.map((page) => (
            <li key={page.slug}>
              <a href={`#${page.slug}`}>{page.title}</a>
            </li>
          ))}
        </ol>
      </section>
      {documents.map((page) => (
        <section className="wb-print-chapter" id={page.slug} key={page.slug}>
          <WorkbookMarkdown
            content={page.content}
            file={page.file}
            print
            prefix={`${page.slug}--`}
          />
        </section>
      ))}
    </main>
  );
}
