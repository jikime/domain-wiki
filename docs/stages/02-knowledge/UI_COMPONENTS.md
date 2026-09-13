# 후속 반영 — shadcn/ui 폼 통일

반영일: 2026-09-09. 사용자 지시에 따라 1~2단계의 기존 폼을 공식 shadcn/ui 컴포넌트로 교체했다. 3단계 기능 개발은 시작하지 않았다.

## 설치와 구성

```bash
npx shadcn@latest add field input textarea select checkbox --yes --overwrite
```

CLI 4.21.0, 프로젝트의 `radix-rhea` 설정으로 설치했다. 직접 선택한 5개와 Field 의존성 Label·Separator를 포함해 7개 파일이 `src/components/ui`에 추가됐다. 기존 Button도 공식 컴포넌트를 사용한다.

공식 [Field 구성](https://ui.shadcn.com/docs/components/radix/field)과 [폼 예제](https://ui.shadcn.com/docs/forms/react-hook-form)를 기준으로 Field·FieldLabel·FieldDescription·FieldSet과 입력 컴포넌트를 각 화면에서 직접 조합한다. 별도의 범용 폼 래퍼는 추가하지 않았다. 기존 API와 제출 로직을 유지했으므로 React Hook Form 의존성은 추가하지 않았다.

`<form>`은 Enter 제출·FormData·접근성을 위한 기본 구조로 유지한다. 화면에서 기본 `input/select/textarea/label/button/fieldset`을 직접 작성하던 코드는 공식 컴포넌트로 교체했다. 공식 Input 등의 내부 HTML 요소는 컴포넌트 구현에 속한다.

## 적용 범위

- 로그인: Input·Field·FieldLabel·FieldSet·FieldError·Button.
- 관리: 도메인·용어·양식, 프로젝트, 직원 역할·관리 권한·이용 상태에 Input·Textarea·Select·Checkbox와 Field 구성.
- 자료실: 파일 Input, 도메인·프로젝트·분류 Select, 검토 의견 Textarea.
- 공통 검색: 검색 Input과 도메인·프로젝트 Select, 검색 Button.
- 위키 편집: 제목·본문, 도메인·프로젝트, 근거 Checkbox와 제거 Button.
- 채팅 준비 화면: 공식 Select·Textarea·Button으로 표시. 실제 전송 기능은 계속 비활성 상태다.

각 입력은 고유 ID와 라벨을 연결했고 도움말은 `aria-describedby`로 연결했다. 저장 중 입력과 조작을 비활성화한다. 관리 화면의 생성 성공 후에는 입력 영역을 다시 마운트해 Radix 선택창·체크박스도 함께 초기화한다. 도메인을 바꾸면 프로젝트 선택을 초기화하고, 도메인 공통·전체 선택의 표시값은 서버에서 사용하는 빈 값으로 변환한다.

기본 입력 태그에 적용하던 전역 모양 규칙을 제거하고 shadcn 테마 변수와 컴포넌트의 스타일을 사용한다. 프로젝트의 녹색 테마와 입력 높이·모바일 배치는 유지했다. Field 설치 코드에는 프로젝트 Biome 검사에 맞춘 엄격 비교·고유 오류 메시지 키, 공식 group 구조를 유지하는 국소 검사 예외만 적용했다.

## 검증

- 프로덕션 빌드와 타입 검사 통과.
- Biome 87개 파일 검사 통과.
- 통합시험 18개 통과, 33.8초. 기존 권한·문서·위키 기능 검사를 유지했다.
- 관리 화면에서 Select로 프로젝트 도메인 지정 후 저장, 저장 후 초기화 확인.
- 역할 Select와 관리자 Checkbox 변경 후 실제 API 저장값 확인. Space 키로 Checkbox 조작 확인.
- 자료 분류 Select를 변경해 업로드하고 저장된 분류·도메인 공통 범위 확인.
- 자료 공개 → 근거 Checkbox 선택 → 위키 작성·제출·게시 흐름 통과.
- 개발 앱에서 Select 옵션, Escape 후 트리거 포커스, 검색 도메인 변경 시 프로젝트 초기화·비활성화, 검색 제출 확인.
- 자료 등록과 위키 편집의 390px 화면에서 가로 넘침 없음. 화면 실행 오류 0건.
- 공식 UI 구현 폴더를 제외한 화면 코드에 기본 입력·선택·체크박스 등의 직접 작성 태그가 남지 않았음을 확인했다.

화면: [로그인](./screenshots/shadcn-login.png), [자료 등록](./screenshots/shadcn-upload.png), [모바일 자료 등록](./screenshots/shadcn-upload-mobile.png), [모바일 위키 편집](./screenshots/shadcn-editor-mobile.png).

이후에도 같은 CLI 설치·공식 컴포넌트 사용 기준을 적용하도록 프로젝트 `AGENTS.md`에 기록했다.
