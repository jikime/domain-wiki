# API·Claude Code CLI·Codex CLI 연결

2026-09-13 원본 `llm_wiki`의 API/CLI 선택과 Claude·Codex 실행 프로토콜을 `my-domain-wiki`의 공통 모델 호출에 적용했다. 채팅, 문서 분석·위키 생성, 품질 점검, 심층 조사 합성, 이미지 설명에서 용도별 연결을 선택한다. 기존 권한·근거 검색·검토·사용량 기록 흐름을 그대로 거친다.

## 연결 선택

| 값 | 실행 방식 | 필요한 모델 설정 |
| --- | --- | --- |
| `api` | 기존 OpenAI 호환 Chat Completions HTTP 스트리밍 | 모델·API 주소·API 키 |
| `claude-code` | 서버의 `claude` 실행 파일, JSON 스트림 | 모델·서버 운영 계정의 CLI 인증 |
| `codex-cli` | 서버의 `codex exec`, JSONL 응답 | 모델·서버 운영 계정의 CLI 인증 |

`AI_TRANSPORT`의 기본값은 `api`다. `AI_CHAT_TRANSPORT`, `AI_KNOWLEDGE_TRANSPORT`, `AI_VISION_TRANSPORT`를 비워두면 공통 연결을 따른다. 모델·주소·키도 기존 용도별 우선순위를 유지한다. 다만 문서의 이미지 설명은 `AI_VISION_MODEL`을 직접 지정해야 활성화된다. 채팅 첨부 이미지는 채팅 모델에 전달하므로 채팅 모델이 이미지 입력을 지원해야 한다.

설정은 서버 환경 변수로 관리한다. 관리자 화면에서는 채팅·지식 생성의 현재 연결 방식과 모델을 확인하고 **모델 연결 확인**으로 실제 응답을 점검한다. 설정을 바꾼 뒤에는 웹 서버와 작업자를 함께 재시작한다. `.env.local` 등 우선순위가 높은 파일에 같은 변수가 있으면 `.env`의 변경이 적용되지 않을 수 있다.

### 기존 OpenAI API 유지

기존 `OPENAI_API_KEY` 자동 연결은 `AI_TRANSPORT=api`일 때 유지된다. 공통 `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`를 직접 설정한 경우에는 이 세 항목이 우선한다.

