<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 작업 범위와 검사

- 사용자 지시: 사용자가 별도로 요청하지 않는 한 Docker 관련 작업을 하지 않는다. 이미지 빌드·배포·컨테이너 조작·백업·복원 리허설도 제외한다.
- 사용자 지시: 브라우저 웹 클리퍼와 MCP 외부 연결은 제품 범위에서 제외한다. 별도 요청 없이 다시 추가하거나 설치하지 않는다.
- 누락 기능은 한 단계씩 구현하고 현재 단계의 완료와 남은 단계를 구분해 보고한다.
- 검사는 변경 기능에 필요한 범위로 제한한다. 전체 통합시험과 반복 빌드는 기본 절차로 실행하지 않는다.

## 폼 구성

- 사용자 지시: 폼은 shadcn/ui 컴포넌트로 구성한다. 화면에서 기본 HTML 입력창·선택창·체크박스를 직접 만들지 않는다.
- 컴포넌트는 `npx shadcn@latest add <컴포넌트명>`으로 설치한다. 설치된 스타일 `radix-rhea`와 `src/components/ui`의 공식 Field, Input, Textarea, Select, Checkbox, Button을 각 폼에서 직접 조합한다. 이를 흉내 낸 별도 UI 컴포넌트나 불필요한 폼 래퍼를 새로 만들지 않는다.
- 라벨과 입력 ID, 도움말 연결, 키보드 조작, 저장 중 비활성화와 초기화를 유지한다. 공식 폼 예제처럼 제출·접근성 용도의 `<form>` 구조는 유지한다.

## 디자인 시스템

- 전체 UI는 [hince 적용 기준](docs/design/hince/DESIGN.md)을 따른다. 흰 바탕·검정 본문·모브 로즈, 직각, 그림자 없는 면과 구분선, 상단 탐색을 사용한다.
- 원본 참조는 `/Users/jikime/Dev/Private/design-system/artifacts/sites/hince`이며 읽기 전용이다. 앱 전용 접근성·채팅·상태 확장은 위 문서에 구분해 기록한다.
- `src/styles`의 공통 규칙을 수정하고, 화면별 임의 색상·둥근 모서리·추가 테마를 누적하지 않는다. UI를 바꿀 때 권한·근거·검토 동작을 보존한다.
