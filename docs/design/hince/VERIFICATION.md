# hince UI 교체 검증

검증일: 2026-09-09. 개발 주소: `http://localhost:3010`. 기능 통합시험은 별도 `domain_wiki_test` DB와 3101번 포트를 사용한다.

최신 변경은 [채팅 사용 흐름 개선](chat-ux/README.md)이다. 중앙 시작 입력창·하단 입력 유지·범위 자동 저장·출처 선택 패널을 적용하고 전체 통합시험 **75개**를 통과했다.

## 화면 점검

최초 hince 교체 시 개발 예시 데이터에서 역할별 29개 화면 조합을 1440×1000, 960×1000, 390×844 크기로 확인했다. 87개 조합 모두 HTTP 200, 문서 전체 가로 넘침 0, 브라우저 JavaScript 오류 0이었다. 로그인 화면도 데스크톱·모바일에서 확인했다. [최초 측정 결과](visual-check.json). 채팅 후속 개선의 최신 화면은 아래 별도 기록에 있다.

화면 조합: 홈, 자료실(이용/작성), 위키 목록·상세·신규/개정 편집, 원문 상세, 채팅, 실무 기록(이용/작성)·개정, 프로젝트 목록·상세, 업무 도구(이용/작성), RFP 목록·상세·신규/개정 편집, 공식 자료 목록, 변경 묶음 목록·작성, 공개 검토, 담당·오류 처리, 신고, 관리자 설정, 운영 현황, 수집 허용 사이트.

## 기능 검사

- 프로덕션 빌드 및 TypeScript 검사: 통과.
- 전체 기능 통합시험: **75개 통과, 약 1.9분**. 최초 UI 교체의 72개에 채팅 자동 저장·입력·검색, 범위 저장·실패 복구, 스트리밍 스크롤·중지 시험 3개를 추가했다.
- 새 상호작용 검사: 모바일 메뉴의 역할 제한·Escape·포커스 복귀·메뉴 이동 후 닫힘, 자료 등록 Dialog 안 Select의 Escape와 포커스 복귀.
- 기존 자료 등록→원문 공개→위키 작성·게시→직원 열람과 채팅·출처·생성·검토·권한 검증을 재실행해 통과했다.
- 기존 채팅 브라우저 시험을 인용 번호·참고 자료 버튼으로 여는 패널에 맞춰 갱신했다. 데스크톱과 모바일에서 정확한 원문 버전·문단 링크, Escape와 버튼 포커스 복귀를 확인했다.
- 작성자 원문 작업·위키 작업, 등록 창, 홈·채팅을 15개 추가 화면 조합으로 확인했다. 데스크톱·태블릿의 질문 입력 영역은 1000px 높이 첫 화면 안에 표시됐다. [추가 측정](interaction-check.json).
- 최신 채팅 화면은 1440×1000, 960×1000, 390×844, 390×500에서 가로·세로 문서 넘침 없이 첫 화면 안에 입력창이 표시된다. 모바일 대화 검색·Escape·포커스 복귀와 특정 자료의 제목·범위 해제를 확인했다. [최신 측정](chat-ux/visual-check.json).
- 한글 조합 중 Enter 및 키 코드 229로 전송되지 않으며, Shift+Enter 줄바꿈 후 Enter로 대화·질문이 한 번씩 저장되는 것을 확인했다. 범위 저장 실패 시 이전 도메인·프로젝트로 복구되고, 다음 질문의 실제 서버 범위가 선택값과 일치했다.
- 스트리밍 중 과거 위치에서 새 토큰이 도착해도 스크롤 위치를 유지한다. 최신 답변 이동과 중지 후 다시 질문, 390×500에서 진행 중 대화의 입력창 위치를 확인했다.
- 출처 버튼 렌더러가 교체되어 포커스 복귀가 실패하던 문제를 발견해 렌더러 타입을 고정했고, 데스크톱·모바일 재검증이 통과했다.
- 최종 프로덕션 빌드·TypeScript·Biome 186개 파일·`git diff --check`가 통과했다. 검증 명령은 `npm run build`, `node scripts/test-integration.mjs`, `npm run typecheck`, `npm run lint`다.

## 대표 화면

| 화면 | 데스크톱 | 모바일 |
| --- | --- | --- |
| 업무 홈 | [1440px](screenshots/reader-home-1440.png) | [390px](screenshots/reader-home-390.png) |
| 자료실 | [1440px](screenshots/writer-sources-1440.png) | [390px](screenshots/writer-sources-390.png) |
| 자료 등록 | [1440px](screenshots/upload-1440.png) | [390px](screenshots/upload-390.png) |
| 원문·작업 패널 | [1440px](screenshots/writer-source-actions-1440.png) | [390px](screenshots/writer-source-actions-390.png) |
| 위키 상세 | [1440px](screenshots/writer-wiki-actions-1440.png) | [390px](screenshots/writer-wiki-actions-390.png) |
| 새 대화 | [1440px](chat-ux/screenshots/empty-1440x1000.png) | [390px](chat-ux/screenshots/empty-390x844.png) |
| 채팅·근거 | [실제 시험 답변](chat-ux/screenshots/conversation-1440.png) · [원문 패널](chat-ux/screenshots/references-1440.png) | [390px](chat-ux/screenshots/conversation-390.png) · [원문 패널](chat-ux/screenshots/references-390.png) |
| 검토함 | [1440px](screenshots/reviewer-reviews-1440.png) | [390px](screenshots/reviewer-reviews-390.png) |
| 전체 메뉴 | — | [390px](screenshots/menu-390.png) |

## 해석 범위

기능 시험의 AI와 기관 응답은 기존 격리 시험용 모형이다. 실제 회사 모델·고객 자료를 대상으로 한 품질 검증을 뜻하지 않는다. 참조 원본에서 미관측인 태블릿, 채팅, 오류·포커스 상태는 [업무용 확장 규칙](DESIGN.md)에 따른다.
