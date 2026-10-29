# 우리 업무 위키

업무 자료와 실무 경험을 함께 쌓고, 근거를 확인하며 질문하는 팀의 지식 공간입니다.

**웹 워크북:** 서비스를 실행한 뒤 [http://localhost:3010/workbook](http://localhost:3010/workbook)을 엽니다. 로그인 없이 교재를 읽고, 실습 자료를 내려받으며, 최신 교육생 교재를 인쇄·PDF로 저장할 수 있습니다. 위키 서비스의 로그인 화면과 상단 메뉴에서도 연결됩니다.

실습 소스: [jikime/domain-wiki](https://github.com/jikime/domain-wiki). 교육생은 **1단계 수업 안에서** [기본 도구·개발용 AI·디자인 하네스 설치](docs/training/environment-setup.md)와 [Git에서 받기·첫 실행](docs/training/getting-started.md)을 진행해 내 PC의 업무환경을 만듭니다. [단계별 상세 교육안](docs/training/README.md)에 따라 같은 프로젝트를 이어서 실습합니다. 기술의 목적과 구조를 이해하고, 교육생은 요구·AI 요청·결과 확인을 맡으며 구현과 기술 검사는 AI가 수행합니다.

원본 `llm_wiki`의 반복 탐색 채팅·검색·위키 병합·목적/스키마·템플릿·폴더/URL 가져오기·문서/이미지 처리·선택 문장 AI·품질 수정·심층 조사·프로젝트 ZIP 이동을 웹 환경에 복원했습니다. 원본의 순수 함수와 프롬프트를 옮기고, 회사용 권한·불변 원문·직원 검토와 연결했습니다. [기능별 복원표](docs/ORIGINAL_FEATURE_PARITY.md), [새 실제 모델 정리·개정 평가](docs/evaluation/core/ingest-12-original-parity-20260910/README.md), [운영 이미지·백업 복원](docs/evaluation/core/original-parity-deployment/README.md)에 검증 범위를 기록합니다. 아래 1~16단계의 검사 수는 이번 복원 이전 기록입니다.

누락 기능 구현 이전 전체 통합시험 **253개**, 원본 함수 **192개**, 네이티브 변환기 **8개**를 통과했습니다. 당시 새 의존성 설치의 빌드와 실제 모델 최초·개정 4개 위키, 54개 테이블·파일 16개의 별도 환경 복원도 확인했습니다. OCR·Vision·웹 검색의 실제 외부 제공자 품질은 별도 검증 대상입니다.

후속으로 **채팅 답변 → 위키 초안 저장**, **이미지 첨부 채팅**, **일반 채팅 웹 검색**을 구현했습니다. 브라우저 웹 클리퍼와 MCP 외부 연결은 2026-09-10 사용자 요청에 따라 제거했으며 최종 제품 범위에서 제외합니다. 원본 전체 기능의 완전한 동등성을 선언하는 것은 아닙니다. 웹 검색은 **우리 업무 위키 · 개발 공간에 Tavily를 연결**하고 실제 검색·채팅 인용·모바일 출처를 확인했습니다. [연결 기록](docs/evaluation/tavily-connection-20260910/README.md), [단계별 구현·검사 기록](docs/MISSING_FEATURE_STAGES.md)을 참고하세요. Docker 작업은 별도 요청 시에만 진행합니다.

1~16단계의 자료·위키·채팅·실무 경험·자동 분석·검토·개정·관계 검색·품질 점검·지식 그래프와 운영 복원을 구현·검증했습니다. 전체 통합시험 **198개**, 마지막 분석 보완의 관련 회귀 **50개**를 통과했습니다. 가상 자료로 실제 모델의 등록→자동 변경안→검토·게시→채팅→개정 흐름과 48개 테이블·원본의 새 환경 복원을 확인했습니다. [전체 결과와 남은 실제 검증](docs/COMPLETION.md)을 확인하세요.

[llm_wiki 핵심 기능 적용 — 9~16단계](docs/CORE_FEATURE_PLAN.md)를 완료했습니다. 원본 전체 기능의 일대일 복제는 아니며, 회사용 권한·불변 원문·직원 검토에 맞춰 적용한 범위입니다. [동일 입력 전후 평가](docs/evaluation/core/final-16-fixed/README.md), [원본 별도 실행 비교](docs/evaluation/core/reference-16/README.md), [최종 운영 검증](docs/stages/16-core-validation/README.md)에 결과와 제한을 기록했습니다. 고객 업무 담당자의 인수 검토와 외부 서버 배포는 별도입니다.

지식 그래프 화면은 [원본 Sigma 구성](docs/improvements/06-sigma-graph/README.md)으로 교체했습니다. Sigma·React Sigma·ForceAtlas2를 원본과 같은 버전으로 사용하며, 그래프를 크게 표시하고 필터·인사이트·상세 정보는 필요할 때 엽니다. 후속 전체 통합시험 199개를 통과했습니다.

UI는 hince 디자인 시스템으로 전면 교체했습니다. 상단 탐색·도메인 탭·직각 입력과 구분선 목록, 본문/작업 패널, 채팅 근거 패널을 사용합니다. [디자인 적용 기준](docs/design/hince/DESIGN.md)과 [화면·기능 검증](docs/design/hince/VERIFICATION.md)을 확인하세요.

채팅은 입력창 중심으로 개선했습니다. 첫 질문 자동 저장, 하단 입력창, 도메인·프로젝트 범위 자동 저장, 출처 선택 시 원문 패널, 대화 검색과 모바일 목록을 제공합니다. [채팅 화면과 사용 흐름](docs/design/hince/chat-ux/README.md)을 확인하세요.

## 로컬 실행

**이미 첫 설정을 마쳤다면** Docker Desktop을 켜고 프로젝트에서 `npm run dev:all`을 실행합니다. DB 준비 후 웹 서버·작업자가 함께 시작되며, 접속 주소는 `http://localhost:3010`입니다. `Ctrl+C`로 웹 서버·작업자를 함께 종료하고 DB는 켜 둡니다. 처음 설치하는 경우에는 아래 준비 과정을 먼저 진행합니다.

모델 연결의 기본값은 **Claude Code CLI·sonnet**입니다. API·Codex CLI도 선택할 수 있습니다. 채팅과 지식 생성의 연결을 따로 지정하고, 임베딩·Tavily 검색은 기존 API를 유지할 수 있습니다. CLI 두 종류의 로컬 실제 응답을 확인했습니다. [서버 설정 예시·인증·검사 안내](docs/MODEL_TRANSPORTS.md)를 참고하세요.

Node.js 22.23.1, npm 10.9.8의 새 설치와 실행 중인 Docker 환경에서 확인했습니다. 원본 문서 변환기를 직접 빌드하려면 Rust도 필요합니다.

```bash
npm ci
npm run native:build
npm run setup:local
npm run db:up
npm run db:migrate
npm run db:bootstrap
npm run db:content-team
npm run db:seed-training
npm run db:check-training
npm run dev
```

[http://localhost:3010](http://localhost:3010)으로 접속합니다. 별도 터미널에서 `npm run worker`를 실행해야 등록된 문서가 처리됩니다. 기존 `.env.local`을 유지한 경우 `BETTER_AUTH_URL`도 `http://localhost:3010`으로 맞춥니다.

초기 관리자·이용 직원 계정과 무작위 비밀번호는 `.local/initial-accounts.json`, 작성·검토 직원 계정은 `.local/content-accounts.json`에 저장됩니다. 이 파일들과 `.env.local`은 Git에서 제외합니다. 기존 환경·DB·계정은 초기화 명령을 반복해도 유지합니다.

교육용 샘플은 `db:seed-training`으로 준비합니다. 저장소의 `docs/training/samples/training-snapshot.json`에서 A/B 프로젝트·자료 6건·게시 위키 2건과 원본·근거를 추가하며, 기존 교육용 도메인이 있으면 덮어쓰지 않습니다. 계정·비밀번호는 각 PC의 것을 유지합니다. [샘플 준비와 복구 안내](docs/training/sample-data.md), [웹 안내](http://localhost:3010/workbook/sample-data)에서 검색 확인 순서와 백업 다운로드를 볼 수 있습니다.

웹 서버·작업자를 실행하는 사용자 계정에서 Claude Code를 설치하고 `claude`로 로그인합니다. 초기 설정은 `AI_TRANSPORT=claude-code`, `AI_MODEL=sonnet`이며, 별도 생성용 API 키 없이 기존 CLI 인증을 사용합니다. 설정 변경 후 웹 서버와 작업자를 함께 재시작합니다. 실제 연결은 관리자 화면의 **모델 연결 확인**으로 점검합니다.

임베딩은 별도의 HTTP API를 사용합니다. 기존 `OPENAI_API_KEY`·`OPENAI_EMBEDDING_MODEL`이 있으면 CLI를 사용하면서도 의미 검색을 유지합니다. 직접 지정한 `AI_EMBEDDING_*` 또는 공통 API 설정이 우선합니다. 생성까지 OpenAI API로 바꾸려면 `AI_TRANSPORT=api`를 명시하고 [API 설정 예시](docs/MODEL_TRANSPORTS.md)를 따릅니다. `.env`·`.env.local`은 Git과 Docker 이미지에서 제외됩니다.

2026-09-09에 키 적용과 웹·작업자 재시작을 완료했습니다. [실제 OpenAI 연결·검색·출처 답변 확인](docs/openai/VERIFICATION.md)에 결과를 기록했습니다.

## 단계별 문서

| 단계 | 기능·실행 안내 | 검증 결과 |
| --- | --- | --- |
| 1 | [로그인·역할·업무 공간](docs/stages/01-foundation/README.md) | [기반 검증](docs/stages/01-foundation/VERIFICATION.md) |
| 2 | [원본·처리·위키·근거](docs/stages/02-knowledge/README.md) | [자료·게시 검증](docs/stages/02-knowledge/VERIFICATION.md) |
| 3 | [대화·검색·모델 연결](docs/stages/03-chat/README.md) | [채팅 검증](docs/stages/03-chat/VERIFICATION.md) |
| 4 | [실무 기록·AI 변경 묶음](docs/stages/04-proposals/README.md) | [생성·검토 검증](docs/stages/04-proposals/VERIFICATION.md) |
| 5 | [입문·프로젝트·문서 품질](docs/stages/05-discovery/README.md) | [탐색·추출 검증](docs/stages/05-discovery/VERIFICATION.md) |
| 6 | [개정·검토·운영·삭제](docs/stages/06-operations/README.md) | [운영 검증](docs/stages/06-operations/VERIFICATION.md) |
| 7 | [배포·백업·복구](docs/stages/07-deployment/README.md) | [복구 검증](docs/stages/07-deployment/VERIFICATION.md) |
| 8 | [공식 자료·RFP 보고서](docs/stages/08-business/README.md) | [업무 확장 검증](docs/stages/08-business/VERIFICATION.md) |
| 9 | [영속 AI 작업](docs/stages/09-ai-foundation/README.md) | 단계 문서의 계약·실제 모델 검사 |
| 10 | [문서 전체 분석](docs/stages/10-document-analysis/README.md) | 원문 구간·수치·부정·사용량 |
| 11 | [분석 기반 위키 생성](docs/stages/11-wiki-generation/README.md) | 여러 페이지·변경 묶음·검토 |
| 12 | [자동 정리·증분 갱신](docs/stages/12-ingest-automation/README.md) | 공개·개정·캐시·동시성 |
| 13 | [관계 검색과 문맥](docs/stages/13-graph-search/README.md) | 직접·간접 근거와 적용 범위 |
| 14 | [전체 품질 점검](docs/stages/14-quality-review/README.md) | 구조·AI 후보·담당 처리 |
| 15 | [지식 그래프](docs/stages/15-knowledge-graph/README.md) | 군집·연결·키보드·모바일 |
| 16 | [실제 모델·운영 반영](docs/stages/16-core-validation/README.md) | [전후·원본 비교](docs/evaluation/core/final-16-fixed/README.md) · [운영 복원](docs/evaluation/core/deployment-16/README.md) |

[전체 구현 계획](docs/IMPLEMENTATION_PLAN.md) · [구현 작업 목록](docs/IMPLEMENTATION_BACKLOG.md) · [평가 표본](docs/evaluation/README.md) · [실제 팀 시험표](docs/stages/07-deployment/TEAM_ACCEPTANCE.md)

## 검사

```bash
npm run env:check
npm run lint
npm run typecheck
npm run test:ai
npm run evaluation:check
npm run evaluation:parsers
npm run test:official
npm run test:reference
npm run native:test
npx playwright install chromium
npm run test:integration
```

통합시험 명령은 프로덕션 빌드 후 전용 `domain_wiki_test` DB와 3101번 포트에서 실행합니다. 테스트 표본은 종료 시 정리합니다. 개발 DB는 유지됩니다.

업로드는 파일당 최대 100MiB이며 문서·표·전자책·이미지 형식을 지원합니다. 스캔 PDF는 MinerU, 이미지 설명은 Vision 모델을 명시적으로 연결하여 사용합니다. 구형 Office·MOBI 변환기, 폴더 감지 및 URL 일괄 가져오기 설정은 [가져오기·변환 안내](docs/ORIGINAL_IMPORTS_AND_PARSERS.md)를 확인하세요.
# domain-wiki
