# 프로젝트 사용·개발 안내

이 안내는 교육용 사본에서 기능을 찾고 AI와 함께 변경할 때 사용하는 공통 참고 자료입니다. 설치·계정·DB 준비는 [사전 준비](preparation.md)를 따릅니다. 기존 제품의 모든 코드를 순서대로 읽는 대신 실제 사용자 동작 하나를 선택해 흐름을 따라갑니다.

## 1. 프로젝트를 구성하는 부분

기본 흐름은 **화면 입력 → API 요청 → 사용자·권한·입력 검증 → DB·원본 저장 → 필요한 작업 등록 → 작업자의 문서·AI 처리 → 검토·게시 → 검색·답변**입니다. 모든 기능이 작업자를 거치는 것은 아닙니다. 단순 설정 저장과 오래 걸리는 문서 처리를 구분합니다.

| 부분 | 하는 일 | 프로젝트에서 찾는 위치 |
| --- | --- | --- |
| 페이지 | 작업공간과 기능 화면 구성 | [src/app](../../src/app) |
| 입력·상호작용 | 폼, 버튼, 브라우저 상태, 서버 요청 | [src/components](../../src/components) |
| API | 요청 주소와 서비스 연결 | [작업공간 API](../../src/app/api/workspaces) |
| 서비스 | 권한·범위·상태를 확인하고 업무 처리 | [src/server/services](../../src/server/services) |
| 공통 규칙 | 입력 검증, 용어·검색 등 재사용 함수 | [src/lib](../../src/lib) |
| DB | 계정·자료 버전·근거·작업 상태의 구조 | [schema.ts](../../src/server/db/schema.ts) |
| 원본 저장 | 업로드한 원본 파일 보관 | [originals.ts](../../src/server/storage/originals.ts) |
| 작업자와 큐 | 시간이 걸리는 추출·AI 작업 처리 | [작업자](../../src/worker/index.ts), [큐](../../src/server/jobs/queue.ts) |
| AI 연결 | 서버에서 API·CLI 선택과 모델 요청·응답 처리 | [client.ts](../../src/server/ai/client.ts), [cli.ts](../../src/server/ai/cli.ts) |

Next.js·React는 화면과 서버 연결, TypeScript는 코드의 형태 확인, PostgreSQL·Drizzle은 데이터 저장·접근, pgvector는 의미 검색용 벡터 비교, pg-boss는 작업 큐를 담당합니다. 서비스 AI의 공통 호출은 API·Claude Code CLI·Codex CLI를 지원합니다. 웹 화면은 기존 서버 API를 계속 호출하고 서버가 외부 모델 연결을 선택합니다. 이번 공통 개발 실습에 별도의 AI SDK나 다른 인증·저장 서비스를 새로 도입할 필요는 없습니다.

## 2. 기능별 코드 지도

