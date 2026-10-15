import type { Metadata } from "next";
import Link from "next/link";
import { WorkbookMobileMenu } from "@/components/workbook-controls";
import "@/styles/workbook.css";

export const metadata: Metadata = {
  title: { default: "도메인 위키 워크북", template: "%s | 도메인 위키 워크북" },
  description: "엠큐닉 · 회사 자료로 위키를 만들고 채팅에 활용하는 실습 워크북",
};

export default function WorkbookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="wb-site">
      <a className="wb-skip" href="#workbook-main">
        본문으로 건너뛰기
      </a>
      <header className="wb-header">
        <Link className="wb-brand" href="/workbook">
          도메인 위키 <span>워크북</span>
        </Link>
        <nav aria-label="워크북 주요 메뉴">
          <Link href="/workbook/start-here">시작하기</Link>
          <Link href="/workbook/wiki-chat">실제 사용법</Link>
          <Link href="/workbook/print" prefetch={false}>
            인쇄 · PDF
          </Link>
          <Link href="/">위키 서비스 ↗</Link>
        </nav>
        <WorkbookMobileMenu />
      </header>
      {children}
      <footer className="wb-footer">
        <p>엠큐닉 · 도메인 위키 실습 워크북</p>
        <p>김동학 / Anthony Kim · 회사 자료로 배우는 위키 실습</p>
      </footer>
    </div>
  );
}
