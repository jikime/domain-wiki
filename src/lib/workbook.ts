export type WorkbookPage = { slug: string; title: string; file: string };
export type WorkbookGroup = {
  label: string;
  description: string;
  items: WorkbookPage[];
};

export const workbookGroups: WorkbookGroup[] = [
  {
    label: "시작하기",
    description: "어느 창에 입력할지, 무엇부터 실행할지 살펴봅니다.",
    items: [
      {
        slug: "start-here",
        title: "처음 배우는 분을 위한 길잡이",
        file: "start-here.md",
      },
      { slug: "overview", title: "교육 과정과 전체 안내", file: "README.md" },
      {
        slug: "environment",
        title: "내 PC 환경 준비",
        file: "environment-setup.md",
      },
      {
        slug: "getting-started",
        title: "위키 받기와 첫 실행",
        file: "getting-started.md",
      },
    ],
  },
  {
    label: "실제 사용하기",
    description: "자료를 위키로 정리해 채팅에서 찾아봅니다.",
    items: [
      {
        slug: "wiki-chat",
        title: "위키 작성부터 채팅까지",
        file: "wiki-chat-guide.md",
      },
      {
        slug: "daily-use",
        title: "다시 실행하고 이어서 사용하기",
        file: "daily-use.md",
      },
      {
        slug: "prompts",
        title: "AI에게 요청하는 연습",
        file: "prompt-practice.md",
      },
    ],
  },
  {
    label: "단계별 실습",
    description: "같은 프로젝트를 이어 가며 우리 회사의 위키를 만듭니다.",
    items: [
      {
        slug: "week-01",
        title: "01 · 설치와 첫 업무 체험",
        file: "weeks/01-experience.md",
      },
      {
        slug: "week-02",
        title: "02 · 구조 이해와 첫 변경",
        file: "weeks/02-architecture.md",
      },
      {
        slug: "week-03",
        title: "03 · 회사 지식과 작성 기준",
        file: "weeks/03-domain.md",
      },
      {
        slug: "week-04",
        title: "04 · 위키와 답변 확인",
        file: "weeks/04-evaluation.md",
      },
      {
        slug: "week-05",
        title: "05 · AI와 기능 개선",
        file: "weeks/05-development.md",
      },
      {
        slug: "week-06",
        title: "06 · 오류 수정과 지식 갱신",
        file: "weeks/06-debugging.md",
      },
      {
        slug: "week-07",
        title: "07 · 팀 업무 적용과 인계",
        file: "weeks/07-application.md",
      },
    ],
  },
  {
    label: "실습 자료",
    description: "가상 프로젝트 A와 B의 원문을 내려받아 실습합니다.",
    items: [
      {
        slug: "samples",
        title: "실습 자료 사용 안내",
        file: "samples/README.md",
      },
      {
        slug: "sample-project-a",
        title: "프로젝트 A · 사업 개요",
        file: "samples/01-project-a.md",
      },
      {
        slug: "sample-review",
        title: "공통 · 검토 지침",
        file: "samples/02-review-guide.md",
      },
      {
        slug: "sample-acceptance",
        title: "프로젝트 A · 검수 조건 v1",
        file: "samples/03-acceptance-v1.md",
      },
      {
        slug: "sample-meeting",
        title: "프로젝트 A · 협의 메모",
        file: "samples/04-meeting.md",
      },
      {
        slug: "sample-project-b",
        title: "프로젝트 B · 사업 자료",
        file: "samples/05-project-b.md",
      },
      {
        slug: "sample-experience",
        title: "실무 경험 기록",
        file: "samples/06-experience.md",
      },
      {
        slug: "domain-settings",
        title: "도메인 설정 예시",
        file: "samples/domain-settings.md",
      },
      {
        slug: "acceptance-v2",
        title: "6단계 · 검수 조건 v2",
        file: "instructor/materials/acceptance-v2.md",
      },
      {
        slug: "new-rfp",
        title: "7단계 · 신규 요청 문서",
        file: "instructor/materials/new-rfp.md",
      },
    ],
  },
  {
    label: "필요할 때 찾아보기",
    description: "실습을 기록하거나 낯선 말과 오류를 만났을 때 찾아보세요.",
    items: [
      { slug: "templates", title: "실습 기록 양식", file: "templates.md" },
      { slug: "glossary", title: "쉬운 용어집", file: "glossary.md" },
      {
        slug: "troubleshooting",
        title: "막혔을 때 확인하기",
        file: "troubleshooting.md",
      },
      {
        slug: "project-guide",
        title: "프로젝트와 기술 안내",
        file: "project-guide.md",
      },
      { slug: "assessment", title: "결과 확인과 인계", file: "assessment.md" },
    ],
  },
];

export const workbookPages = workbookGroups.flatMap((group) => group.items);
export const workbookDownloads = [
  ...workbookPages.map((page) => page.file),
  "samples/evaluation-questions.csv",
  "exercises/check-aliases.mjs",
];
export const workbookHref = (slug: string) => `/workbook/${slug}`;
export const workbookDownloadHref = (file: string) =>
  `/workbook/files/${file.split("/").map(encodeURIComponent).join("/")}`;