| 업무 | 먼저 볼 파일 | 이어서 볼 파일 | 확인할 핵심 |
| --- | --- | --- | --- |
| 실무 기록 | [record-editor.tsx](../../src/components/record-editor.tsx) | [records.ts](../../src/server/services/records.ts), [proposals.ts](../../src/lib/proposals.ts) | 입력→검증→작성자 진술 원문 |
| 도메인 설정 | [관리 페이지](../../src/app/w/[workspaceId]/admin/page.tsx) | [settings-form.tsx](../../src/components/settings-form.tsx), [workspace.ts](../../src/server/services/workspace.ts) | FormData→JSON→관리 권한→저장 |
| 용어 검증 | [validation.ts](../../src/lib/validation.ts) | [DB 구조](../../src/server/db/schema.ts) | 설명 필수, 동의어 길이·개수 |
| 용어 검색 | [search-terms.ts](../../src/lib/search-terms.ts) | [용어 조회](../../src/server/services/search-terms.ts) | 명시 동의어만 확장 |
| 자료 검색 | [search.ts](../../src/server/services/search.ts) | [retrieval.ts](../../src/server/services/retrieval.ts) | 범위·공개 조건·키워드·벡터 |
| 원문과 처리 | [sources.ts](../../src/server/services/sources.ts) | [extract.ts](../../src/server/jobs/extract.ts), [document.ts](../../src/server/parsers/document.ts) | 원본 보존과 처리 상태 |
| 위키 | [wiki-editor.tsx](../../src/components/wiki-editor.tsx) | [wiki.ts](../../src/server/services/wiki.ts) | 근거 문단과 버전·검토 |
| 채팅 | [chat-workspace.tsx](../../src/components/chat-workspace.tsx) | [chat.ts](../../src/server/services/chat.ts) | 개인 대화·질문 범위·인용 |
| RFP | [rfp-editor.tsx](../../src/components/rfp-editor.tsx) | [business.ts](../../src/lib/business.ts), [rfp.ts](../../src/server/services/rfp.ts) | 명시 요구·기준·사례·추론·질문 |
| 로그인과 역할 | [auth.ts](../../src/server/auth.ts) | [access.ts](../../src/server/access.ts), [permissions.ts](../../src/lib/permissions.ts) | 인증과 업무 권한 |
| AI·검색 설정 | [env.ts](../../src/server/env.ts) | [웹 검색 설정](../../src/server/research/search.ts), [.env.example](../../.env.example) | 설정 형식·적용 범위·실행 프로세스 |
| 모델 호출 분기 | [client.ts](../../src/server/ai/client.ts) | [cli.ts](../../src/server/ai/cli.ts), [cli-protocol.ts](../../src/server/ai/cli-protocol.ts) | 용도별 선택→HTTP 또는 자식 프로세스→답변·사용량·오류 |
| 모델 연결 화면 | [model-connection.tsx](../../src/components/model-connection.tsx) | [연결 확인 API](../../src/app/api/workspaces/[workspaceId]/model/route.ts) | 현재 방식 조회와 실제 응답 확인, 선택·저장은 후속 설계 |

같은 이름의 파일이 다른 폴더에 있을 수 있습니다. 예를 들어 `src/lib/search-terms.ts`는 순수 검색어 처리, `src/server/services/search-terms.ts`는 DB의 도메인 용어 조회를 담당합니다. 파일 이름만 보고 역할을 단정하지 않습니다.

## 3. 변경할 위치를 결정하는 순서

| 문제 | 먼저 할 일 | 코드 변경이 필요한 예 |
| --- | --- | --- |
| 회사 약어를 못 찾음 | 도메인 용어·동의어·범위 확인 | 기존 입력 방식이 필요한 구분자를 지원하지 않음 |
| 실무 기록 내용이 부실함 | 기존 양식의 질문·예시 개선 | 새 데이터 필드·저장 규칙이 실제로 필요함 |
| 위키에 조건이 빠짐 | 목적·구조·원문·생성 결과 검토 | 생성 입력이나 검토 동작 자체의 문제가 재현됨 |
| 자료가 검색되지 않음 | 처리·공개·프로젝트·추출 확인 | 같은 정상 상태에서 검색 함수 문제가 재현됨 |
| 웹 검색 제공자가 없음 | 키·제공자 설정·작업공간·설정 반영 확인 | 올바른 설정인데 표시·필터 로직이 잘못됨 |
| CLI 모델 연결 실패 | 선택한 용도·모델→실행 경로→운영 계정 인증→한도·시간 확인 | 설치·인증이 정상인데 응답 해석이나 취소 처리 문제가 재현됨 |

설정으로 해결된 문제도 개발 과정의 성과입니다. 반대로 새로운 데이터 구조가 필요한 문제를 도움말만 바꾸어 구현 완료라고 하지 않습니다.

## 4. 코드를 읽을 때 필요한 최소 문법

```typescript
const title = "프로젝트 A";
function trimTitle(value: string): string {
  return value.trim();
}
const cleanTitle = trimTitle(title);
```

