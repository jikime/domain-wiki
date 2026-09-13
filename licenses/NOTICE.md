# 참조 코드와 변경

2026-09-13 후속 적용: `src/server/ai/cli-protocol.ts`, `cli.ts`와 `src/lib/model-transport.ts`는 원본 `src/lib/llm-client.ts`, `src/lib/has-usable-llm.ts`, Rust Claude·Codex 명령의 API/CLI 선택·표준 입력·JSON 응답 해석을 참조했다. 웹 서버의 용도별 환경 설정, 임시 작업 폴더, 인증 환경 분리, 대기열·취소·프로세스 정리, Codex 이미지 전달과 기존 권한·사용량 경로로 변경했다. 아래 원본 라이선스 고지를 함께 적용한다.

`llm_wiki` 0.6.11, Git `8bcf9b52`의 아래 코드를 회사용 웹 서비스에 맞게 적용했다. 원본 저작권은 Copyright (C) 2024-2026 YongSu이며 GPL-3.0을 따른다. [라이선스 전문](llm-wiki-GPL-3.0.txt)을 함께 보존한다.

- `src/lib/context-budget.ts`: 원본의 문자 예산 배분을 분리 적용했다. 유효하지 않은 수의 처리를 보완했다.
- `src/lib/document-analysis.ts`: 원본 `src/lib/ingest.ts`의 `buildAnalysisPrompt`, `semanticBlocks`, `splitSourceIntoSemanticChunks`를 바탕으로 분석 항목과 절·문단·문맥 겹침을 적용했다. DB 문단 ID·정확한 문자 범위, JSON 직렬화 예산, 표·코드 문맥, 구조화 결과·검증으로 변경했다. 파일·Tauri·전역 UI 저장소에는 의존하지 않는다.

- `src/lib/wiki-generation.ts`: 원본 `src/lib/ingest.ts`의 문서 분석 후 생성 계약을 바탕으로 문서 요약·대상·개념 페이지와 기존 지식 대조를 적용했다. 파일 출력 대신 검증한 DB 계획·원문 주장 ID·안정적인 페이지 ID·의존 순서에 따른 검토 묶음으로 변경했다.

기존 `ingest-parse.ts`와 `ingest-sanitize.ts`의 원본 참조 주석도 유지한다. 이 기록은 별도 의존 패키지의 라이선스를 변경하지 않는다.

- `src/lib/knowledge-graph.ts`: 원본 `src/lib/graph-relevance.ts`의 직접 링크(3)·공통 출처(4)·Adamic–Adar 공통 이웃(1.5)·유형 친화도를 적용했다. DB의 현재 공개 범위를 먼저 확인하고 UUID 링크를 재구성한다. 유형만으로 연결하지 않으며 1~2단계 후보 한도, 신호 내역, 탐색 경로의 버전 재검사, 범위별 캐시를 추가했다.

- `src/lib/quality.ts`: 원본 `lint-structural-core.ts`의 고립·나가는 연결 없음·끊긴 링크 검사와 `lint.ts`의 의미 점검 개념을 DB 게시 버전·원문 현행성·Purpose에 맞게 적용했다. UUID 연결, 범위 제한, 전 구간 분할, 정확한 비교 구절 계약, 별도 작업·검토 이력을 추가했다.

- `src/lib/knowledge-relevance.ts`는 13단계 관계 점수를 검색과 그래프 작업자가 공유하도록 분리했다. `graph-communities.ts`와 `graph-insights.ts`는 원본 `wiki-graph-analysis.ts`, `graph-insights.ts`의 Louvain 군집·연결 밀도·고립·연결 지점·주목할 관계 규칙을 적용했다. 정렬과 고정 탐색으로 재현성을 보완하고, 구조적 단서를 사실 오류나 매개 중심성으로 단정하는 표현을 제거했다.

- `src/components/graph-sigma.tsx`, `graph-workspace.tsx`, `src/lib/graph-palette.ts`, `graph-analysis.ts`: 원본 `src/components/graph/graph-view.tsx`와 `graph-layout-worker.ts`의 Sigma/React Sigma 구성, ForceAtlas2 설정, 색상·노드 크기·이웃 강조·도구 모음·필터·범례·인사이트 배치를 적용했다. 브라우저 전용 로딩, DB 범위 확인, 직원 검토 연결, 공식 shadcn 폼과 모바일 패널로 연결했다. 직접 작성했던 SVG와 원형/격자 배치는 제거했다.


## 원본 기능 복원 (2026-09-10)

