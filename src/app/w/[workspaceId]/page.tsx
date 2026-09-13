import { ArrowRight, BookOpen, FolderOpen, MessagesSquare } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageContext } from "@/server/page-access";
import { domainDiscovery } from "@/server/services/discovery";
import { workspaceData } from "@/server/services/workspace";
export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ domain?: string }>;
}) {
  const { workspaceId } = await params;
  const context = await pageContext(workspaceId);
  const { domains, projects } = await workspaceData(
    await headers(),
    workspaceId,
  );
  const selectedId = (await searchParams).domain;
  const selected = selectedId
    ? domains.find((item) => item.id === selectedId)
    : domains[0];
  if (selectedId && !selected) notFound();
  const base = `/w/${workspaceId}`;
  const guide = selected
    ? await domainDiscovery(await headers(), workspaceId, selected.id)
    : null;
  const domainProjects = projects.filter(
    (item) => item.domainId === selected?.id,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">업무를 시작하는 곳</span>
          <h1>오늘은 어떤 업무를 알아볼까요?</h1>
          <p>
            도메인의 목적과 용어를 살펴보고, 우리 팀의 지식을 준비해 보세요.
          </p>
        </div>
      </div>
      <nav className="domain-tabs" aria-label="업무 도메인">
        {domains.map((item) => (
          <Link
            key={item.id}
            href={`${base}?domain=${item.id}`}
            aria-current={selected?.id === item.id ? "page" : undefined}
          >
            {item.name}
          </Link>
        ))}
        {context.isAdmin && <Link href={`${base}/admin`}>+ 도메인 관리</Link>}
      </nav>
      {selected ? (
        <>
          <section className="domain-hero">
            <div>
              <span className="eyebrow">선택한 도메인</span>
              <h2>{selected.name}</h2>
              <p>{selected.purpose}</p>
            </div>
            <Link
              className="hero-link"
              href={`${base}/chat?domain=${selected.id}`}
            >
              채팅 공간 살펴보기 <ArrowRight size={17} />
            </Link>
          </section>
          <div className="quick-grid">
            {[
              {
                title: "업무에 질문하기",
                text: "공개 자료에서 근거를 찾아 대화합니다",
                path: "chat",
                icon: MessagesSquare,
                stage: "질문·근거 확인",
              },
              {
                title: "위키 둘러보기",
                text: "동료가 검토한 개념과 절차를 읽습니다",
                path: "wiki",
                icon: BookOpen,
                stage: "검토된 지식",
              },
              {
                title: "자료 모아보기",
                text: "등록한 원본과 처리 상태를 확인합니다",
                path: "sources",
                icon: FolderOpen,
                stage: "원본과 버전",
              },
            ].map((item) => (
              <Link
                className="quick-card"
                href={`${base}/${item.path}?domainId=${selected.id}${item.path === "chat" ? "" : "&q="}`}
                key={item.path}
              >
                <item.icon size={22} />
                <span className="small-tag">{item.stage}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <span className="quick-arrow">
                  {"열어보기"} <ArrowRight size={14} />
                </span>
              </Link>
            ))}
          </div>
          <div className="content-grid">
            <section className="panel">
              <div className="section-heading">
                <h2>업무를 익히는 순서</h2>
                <span>관리자 안내</span>
              </div>
              {guide?.steps.length ? (
                <ol className="learning-steps">
                  {guide.steps.map((step, i) => (
                    <li key={`${i}-${step.title}`}>
                      <h3>{step.title}</h3>
                      <p>{step.description}</p>
                      {step.wiki && (
                        <Link href={`${base}/wiki/${step.wiki.id}`}>
                          절차 읽기 · {step.wiki.title} →
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="empty-copy">
                  등록된 입문 순서가 없습니다. 핵심 용어와 게시 위키부터
                  살펴보세요.
                </p>
              )}
            </section>
            <section className="panel">
              <div className="section-heading">
                <h2>추천 읽기</h2>
                <span>현재 게시본</span>
              </div>
              {guide?.reading.length ? (
                <ul className="reading-list">
                  {guide.reading.map((p) => (
                    <li key={p.id}>
                      <Link href={`${base}/wiki/${p.id}`}>{p.title} →</Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-copy">추천 자료가 아직 없습니다.</p>
              )}
            </section>
          </div>
          <div className="content-grid">
            <section className="panel">
              <div className="section-heading">
                <h2>먼저 알아둘 용어</h2>
                <span>{selected.terms.length}개</span>
              </div>
              {selected.terms.length ? (
                <dl className="terms-list">
                  {selected.terms.map((item, index) => (
                    <div key={`${item.term}-${index}`}>
                      <dt>
                        <Link
                          href={`${base}/wiki?domainId=${selected.id}&q=${encodeURIComponent(item.term)}`}
                        >
                          {item.term} ↗
                        </Link>
                      </dt>
                      <dd>
                        {item.definition}
                        {!!item.aliases?.length && (
                          <small className="passage-label term-aliases">
                            동의어·약어: {item.aliases.join(", ")}
                          </small>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="empty-copy">아직 등록된 용어가 없습니다.</p>
              )}
            </section>
            <section className="panel">
              <div className="section-heading">
                <h2>연결된 프로젝트</h2>
                <Link href={`${base}/projects?domainId=${selected.id}`}>
                  {domainProjects.length}개 · 발주처로 찾기 →
                </Link>
              </div>
              {domainProjects.length ? (
                domainProjects.map((item) => (
                  <article className="project-card" key={item.id}>
                    <span className="eyebrow">{item.clientName}</span>
                    <h3>
                      <Link href={`${base}/projects/${item.id}`}>
                        {item.name} →
                      </Link>
                    </h3>
                    <p>{item.description}</p>
                  </article>
                ))
              ) : (
                <p className="empty-copy">
                  프로젝트를 등록하면 이곳에서 함께 볼 수 있습니다.
                </p>
              )}
            </section>
          </div>
        </>
      ) : (
        <section className="panel">
          <h2>첫 업무 도메인을 준비해 주세요</h2>
          <p>관리 화면에서 목적과 용어를 입력하면 이곳에 표시됩니다.</p>
        </section>
      )}
      <div className="foundation-note">
        <span className="status-dot" />
        <p>
          <strong>원본을 확인하고 위키로 함께 정리해 보세요.</strong> 자료
          등록·공개 검토·위키 작성과 게시·기본 검색을 사용할 수 있습니다. AI
          채팅에서 공개 근거를 찾고 본인의 대화를 이어갈 수 있습니다.
        </p>
      </div>
    </>
  );
}