`const`는 사용할 값을 이름에 연결합니다. 함수 괄호 안은 입력, `return`은 결과입니다. `: string`은 문자열 형태를 기대한다는 뜻입니다. 실제 서버가 받은 데이터가 올바른지는 입력 검증으로 확인합니다.

```typescript
const aliases = ["VMS", "전광표지"];
const input = { title: "사업 개요", aliases };
```

배열은 여러 항목을 순서대로 담고, 객체는 이름이 붙은 값을 묶습니다. API에서 JSON으로 전달하는 데이터도 이런 구조를 사용합니다.

`async`와 `await`는 완료까지 시간이 걸리는 작업의 결과를 다룰 때 만납니다. 요청이 끝나기 전에 화면에서 결과를 사용하거나, 실패를 처리하지 않으면 예상하지 못한 동작이 생길 수 있습니다. 이번 과정에서는 기존 호출의 입력·결과·오류 처리 위치를 찾는 수준부터 익힙니다.

## 5. AI와 함께 작업하는 세 가지 요청 예

### 코드 읽기

```text
실무 기록 화면에서 저장까지의 흐름을 이해하고 싶습니다.
record-editor.tsx, records.ts, src/lib/proposals.ts를 확인하고
제목·상황·근거 문단이 어떻게 전달·검증·저장되는지 설명해 주세요.
추정은 구분하고, 실제 확인한 함수와 파일을 알려 주세요.
이번에는 코드를 수정하지 말고 제가 설명할 수 있는 흐름도로 정리해 주세요.
```

### 오류 진단

```text
교육용 프로젝트 A에 등록한 자료가 처리 완료지만 이용자 검색에 나오지 않습니다.
작성자 상세에서는 보이고 일반 이용자 검색에서는 보이지 않습니다.
먼저 공개 상태·범위·권한을 확인하는 순서를 제시해 주세요.
확인할 화면·코드를 짚고, 증거 없이 DB 손상이나 모델 문제로 단정하지 말아 주세요.
```

### 결과 검토

```text
첨부한 변경 내역과 정상·실패 입력 결과를 검토해 주세요.
완료 기준은 구분자 처리 개선, 기존 입력·서버 검증·권한 유지입니다.
확인한 사실과 아직 검사하지 못한 부분을 나누고,
요청 범위를 벗어난 변경이나 누락된 검증이 있는지 설명해 주세요.
```

## 6. 확인과 저장

문구 변경은 실제 화면과 관련 입력 동작을 확인합니다. 순수 함수 변경은 경계 입력을 포함한 검사와 호출 위치를 확인합니다. API·저장 변경은 서버 검증과 역할·상태를 포함해 해당 기능을 확인합니다.

```bash
git status --short
git diff --check
git diff
```

새 파일은 기본 `git diff`에 본문이 나타나지 않을 수 있습니다. 해당 파일만 추가한 뒤 `git diff --cached`로 확인합니다. 환경 파일·API 키·비밀번호·원본 데이터가 섞였는지 함께 봅니다. `git add .`로 전체 변경을 무조건 추가하지 않습니다.

코드 변경을 취소할 때는 먼저 본인 변경의 범위를 확인합니다. 되돌리기 명령을 실행하기 전에 대상 커밋 또는 파일과 사라질 내용을 읽습니다. 이미 저장·공개한 자료의 상태는 코드와 별개로 관리합니다.

## 7. 기술 문서를 찾고 적용하는 방법

1. 현재 코드의 오류·함수 이름과 해결할 질문을 적습니다.
2. `package.json`과 잠금 파일에서 설치 버전을 확인합니다.
3. Next.js는 저장소 지침에 따라 `node_modules/next/dist/docs/`의 해당 안내부터 확인합니다.
4. 공식 문서에서 필요한 동작의 입력·제약·예제를 찾습니다. 웹 문서의 최신 버전이 설치 버전과 다를 수 있습니다.
5. 작은 입력이나 교육용 사본에 적용하고 실제 결과를 비교합니다.
6. T4에 자료·버전·적용 조건·확인 결과를 남깁니다.