```dotenv
AI_TRANSPORT=api
AI_BASE_URL=
AI_MODEL=
AI_API_KEY=
OPENAI_API_KEY=운영_API_키
OPENAI_MODEL=gpt-5.6-terra
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

### 채팅·지식 생성 모두 Claude Code 사용

```dotenv
AI_TRANSPORT=claude-code
AI_MODEL=sonnet
AI_BASE_URL=
AI_API_KEY=
AI_CHAT_TRANSPORT=
AI_CHAT_MODEL=
AI_KNOWLEDGE_TRANSPORT=
AI_KNOWLEDGE_MODEL=
AI_CLAUDE_CLI_BIN=claude
AI_CLI_MAX_CONCURRENT=1
AI_TIMEOUT_SECONDS=90
```

Codex를 공통 연결로 쓰려면 위의 `AI_TRANSPORT`를 `codex-cli`, `AI_MODEL`을 계정에서 사용할 수 있는 Codex 모델로 바꾼다. 이번 로컬 연결 검사는 `gpt-5.6-terra`로 통과했다. 실행 파일 경로는 `AI_CODEX_CLI_BIN`으로 지정한다.

### 채팅은 Codex, 지식 생성은 Claude, 임베딩은 기존 API

공통 API를 유지하면서 생성 용도만 CLI로 바꾸면 기존 임베딩 설정을 이어서 사용할 수 있다.

```dotenv
AI_TRANSPORT=api
AI_BASE_URL=
AI_MODEL=
AI_API_KEY=
OPENAI_API_KEY=운영_API_키
OPENAI_MODEL=gpt-5.6-terra
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
AI_CHAT_TRANSPORT=codex-cli
AI_CHAT_MODEL=gpt-5.6-terra
AI_KNOWLEDGE_TRANSPORT=claude-code
AI_KNOWLEDGE_MODEL=sonnet
# 문서 이미지 설명도 사용할 경우
AI_VISION_TRANSPORT=claude-code
AI_VISION_MODEL=sonnet
```

공통 연결 자체를 CLI로 바꾼 경우에는 `OPENAI_*` 자동 연결이 적용되지 않는다. 의미 검색을 계속 사용하려면 임베딩을 별도로 설정한다. 아래 `${OPENAI_API_KEY}`는 기존 서버 환경 파일의 키 참조이며 새 키를 만들라는 의미가 아니다.

```dotenv
AI_EMBEDDING_MODEL=text-embedding-3-small
AI_EMBEDDING_BASE_URL=https://api.openai.com/v1
AI_EMBEDDING_API_KEY=${OPENAI_API_KEY}
```

## 서버 설치·인증과 사용량

웹 서버와 작업자를 실행하는 운영체제 계정에서 CLI를 설치·인증한다. 다른 계정에서 로그인한 상태는 자동 공유되지 않는다. 서비스의 `PATH`에 실행 파일이 없으면 `AI_CLAUDE_CLI_BIN`, `AI_CODEX_CLI_BIN`에 실행 파일의 절대 경로를 넣는다. 인자까지 포함한 셸 명령은 입력하지 않는다.

Claude Code는 [공식 설치 안내](https://code.claude.com/docs/en/setup)와 [프로그램 실행 안내](https://code.claude.com/docs/en/headless)를 따른다. Codex는 [공식 인증 안내](https://learn.chatgpt.com/docs/auth)와 [비대화형 실행 안내](https://learn.chatgpt.com/docs/non-interactive-mode)를 따른다. 이 구현은 macOS에서 Claude Code `2.1.266`, Codex CLI `0.153.4`로 실제 응답을 확인했다. 서버에서도 필요한 옵션을 지원하는 버전을 설치해야 한다. 실행 경로는 Node.js 자식 프로세스를 사용할 수 있어야 하며 Windows용 `.cmd` 래퍼 실행은 검증하지 않았다.

CLI 실행과 구독 과금은 서로 다른 설정이다. CLI가 구독 계정으로 인증되어 있으면 해당 계정의 이용 범위·한도를 따르고, API 키로 인증되어 있으면 API 과금이 발생할 수 있다. 회사 여러 사용자의 요청을 개인 구독으로 중계할 수 있는지는 제공사의 계약 조건을 확인해야 한다. 특히 Claude Code의 Free·Pro·Max 인증을 다른 사용자에게 제공하는 제품에 중계하는 용도는 [공식 이용 안내](https://code.claude.com/docs/en/legal-and-compliance)의 제한 대상이다.

서버는 CLI의 기존 인증을 사용한다. Claude에는 `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`과 Anthropic 인증 변수를, Codex에는 기존 `CODEX_HOME`, 명시적인 `CODEX_API_KEY`를 허용한다. 앱의 `OPENAI_API_KEY`는 Codex 자식 프로세스에 전달하지 않는다. 임베딩용 앱 키가 CLI의 저장된 로그인 방식을 바꾸지 않도록 하기 위해서다. DB 접속 정보·앱 인증 비밀·`NODE_OPTIONS`도 전달하지 않는다.

CLI 호출에는 실행·기본 프롬프트 비용이 추가되며, 질문이 짧아도 입력 사용량이 발생한다. 화면의 토큰 기록은 CLI가 반환한 사용량이며 청구 금액을 의미하지 않는다. CLI 한도 초과·인증 오류·실행 실패 시 오류를 반환하고 API로 자동 전환하지 않는다.

## 실행 범위와 제한

- 질문마다 빈 임시 작업 폴더를 만들고 대화 기록 전체를 한 요청으로 전달한다. CLI 대화 세션을 재사용하지 않으며 세션 저장을 비활성화한다. Codex 이미지 파일은 해당 임시 폴더에 저장하고 프로세스 종료 후 제거한다.
- Claude는 안전 모드·빈 도구 목록·엄격한 빈 MCP 설정을, Codex는 사용자 설정·규칙 무시, 읽기 전용 샌드박스와 셸·검색·앱·플러그인 등 기능 비활성화 옵션을 사용한다. CLI를 모델 응답 생성에 한정하고 업무 도구 실행은 기존 위키 서버의 권한 검사를 거친다.
- CLI에 대화 역할 기록을 직렬화하여 전달한다. API의 역할별 메시지와 CLI의 기본 지침은 구조가 달라 답변 표현이 완전히 같지는 않다. API의 `temperature` 옵션은 CLI에 전달하지 않는다.
- `AI_TIMEOUT_SECONDS`는 기본 90초, 최대 300초이며 대기열·실행 시간을 함께 제한한다. 기능별로 더 짧은 기존 제한이 있으면 먼저 적용된다. 취소·시간 초과 시 CLI 프로세스 그룹을 종료하고, 응답하지 않으면 1초 뒤 강제 종료한다.
- `AI_CLI_MAX_CONCURRENT`는 기본 1이며 **Node.js 프로세스별** 한도다. 웹 서버와 작업자는 각자 슬롯을 가진다. 여러 서버 인스턴스를 합친 전역 한도는 아니며 기존 작업공간별 작업 제한도 함께 적용된다.
- 입력 문자 수는 기존 용도별 상한을 따른다. CLI 어댑터는 이미지 최대 16장·합계 32MiB, 답변 30,000자, 표준 출력 4MiB·한 행 1MiB, 오류 출력 64KiB로 제한한다. 채팅 화면의 기존 5장·장당 5MB 제한은 그대로 적용된다.

Tavily 등 웹 검색은 기존 검색 제공자를 사용한다. 임베딩도 기존 HTTP API를 사용한다. 이번 변경에는 모델 제공사의 기본 웹 검색 도구, Anthropic Messages API, OpenAI Responses API 추가가 포함되지 않는다.

## 확인 명령과 검증 범위

환경 설정 검사와 외부 호출 없는 집중 검사는 다음 명령으로 실행한다.

```sh
npm run env:check
npm run test:ai
npm run typecheck
```

다음 명령은 서버 계정의 **실제 CLI 모델을 호출**한다. 현재 앱의 연결 설정을 바꾸거나 DB에 자료를 만들지 않는다. 출력은 완료 여부·모델·응답 길이·토큰 사용량이며 인증 정보나 응답 원문은 출력하지 않는다.

```sh
npm run model:check-cli -- --transport claude-code --model sonnet
npm run model:check-cli -- --transport codex-cli --model gpt-5.6-terra
```

2026-09-13 로컬 실제 호출 결과:

| 연결 | 모델 | 완료 | 응답 길이 | 입력/출력 토큰 |
| --- | --- | --- | --- | --- |
| Claude Code `2.1.266` | `sonnet` | 성공 | 5자 | 5,159 / 7 |
| Codex CLI `0.153.4` | `gpt-5.6-terra` | 성공 | 5자 | 8,448 / 26 |

최종 검사: `npm run test:ai` 4개 파일의 36개 검사 통과(3.45초), `npm run typecheck`, `npm run env:check`, 변경 코드 16개 파일의 Biome 검사, `git diff --check` 통과. npm의 기존 사용자 설정 `python` 경고와 Vite의 향후 설정 로더 변경 예고가 출력되었으며 검사 실패는 없었다.

집중 검사는 API 요청·SSE 호환, 용도별 혼용, 이미지 입력, CLI 출력 중복 제거·완료 판정, 환경 비밀 분리, 대기 취소·프로세스 그룹 종료·임시 파일 삭제, 오류 시 API 미전환을 다룬다. 실제 호출은 짧은 연결 문구 확인이며 원격 운영 서버 설치나 업무 답변·이미지 해석 품질 검증을 대신하지 않는다. 실제 `.env`·`.env.local`의 활성 연결 설정은 변경하지 않았다. 전체 통합시험·운영 빌드·Docker 작업은 이번 검사에 포함하지 않았다.
