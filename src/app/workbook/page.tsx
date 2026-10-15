import { ArrowRight, BookOpen, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { workbookGroups, workbookHref } from "@/lib/workbook";

export default function WorkbookHome() {
  return (
    <main id="workbook-main">
      <section className="wb-hero">
        <div>
          <p className="wb-kicker">
            엠큐닉 · AI와 함께 만드는 우리 회사의 지식
          </p>
          <h1>
            회사에 쌓인 자료를
            <br />
            <em>함께 쓰는 지식으로.</em>
          </h1>
          <p className="wb-lead">
            업무 자료를 위키로 정리하고 채팅으로 질문해 보세요.
            <br className="wb-desktop-break" /> 우리 회사 업무에 맞게 위키를
            만들고 고쳐 보는 실습 교재입니다.
          </p>
          <div className="wb-hero-actions">
            <Button asChild size="lg">
              <Link href="/workbook/start-here">
                워크북 시작하기 <ArrowRight size={18} />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/workbook/wiki-chat">실제 사용법 먼저 보기</Link>
            </Button>
          </div>
          <div className="wb-facts">
            <span>설치부터 업무 적용까지</span>
            <span>직접 따라 하는 실습</span>
            <span>같은 프로젝트로 끝까지</span>
          </div>
        </div>
        <aside className="wb-hero-note" aria-label="이번 교육에서 할 일">
          <BookOpen size={26} />
          <p className="wb-kicker">이 워크북에서</p>
          <h2>
            직접 만들어 보고
            <br />
            근거로 확인합니다.
          </h2>
          <ol>
            <li>
              <span>01</span> 회사 자료 등록하기
            </li>
            <li>
              <span>02</span> 위키로 정리하고 게시하기
            </li>
            <li>
              <span>03</span> 채팅에서 질문하고 확인하기
            </li>
            <li>
              <span>04</span> AI와 함께 기능 다듬기
            </li>
          </ol>
        </aside>
      </section>
      <section className="wb-quick">
        <div>
          <MessagesSquare size={22} />
          <h2>“직접 쓴 위키도 채팅에서 쓸 수 있나요?”</h2>
          <p>
            글을 쓰고 근거를 연결한 뒤 검토를 거쳐 게시합니다. 질문하고 답변을
            저장하는 과정까지 화면 순서대로 따라 해 보세요.
          </p>
        </div>
        <Link href="/workbook/wiki-chat">
          위키 작성부터 채팅까지 <ArrowRight size={18} />
        </Link>
      </section>
      <section className="wb-contents" aria-labelledby="contents-title">
        <p className="wb-kicker">한눈에 보는 학습 순서</p>
        <h2 id="contents-title">필요한 곳에서 시작하세요.</h2>
        <div className="wb-group-grid">
          {workbookGroups.map((group, index) => (
            <section key={group.label} className="wb-group-card">
              <p className="wb-kicker">
                {String(index + 1).padStart(2, "0")} / {group.items.length}개
                문서
              </p>
              <h3>{group.label}</h3>
              <p>{group.description}</p>
              <ul>
                {group.items.map((page) => (
                  <li key={page.slug}>
                    <Link href={workbookHref(page.slug)} prefetch={false}>
                      {page.title}
                      <ArrowRight size={14} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
      <section className="wb-closing">
        <p className="wb-kicker">처음부터 모두 외울 필요는 없어요.</p>
        <h2>
          한 가지 업무를 정하고,
          <br />
          작은 위키 하나부터 시작하세요.
        </h2>
        <p>입력할 곳, 따라 할 순서, 확인할 결과를 각 실습에 담았습니다.</p>
        <Link href="/workbook/week-01">첫 실습 시작하기 →</Link>
      </section>
    </main>
  );
}
