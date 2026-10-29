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
            엠큐닉 · AI와 함께 개발하는 우리 회사 위키
          </p>
          <h1>
            우리 회사 위키를
            <br />
            <em>함께 개발합니다.</em>
          </h1>
          <p className="wb-lead">
            스타터킷에 회사의 요구를 하나씩 반영합니다.
            <br className="wb-desktop-break" /> 강사의 코칭을 받으며 개발하고,
            만든 위키를 회사에서 계속 사용하는 과정입니다.
          </p>
          <div className="wb-hero-actions">
            <Button asChild size="lg">
              <Link href="/workbook/start-here">
                워크북 시작하기 <ArrowRight size={18} />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/workbook/week-02">첫 화면 변경 살펴보기</Link>
            </Button>
          </div>
          <div className="wb-hero-actions">
            <Button asChild size="lg" variant="outline">
              <a href="/lectures/index.html">강의 프레젠테이션 열기</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/workbook/company-project">회사 개발 노트</Link>
            </Button>
          </div>
          <div className="wb-facts">
            <span>개발부터 회사 운영까지</span>
            <span>강사 코칭과 직접 개발</span>
            <span>같은 프로젝트로 끝까지</span>
          </div>
        </div>
        <aside className="wb-hero-note" aria-label="이번 교육에서 할 일">
          <BookOpen size={26} />
          <p className="wb-kicker">이 워크북에서</p>
          <h2>
            직접 개발하고
            <br />
            같은 위키를 키웁니다.
          </h2>
          <ol>
            <li>
              <span>01</span> 회사 요구와 작업 범위 정하기
            </li>
            <li>
              <span>02</span> AI와 화면·기능 개발하기
            </li>
            <li>
              <span>03</span> 실제 업무로 확인하고 개선하기
            </li>
            <li>
              <span>04</span> 회사에 적용하고 운영 이어가기
            </li>
          </ol>
        </aside>
      </section>
      <section className="wb-quick">
        <div>
          <MessagesSquare size={22} />
          <h2>어디부터 바꿔야 할지 막히나요?</h2>
          <p>
            현재 화면과 원하는 결과를 나란히 놓아 보세요. 강사와 범위를 정하고
            AI에게 계획을 요청한 뒤 직접 구현·확인합니다.
          </p>
        </div>
        <Link href="/workbook/prompts">
          AI와 개발하는 요청 순서 <ArrowRight size={18} />
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
          실행되는 위키를 함께 고쳐 보세요.
        </h2>
        <p>입력할 곳, 따라 할 순서, 확인할 결과를 각 실습에 담았습니다.</p>
        <Link href="/workbook/week-01">첫 실습 시작하기 →</Link>
      </section>
    </main>
  );
}
