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
    label: "회사 위키 만들기",
    description: "회사 목표와 개발 작업을 이어 가고 필요한 조작을 찾아봅니다.",
    items: [
      {
        slug: "company-project",
        title: "회사 개발 노트",
        file: "company-project.md",
      },
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
    label: "함께 개발하는 순서",
    description: "강의와 같은 순서로 개발하고, 이전 결과를 이어서 고칩니다.",
    items: [
      {
        slug: "week-01",
        title: "실행하고 개발할 곳 찾기",
        file: "weeks/01-experience.md",
      },
      {
        slug: "week-02",
        title: "우리 업무에 필요한 자료를 모아 쓰는 위키 만들기",
        file: "weeks/02-architecture.md",
      },
      {
        slug: "week-03",
        title: "회사 지식과 작성 방식 적용하기",
        file: "weeks/03-domain.md",
      },
      {
        slug: "week-04",
        title: "회사 업무에 맞게 검색 고도화하기",
        file: "weeks/04-evaluation.md",
      },
      {
        slug: "week-05",
        title: "기능을 끝까지 연결하기",
        file: "weeks/05-development.md",
      },
      {
        slug: "week-06",
        title: "실제 사용에 맞게 안정화하기",
        file: "weeks/06-debugging.md",
      },
      {
        slug: "week-07",
        title: "회사가 이어서 운영하기",
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
        title: "개정 예제 · 검수 조건 v2",
        file: "instructor/materials/acceptance-v2.md",
      },
      {
        slug: "new-rfp",
        title: "업무 적용 예제 · 신규 요청 문서",
        file: "instructor/materials/new-rfp.md",
      },
    ],
  },
  {
    label: "필요할 때 찾아보기",
    description: "실습을 기록하거나 낯선 말과 오류를 만났을 때 찾아보세요.",
    items: [
      {
        slug: "design-harness",
        title: "화면 변경에 디자인 하네스 활용",
        file: "design-harness.md",
      },
      {
        slug: "development-recipes",
        title: "기능 개발 예제",
        file: "development-recipes.md",
      },
      { slug: "operations", title: "회사 적용과 운영", file: "operations.md" },
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
