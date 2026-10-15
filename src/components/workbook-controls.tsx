"use client";
import { Check, Copy, Menu, Printer } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { workbookGroups, workbookHref } from "@/lib/workbook";

export function WorkbookNavigation({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="워크북 전체 목차" className="wb-navigation">
      {workbookGroups.map((group, index) => (
        <section key={group.label}>
          <p className="wb-kicker">
            {String(index + 1).padStart(2, "0")} / {group.label}
          </p>
          <ul>
            {group.items.map((item) => (
              <li key={item.slug}>
                <Link
                  href={workbookHref(item.slug)}
                  prefetch={false}
                  onClick={onNavigate}
                  aria-current={
                    pathname === workbookHref(item.slug) ? "page" : undefined
                  }
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

export function WorkbookMobileMenu() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className="wb-menu-button"
          aria-label="워크북 목차 열기"
        >
          <Menu size={18} />
          목차
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="wb-mobile-panel">
        <SheetTitle>워크북 목차</SheetTitle>
        <SheetDescription>읽을 문서를 선택해 주세요.</SheetDescription>
        <nav className="wb-mobile-shortcuts" aria-label="워크북 바로가기">
          <Link href="/workbook" onClick={() => setOpen(false)}>
            워크북 소개
          </Link>
          <Link
            href="/workbook/print"
            prefetch={false}
            onClick={() => setOpen(false)}
          >
            전체 교재 인쇄 · PDF
          </Link>
          <Link href="/" onClick={() => setOpen(false)}>
            위키 서비스 열기 ↗
          </Link>
        </nav>
        <WorkbookNavigation onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

export function WorkbookCode({
  text,
  language,
}: {
  text: string;
  language?: string;
}) {
  const [status, setStatus] = useState("");
  return (
    <figure className="wb-code">
      <figcaption>
        <span>
          {language === "text" ? "입력 예시" : language || "코드 · 명령"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setStatus("복사했습니다");
            } catch {
              setStatus("텍스트를 선택해 복사해 주세요");
            }
          }}
        >
          {status === "복사했습니다" ? <Check size={15} /> : <Copy size={15} />}
          복사
        </Button>
        <output className="wb-copy-status">{status}</output>
      </figcaption>
      <pre>
        <code>{text}</code>
      </pre>
    </figure>
  );
}

export function WorkbookPrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      <Printer size={16} />
      인쇄 · PDF로 저장
    </Button>
  );
}
