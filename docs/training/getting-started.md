# 도메인 위키 받기와 실행

[domain-wiki 저장소](https://github.com/jikime/domain-wiki)의 소스를 내려받아 로컬에서 실행합니다. **1주차 수업에서** [00. 기본 개발 환경 준비](environment-setup.md)로 Git·Node.js 22·Docker Desktop·Claude Code·디자인 하네스를 설치한 뒤 이어서 진행합니다. 아래 명령은 Windows의 Git Bash 또는 macOS Terminal에서 실행합니다.

**처음 설치하는 날의 안내입니다.** 이미 실행한 적이 있다면 [다음 날 다시 사용하는 방법](daily-use.md)을 봅니다. 명령은 일반 터미널에, 한국어 요청은 개발용 AI 대화창에 입력합니다. [입력 위치 안내](start-here.md#어디에-입력하나요)를 옆에 두면 편합니다.

## 1. 소스 받기

프로젝트를 둘 폴더에서 터미널을 열고 실행합니다.

```bash
git clone https://github.com/jikime/domain-wiki.git
cd domain-wiki
```

편집기에서 `domain-wiki` 폴더를 엽니다. 아래 명령도 이 폴더에서 실행합니다. 환경 준비를 진행 중이면 [Claude Code 첫 요청](environment-setup.md#7-위키-소스-받기와-claude-code-첫-요청)과 [디자인 하네스 설치](environment-setup.md#8-디자인-하네스-설치와-기존-기준-연결)를 마친 뒤 2절로 이어 갑니다.

**정상 결과 예시:** 편집기에서 `domain-wiki` 폴더를 열었을 때 `package.json`, `src`, `docs`가 보입니다. 이름이 같은 새 폴더를 계속 만들지 말고 T0에 이번 폴더의 실제 경로를 적습니다.

## 2. 처음 한 번 설정

Docker Desktop을 켠 뒤 다음 명령을 순서대로 실행합니다.

```bash
npm ci
npm run setup:local
npm run db:up
npm run db:migrate
npm run db:bootstrap
npm run db:content-team
```

필요한 패키지를 설치하고, 개인 설정 파일 `.env.local`과 교육용 DB·계정을 준비하는 과정입니다. DB는 Docker에서, 웹 서버와 문서 작업자는 Node.js에서 실행됩니다.

AI 기본 연결은 **Claude Code CLI·sonnet**입니다. 같은 PC 사용자·실습 터미널에서 `claude`로 로그인하고 `.env.local`의 `AI_TRANSPORT=claude-code`, `AI_MODEL=sonnet`을 확인합니다. 기존 설정 파일은 자동으로 덮어쓰지 않으므로 두 항목을 직접 확인합니다. 임베딩용 API와 다른 연결 방식은 [모델 연결 안내](../MODEL_TRANSPORTS.md)를 따릅니다. 키·인증 정보는 Git에 올리지 않습니다.

공통 실습은 Markdown 문서로 진행합니다. 구형 Office 등 추가 형식을 사용할 때 필요한 네이티브 변환기는 [문서 변환 안내](../ORIGINAL_IMPORTS_AND_PARSERS.md)를 참고합니다.

## 3. 앱 실행

첫 설정을 마쳤다면 일반 터미널 하나에서 실행할 수 있습니다. Docker Desktop이 켜져 있어야 합니다.

```bash
npm run dev:all
```

DB 준비가 끝난 뒤 웹 서버와 문서 작업자가 함께 실행됩니다. 준비 로그를 확인한 뒤 `http://localhost:3010`에 접속합니다. `Ctrl+C`를 누르면 함께 실행한 웹 서버·작업자를 종료하고 DB는 켜 둡니다. 한 프로그램이 실패하면 나머지도 정리하므로 오류를 확인한 뒤 다시 실행합니다.

‘필요한 패키지가 설치되지 않았습니다’라는 안내가 나오면 이 프로젝트 폴더에서 `npm ci`를 실행한 뒤 다시 시작합니다. 소스를 새로 받았거나 `node_modules` 폴더가 없는 경우에 필요한 준비이며, DB가 정상이어도 패키지가 없으면 서비스를 실행할 수 없습니다.

### 각각 실행할 때

두 프로그램의 역할을 살펴보거나 개별 로그를 확인하려면 기존 명령을 사용할 수 있습니다. `dev:all`과 동시에 실행하지 않습니다.

첫 번째 터미널에서 웹 서버를 실행합니다.

```bash
npm run dev
```

같은 프로젝트 폴더에 두 번째 터미널을 열고 문서 작업자를 실행합니다.

```bash
npm run worker
```

브라우저에서 [http://localhost:3010](http://localhost:3010)에 접속합니다. 로그인 정보는 `.local/initial-accounts.json`과 `.local/content-accounts.json`에서 확인합니다. 수업 중에는 두 터미널을 실행 상태로 둡니다.

다음에 다시 사용할 때는 DB가 켜져 있는지 확인하고 앱을 실행하면 됩니다. DB가 꺼져 있으면 `npm run db:up`으로 먼저 켭니다.

### 화면에서 실행 결과 확인하기

| 확인할 것 | 다음으로 넘어갈 수 있는 모습 |
| --- | --- |
| 웹 서버 | 표시된 접속 주소로 로그인 화면이 열림 |
| 계정·작업공간 | 교육용 계정으로 로그인하고 자신의 작업공간을 선택할 수 있음 |
| 작업자·자료 처리 | 1주차 실습 C에서 등록한 자료의 처리가 끝나고 추출한 내용이 보임 |
| 위키의 AI 연결 | 공개한 자료로 질문한 뒤 실제 답변과 근거를 확인함 |

터미널에 명령을 입력했다는 사실만으로 실행 완료를 표시하지 않습니다. 실패 문구가 보이면 다음 설정 명령을 계속 입력하기보다 [도움 요청](start-here.md#결과가-다르면-이렇게-도움을-요청하세요)으로 그 단계를 확인합니다.

## 4. 실습 시작

로그인 후 [1주차 실습](weeks/01-experience.md)에 따라 자료 등록·검토·검색을 진행합니다. 실습 파일은 `docs/training/samples`에 있으며, 이후 수업도 같은 프로젝트 폴더에서 이어 갑니다.