- `src/lib/reference/{frontmatter,sources-merge,page-merge}.ts`와 해당 원본 검사: YAML 구문·출처 병합·페이지 교체와 병합·실패 복원 규칙. `page-merge-prompt.ts`는 원본 `ingest.ts`의 병합 프롬프트를 유지한다. 웹에서는 불변 DB 버전과 검토 묶음으로 연결한다.
- `src/lib/reference/{templates,wiki-page-types,wiki-schema,wikilink-transform}.ts`: 원본 시나리오 템플릿, 사용자 유형·스키마 규칙, 위키 링크 구문. 스키마 파일 읽기를 권한이 적용된 도메인 문서로 바꿨다.
- `src/lib/reference/lint-structural-core.ts`와 원본 검사: 원본 구조 점검 알고리즘. DB 게시 범위·제목·별칭을 원본 입력 구조로 변환한다.
- `src/lib/reference/{source-watch-config,source-watch-defaults}.ts/json`와 원본 검사: 원본 확장자·폴더·패턴 제외 규칙. 경로 입력을 선택한 브라우저 파일 또는 작업공간에 연결한 서버 폴더로 제한하고, 파일 해시·변경·삭제 기록을 PostgreSQL에 보존한다.
- `src/lib/reference/vision-caption-prompt.ts`: 원본 이미지 설명 프롬프트와 주변 문맥. 이미지 파일·사용량·설명 캐시는 작업공간별로 보존한다.
- `src/server/parsers/mineru-reference.ts`: 원본 `src/lib/mineru.ts`의 클라우드·로컬 작업 프로토콜, 표·수식·이미지 처리. 가상 작업 파일과 서버 HTTP 전송으로 Tauri 의존성을 교체했다.
- `native/document-extract/src/ebook.rs`: 원본 전자책 추출과 보안 검사 6개. `anydoc` 0.1.6은 원본과 같은 문서 변환 버전이며 별도 CLI를 통해 호출한다.
- `src/lib/chat-agent.ts`, `reference-search.ts` 및 서버 어댑터: 원본 Rust 에이전트 동작 계약·반복 중단·검색 가중치·RRF·한 단계 그래프 결과 배분을 TypeScript/PostgreSQL로 옮겼다.
- `src/components/{markdown-media,markdown-components,markdown}.tsx`: 원본 문서 읽기의 Mermaid·KaTeX·이미지 확대·메타데이터·위키 링크 동작을 React Markdown과 권한이 적용된 이미지 URL에 연결했다.
- `src/lib/reference/aggregate-pages.ts`와 검사: 원본 `ingest.ts`의 최근 색인 200개 유지·결정적 ingest 로그 함수 및 `ingest-parse.test.ts`의 사례를 복사했다. `project-archive.ts`와 서버 ZIP 어댑터는 원본 `src-tauri/src/commands/project_maintenance.rs`의 색인·프로젝트 폴더·숨김 상태 보존·4 GiB/100,000개 제한을 웹 저장소와 접근 권한에 맞게 연결했다.
- `src/lib/reference/selection-edit.ts`와 원본 검사 및 `selection-prompt.ts`: 원본 선택 문장의 정규화·범위 매핑·단어 비교와 `wiki-editor.tsx`의 질문/수정 프롬프트를 보존했다. 웹 어댑터는 회원·근거 재검사, 생성 사용량, 불변 문서 버전과 수동 초안 저장에 연결한다. `markdown.tsx`의 원문 줄 위치 속성도 원본 `WikiReader`의 동작을 옮겼다.

- `src/lib/reference/{lint-fixes,path-utils,wiki-filename,review-utils,sweep-reviews}.ts`와 원본 검사: 연결 교체·Related 삽입·빈 문서 작성, Unicode 파일명, 검토 이름 대조·JSON 추출·AI 재판정 프롬프트를 옮겼다. 파일 작업은 주입식 어댑터로 바꾸고, 웹에서는 현재 버전 확인·원자적 초안 저장·직원의 해결 확인 및 이력에 연결한다.

- `src/lib/reference/{deep-research,research-prompts,review-batch-research}.ts`와 원본 검사: 원본 심층 조사 결과 검증·날짜·파일명·문서 구조, 주제 최적화·합성 프롬프트 및 검토 선택 함수를 옮겼다. `src/lib/research.ts`, `server/research/search.ts`는 원본 수집 순서·한도·URL 중복과 Rust 제공자 7종의 요청·결과 정규화를 웹 작업자에 연결한다. 개인 AnyTXT 파일 검색은 작업공간의 공개 자료 검색으로 대체하고, 저장은 불변 근거·위키 초안·동료 검토에 연결한다.

- Markdown 연결 이미지 탐색 함수와 비교 검사: 원본 `src/lib/extract-source-images.ts` 및 `.test.ts`에서 이식. 웹 폴더의 버전별 사본·권한 연결은 이 프로젝트의 구현이며, 추가 BMP·ICO 변환은 원본과 같은 Rust `image` 0.25.10을 사용한다.

- `src/lib/reference/chat-save-to-wiki.ts`와 원본 검사 7개: 원본 `src/lib/chat-save-to-wiki.ts`의 답변 정리·제목 추출을 보존했다. 웹 어댑터는 개인 대화·현재 근거 검증, query 유형의 비공개 위키 초안, 재시도 중복 방지, 기존 동료 검토에 연결한다.

- `src/lib/chat-images.ts`: 원본 `src/lib/chat-image-utils.ts`의 지원 형식·5장/5MB 제한·FileReader와 data URL 변환을 적용했다. 원본 채팅의 파일 선택·붙여넣기·끌어놓기·확대·이미지 단독 전송·재전송을 공식 shadcn 폼으로 연결하고, 웹에서는 서버 이미지 검증·대화 소유권·DB 저장·범위별 후속 문맥을 추가했다.

- 일반 채팅의 `web.search`: 원본 Rust `agent/runtime.rs`, `agent/tools.rs`의 사용자가 허용한 웹 검색·추가 탐색·원문 전용 제한과 채팅 검색 선택 동작을 적용했다. 기존 제공자 7종 어댑터를 재사용하고, 웹앱의 작업공간 제한·개인 대화·검색 발췌 스냅샷·W 인용·초안 저장으로 연결했다.