참고 출발점: [Next.js 서버·클라이언트](https://nextjs.org/docs/app/getting-started/server-and-client-components), [TypeScript 안내](https://www.typescriptlang.org/docs/handbook/intro.html), [Git 변경 비교](https://git-scm.com/docs/git-diff). 이 교재의 구체적인 동작은 현재 프로젝트 코드가 기준이며, 공식 문서의 예제 전체를 기존 기능에 그대로 덮어쓰지 않습니다.

## 8. 모델 연결의 현재 기능과 설정 화면 권장안

`streamModel`은 대화·지식 생성·이미지 설명에 공통으로 사용하는 호출 함수입니다. 용도별 설정을 확인한 뒤 API이면 HTTP 스트림을 읽고, CLI이면 서버에 설치된 실행 파일을 새 자식 프로세스로 실행합니다. 권한·근거 검색·검토는 기존 위키 서버의 흐름을 거칩니다. 임베딩과 Tavily 등 웹 검색은 기존 API 연결을 사용합니다.

| 항목 | 현재 구현 | 후속 설정 화면 권장안 · 미구현 |
| --- | --- | --- |
| 연결 선택 | 환경 변수의 공통값과 용도별 덮어쓰기 | 운영자가 연결을 등록하고 회사 관리자가 허용된 연결을 선택·저장 |
| 모델·인증 | 모델·API 설정 또는 서버 계정의 CLI 인증 | 연결·모델·인증·과금·사용 범위를 함께 표시, 확인 불가는 미확인 표시 |
| 연결 확인 | 관리자 화면에서 채팅·지식 생성·임베딩 실제 응답 점검 | 연결별 상태와 마지막 검사 시각을 보존해 표시 |
| 적용 시점 | 웹 서버·작업자 재시작 | 저장한 설정을 새 요청부터 일관되게 적용 |
| 실행 제한 | CLI 동시 실행 수·시간 제한, 실패 시 API 자동 호출 없음 | 관리 가능한 한도와 실패 처리 방침을 화면에 표시 |

후속 설계에서는 DB에 회사별 선택과 관리 정보를 저장하고, 비밀 값과 CLI 인증은 서버의 관리 수단으로 분리합니다. 현재 서버 환경 변수는 같은 서버를 사용하는 작업공간에 영향을 줄 수 있으므로, 회사별 선택 화면을 추가할 때는 적용 범위와 관리 권한도 함께 구현해야 합니다. 위 표의 오른쪽 열을 현재 기능이나 필수 실습의 완료 기준으로 사용하지 않습니다.

회사 공용 기본 연결은 API를 권장합니다. Claude는 개인 Free·Pro·Max 인증으로 다른 사용자의 요청을 중계하는 방식을 제한합니다. Codex는 구독·API 키 인증을 구분하고 프로그램 자동화에는 API 키 사용을 안내하며 Enterprise용 자동화 인증도 제공합니다. CLI 연결 성공만으로 이용 조건을 충족했다고 판정하지 않습니다. [Anthropic 공식 이용 안내](https://code.claude.com/docs/en/legal-and-compliance), [OpenAI 공식 인증 안내](https://learn.chatgpt.com/docs/auth)

이용 조건을 확인한 개인 교육 환경이나 강사 시연에서는 API와 CLI의 호출 경로·오류 처리를 비교할 수 있습니다. 구체적인 변수·실행 명령·현재 검증 범위는 [모델 연결 안내](../MODEL_TRANSPORTS.md)를 따릅니다. API·CLI를 같은 모델 이름으로 설정해도 기본 지침과 요청 구조가 달라 답변이 같다고 보장하지 않으며, 비교표에는 연결 방식과 모델을 함께 적습니다.
