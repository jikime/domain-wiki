# 00. 기본 개발 환경 준비

이 장은 **1주차 수업에서 강사와 함께 사용하는 설치·실행 교재**입니다. 도구 설치 → 개발용 AI 연결 → 디자인 하네스 준비 → 도메인 위키 실행까지 진행합니다. 1주차 4시간 안에 기본 도구 설치 100분과 내 PC 위키 실행 50분을 배정했습니다. ‘00’은 공통 안내의 읽는 순서이며, 수업 밖에서 설치를 끝내라는 뜻이 아닙니다. 실제 진행은 [1주차 시간표](weeks/01-experience.md#2-진행-시간표)를 따릅니다.

명령은 복사해 한 줄씩 실행하면 됩니다. 명령을 외우거나 코드를 직접 작성하는 능력을 평가하지 않습니다. Claude Code가 준비된 뒤의 설정과 진단은 AI·강사의 도움을 받아 진행하고, 교육생은 실행 위치와 결과를 확인합니다. 이미 준비된 도구는 확인만 하고 다음 단계로 넘어갑니다.

**처음 읽는 순서:** [입력 위치 안내](start-here.md#어디에-입력하나요)를 보고 자기 운영체제에 해당하는 단계만 따라갑니다. 다른 운영체제의 명령과 상세 설명은 참고로 두어도 됩니다. 설치가 막히면 해당 단계와 화면을 강사에게 보여 주세요.

## 설치 단계별로 다음에 넘어가도 되는지 확인하기

아래는 결과를 읽는 예시이며 실제 PC에서 실행한 기록은 아닙니다. 버전의 뒷자리와 폴더 이름은 PC마다 다를 수 있습니다.

| 확인할 단계 | 정상 결과의 예 또는 확인 방법 |
| --- | --- |
| 현재 폴더 `pwd` | `/Users/사용자이름/Projects` 또는 `/c/Users/사용자이름/Projects`처럼 위치가 표시됨. 소스를 받은 뒤에는 T0에 기록한 프로젝트 경로와 비교 |
| Git `git --version` | `git version` 뒤에 버전 숫자가 나옴 |
| Node.js `node --version` | `v22.`로 시작하는 버전이 나옴 |
| npm `npm --version` | 버전 숫자가 나옴. 명령을 찾을 수 없다는 오류는 나오지 않음 |
| Docker `docker version` | Client와 Server 항목이 모두 나옴. 설치 버전만 확인된 상태와 구분 |
| 개발용 AI | 프로젝트에서 Claude Code에 요청하고 실제 설명을 받음 |
| 위키 첫 실행 | 브라우저에서 로그인한 뒤 자료 한 건의 처리와 질문 결과를 확인 |

명령은 한 줄씩 실행합니다. 결과가 다르면 같은 설치 명령을 반복하기보다 [도움 요청 틀](start-here.md#결과가-다르면-이렇게-도움을-요청하세요)을 사용합니다. 자세한 설치 절차는 아래 순서를 따릅니다.

## 1. 무엇을 준비하나요

| 도구 | 이번 교육에서 쓰는 이유 | 준비 완료 기준 |
| --- | --- | --- |
| 편집기·터미널 | 프로젝트 파일을 열고 실행 결과를 확인 | 같은 프로젝트 폴더와 터미널 열기 |
| WSL2 · Windows | Docker Desktop이 Linux 컨테이너를 실행할 기반 | WSL 준비 후 Docker의 Client·Server 연결 확인 |
| Git | 실습 소스를 내려받고 변경 이력 보관 | 버전 확인, 저장소 다운로드 성공 |
| Git for Windows·Git Bash · Windows | Windows에서 Git과 Bash 명령을 쓰는 환경 | 시작 메뉴의 Git Bash 실행, Windows Git 버전 확인 |
| Node.js 22·npm | 위키의 웹 서버·작업자 실행, 필요한 패키지 설치 | Node.js 22와 npm 버전 확인 |
| Docker Desktop·Compose | PostgreSQL·pgvector를 같은 구성으로 실행 | Docker 서버 연결과 교육용 DB 실행 |
| Claude Code | 파일 조사·구현·검사를 맡는 개발용 AI | 로그인 후 프로젝트를 읽고 실제 응답 |
| 디자인 하네스 | AI가 디자인 기준을 따라 작업하도록 역할·절차 제공 | 프로젝트의 스킬·에이전트 인식, hince 기준 설명 |

회사 PC는 담당자와 설치 권한·가상화·외부 다운로드 가능 여부를 먼저 확인합니다. Claude Code를 사용할 개인 또는 회사 계정과 사용 한도도 준비합니다. GitHub 저장소가 비공개라면 읽기 권한이 필요하며, 공개 저장소를 받는 것만으로 GitHub 가입이나 업로드 설정을 요구하지 않습니다. Docker Desktop의 회사 이용 조건은 담당자가 [공식 설치 안내](https://docs.docker.com/desktop/setup/install/windows-install/)에서 확인합니다.

사전에 확인할 것은 장비·계정·설치 권한·네트워크입니다. 프로그램 설치와 로그인은 수업 안에서 진행합니다. 장비 제약으로 설치가 막히면 강사가 준비한 **개인별 원격 개발 환경**에서 실습을 이어갈 수 있습니다. 원격 대체 사용과 내 PC 설치 완료를 구분하고 실제 접속 주소·미완료 항목·지원 담당을 [T0 환경 기록표](templates.md#t0-내-pc-업무환경-기록표)에 남깁니다.

## 2. 터미널과 작업 위치 정하기

| 운영체제 | 설치·실습 위치 | 프로젝트를 둘 폴더 |
| --- | --- | --- |
| Windows · Git Bash | Windows용 도구 확인, Claude Code 설치·실행, 소스·하네스 준비와 위키 실습 | `~/Projects/domain-wiki` |
| Windows · 관리자 PowerShell | Docker용 WSL2 설치·업데이트가 필요할 때 | 프로젝트 작업에는 사용하지 않음 |
| macOS | Terminal 또는 편집기의 터미널 | `~/Projects/domain-wiki` |

Windows는 **Git for Windows·Node.js·Claude Code를 Windows에 설치하고 Git Bash에서 실습**합니다. Ubuntu는 설치하지 않습니다. Git Bash는 Windows에서 Bash 명령과 Windows 프로그램을 실행할 수 있게 해 줍니다. Docker Desktop에 사용하는 WSL2는 5절에서 준비하며, 실습용 Linux 배포판이나 사용자 계정을 만들 필요는 없습니다.

### 편집기와 프로젝트 폴더

[Visual Studio Code](https://code.visualstudio.com/download)를 설치합니다. Windows는 다음 3절에서 Git for Windows를 설치한 뒤 VS Code를 다시 열고, `Ctrl+Shift+P`의 명령 팔레트에서 **Terminal: Select Default Profile → Git Bash**를 선택합니다. 새 터미널을 열면 Git Bash를 사용할 수 있습니다. macOS는 일반 VS Code 창과 Terminal을 사용합니다. [VS Code 터미널 선택 안내](https://code.visualstudio.com/docs/terminal/profiles)

Git 설치를 마친 뒤 **Windows Git Bash 또는 macOS Terminal**에서 실습 폴더를 마련합니다.

```bash
mkdir -p ~/Projects
cd ~/Projects
pwd
```

`~`는 현재 사용자의 홈 폴더입니다. Windows Git Bash에서는 보통 `/c/Users/사용자이름/Projects`, macOS에서는 `/Users/사용자이름/Projects` 형태로 표시됩니다. Git Bash의 `/c/Users/...`는 Windows 탐색기의 `C:\Users\...`와 같은 위치입니다. 실제 `pwd` 결과를 기록하고, 직접 입력하는 경로에 공백이 있으면 큰따옴표로 감쌉니다.

## 3. Git 설치

Windows는 **Git for Windows에 포함된 Git과 Git Bash**를 준비합니다. 이후 소스 다운로드·하네스 설치·위키 실행을 같은 Git Bash에서 이어 갑니다. macOS는 아래 macOS 절차를 사용합니다. [Git for Windows의 Git Bash 안내](https://gitforwindows.org/)

### Windows · Git for Windows와 Git Bash 설치

1. **Windows 브라우저**에서 [Git for Windows 공식 설치 페이지](https://git-scm.com/install/windows)를 엽니다.
2. PC에 맞는 x64 또는 ARM64 설치 파일을 받아 실행합니다. 회사의 지정 설정이 없으면 기본 선택으로 진행합니다. Git Bash가 함께 설치됩니다.
3. 설치를 마치면 시작 메뉴에서 **Git Bash**를 찾아 엽니다. 기존 창이 있었다면 닫고 새로 엽니다.
4. **Git Bash 창**에서 아래 명령을 실행합니다.

```bash
git --version
pwd
```

Git 버전과 현재 폴더가 나오면 설치를 확인한 것입니다. T0에 결과를 적고 2절의 프로젝트 폴더와 VS Code 터미널을 준비합니다. 이후 실습에도 **Git Bash**를 사용합니다.


### macOS · Command Line Tools로 설치

macOS는 Git Bash를 별도로 설치하지 않습니다. Terminal에서 `git --version`을 확인하고, Git이 없거나 개발 도구 설치 안내가 나오면 아래 명령으로 설치 창을 마칩니다.

```bash
xcode-select --install
```

설치가 끝난 뒤 새 Terminal에서 `git --version`을 확인합니다. 이미 Command Line Tools나 Homebrew의 Git이 정상 동작하면 다시 설치하지 않습니다. [Git macOS 설치 안내](https://git-scm.com/install/mac)

Git은 변경 이력을 다루는 도구이고 GitHub는 저장소를 제공하는 서비스입니다. 지금은 설치·다운로드까지만 준비합니다. 이후 변경 보관은 AI에게 요청하며, 커밋 작성자 설정이 필요하면 **이 실습 프로젝트 안에서만** 본인 이름·이메일을 설정하도록 요청합니다.

## 4. Node.js 22와 npm 설치

Node.js는 프로그램 실행 도구이고 npm은 프로젝트가 필요로 하는 패키지를 설치하는 도구입니다. 이 교육은 [프로젝트 실행 기준](../../README.md)에 맞춰 **Node.js 22 계열**을 사용합니다. Windows는 공식 설치 파일, macOS는 nvm으로 준비합니다. 이미 같은 환경에서 Node.js 22와 npm이 동작하면 버전만 확인하고 넘어갑니다.

### Windows · 공식 설치 파일로 준비

1. [Node.js 22 계열 공식 다운로드 목록](https://nodejs.org/download/release/latest-v22.x/)에서 PC에 맞는 `x64.msi` 또는 `arm64.msi` 파일을 받습니다. 파일명의 버전이 `v22.`로 시작하는지 확인합니다.
2. 설치 파일을 실행하고 npm과 PATH 추가 항목을 포함한 기본 구성으로 설치합니다. 이미 버전 관리 도구를 사용한다면 강사와 그 도구로 22를 선택합니다.
3. Git Bash와 VS Code를 닫고 다시 엽니다. **새 Git Bash**에서 아래를 확인합니다.

```bash
node --version
npm --version
```

Node.js가 `v22.`로 시작하고 npm 버전도 나오면 됩니다. npm은 Node.js에 포함됩니다. 설치 경로가 새 터미널에 반영되도록 창을 다시 여는 것입니다.

### macOS · nvm으로 준비

**macOS Terminal**에서 `command -v nvm`을 실행합니다. `nvm`이 출력되면 아래 설치 명령을 건너뜁니다. 없으면 기본 zsh의 설정 파일을 `touch ~/.zshrc`로 마련한 뒤 설치합니다.

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
```

nvm 공식 저장소의 설치 프로그램을 받아 실행하는 명령입니다. 설치 후 Terminal을 완전히 닫고 새로 엽니다. 이 절의 nvm은 macOS용 안내입니다. 설치 버전은 2026년 9월 14일 공식 안내와 대조했습니다. [nvm 설치·버전 선택 안내](https://github.com/nvm-sh/nvm#installing-and-updating)

```bash
nvm --version
nvm install 22
nvm use 22
node --version
npm --version
```

`nvm install 22`는 실행 시점의 22 계열 최신 패치를 설치합니다. 새 Terminal에서 다른 버전이 선택되면 `nvm use 22`로 맞춥니다.

두 운영체제 모두 실제 설치된 세부 버전을 T0에 기록하고, 웹 서버용·작업자용 터미널에서 Node.js 22를 확인합니다. 이 프로젝트는 `package-lock.json`과 npm을 사용하므로 참고 워크북의 pnpm·Corepack 설치는 추가하지 않습니다.

## 5. Docker Desktop과 Compose 준비

Docker는 필요한 프로그램과 실행 환경을 컨테이너로 묶어 실행하는 도구입니다. 이 프로젝트의 기본 로컬 실습은 **DB만 Docker**, **웹 서버와 작업자는 Node.js**로 실행합니다. PostgreSQL·pgvector를 PC에 따로 설치하지 않아도 됩니다. 구성의 역할은 [웹 서버·작업자·DB 안내](project-guide.md#실행-명령과-세-가지-구성)에서 확인할 수 있습니다.

### Windows · Docker용 WSL2와 Desktop 설치

이 교재는 Docker Desktop의 **WSL2 백엔드**를 사용합니다. Docker는 Windows에서 사용할 때 Ubuntu 같은 사용자 배포판을 요구하지 않습니다. [Docker의 WSL2 안내](https://docs.docker.com/desktop/features/wsl/)

1. 시작 메뉴에서 PowerShell을 **관리자 권한으로 실행**하고 `wsl --version`으로 상태를 확인합니다. WSL이 준비되지 않았다면 아래 명령을 실행합니다.

```powershell
wsl --install --no-distribution
```

`--no-distribution`은 Ubuntu 등 Linux 배포판을 함께 설치하지 않는 옵션입니다. 설치 안내에 따라 재부팅한 뒤 관리자 PowerShell에서 아래를 확인합니다. 이미 WSL이 있으면 새 설치를 생략하고 업데이트·버전을 확인합니다. [Microsoft WSL 명령 안내](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)

```powershell
wsl --update
wsl --version
```

2. [Docker Desktop Windows 설치 페이지](https://docs.docker.com/desktop/setup/install/windows-install/)에서 장비에 맞는 설치 파일을 받아 설치합니다. WSL 버전은 Docker가 요구하는 2.1.5 이상인지 확인합니다.
3. Docker Desktop을 열고 **General → Use WSL 2 based engine**을 사용합니다. 이미 적용된 환경에서는 선택 항목이 보이지 않을 수 있습니다. PostgreSQL·pgvector를 실행하도록 Linux 컨테이너 모드를 사용합니다.
4. Desktop의 시작이 끝나면 **새 Git Bash**에서 다음 ‘명령과 서버 연결 확인’을 진행합니다. Ubuntu 설치나 WSL Integration의 Ubuntu 연결은 필요하지 않습니다. Docker 내부 실행 환경은 Desktop이 관리합니다.

### macOS · Desktop 설치

1. Mac의 **이 Mac에 관하여**에서 Apple Silicon인지 Intel인지 확인합니다.
2. [Docker Desktop Mac 설치 페이지](https://docs.docker.com/desktop/setup/install/mac-install/)에서 해당 칩용 설치 파일을 받습니다.
3. `.dmg`를 열어 Docker를 Applications로 옮기고 앱을 실행합니다. 최초 설정 안내를 마친 뒤 실행 준비가 끝날 때까지 기다립니다.

### 명령과 서버 연결 확인

**Windows Git Bash 또는 macOS Terminal**에서 실행합니다.

```bash
docker --version
docker compose version
docker version
```

앞의 두 명령은 설치된 명령 도구를 확인합니다. 마지막 `docker version`에서 **Client와 Server 정보가 모두** 나와야 Docker 서버에 연결된 것입니다. Server 오류가 나오면 Desktop 실행 상태와 Windows의 WSL2 백엔드부터 확인합니다. 버전 출력만으로 위키 DB 준비까지 끝난 것은 아니며, 실제 DB는 9절에서 실행합니다. [Docker 버전 확인 안내](https://docs.docker.com/reference/cli/docker/version/)

## 6. 개발용 Claude Code 설치

이 장에서 준비하는 Claude Code는 **교육생이 코드 작업을 요청할 개발용 AI**입니다. 위키의 채팅·문서 생성도 기본적으로 **Claude Code CLI·sonnet**을 사용합니다. 같은 PC 사용자 계정의 인증을 사용할 수 있지만, 위키의 연결 설정과 실제 응답은 별도로 확인합니다. 임베딩은 별도의 API 연결입니다.

### Windows · Git Bash에서 설치

**Git Bash**에서 Windows 패키지 설치 도구인 WinGet을 사용합니다. PowerShell로 창을 바꿀 필요 없이 이 창에서 설치를 진행할 수 있습니다.

```bash
winget --version
winget install --id Anthropic.ClaudeCode -e
```

설치 안내를 마치면 Git Bash와 VS Code를 닫고 다시 엽니다. WinGet을 찾지 못하면 Microsoft Store의 **앱 설치 관리자(App Installer)** 설치·업데이트 상태를 강사와 확인합니다. [Microsoft WinGet 안내](https://learn.microsoft.com/en-us/windows/package-manager/winget/)

이 명령은 Claude Code 공식 문서의 Windows 설치 방법입니다. 업데이트할 때는 Git Bash에서 `winget upgrade --id Anthropic.ClaudeCode -e`를 사용합니다. [Claude Code 공식 설치·업데이트 안내](https://code.claude.com/docs/en/setup)

### macOS · Terminal에서 설치

**macOS Terminal**에서 공식 네이티브 설치 프로그램을 실행합니다.

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

설치 안내를 마치고 새 Terminal을 엽니다. 이 셸 설치 스크립트는 macOS·Linux용이므로 Windows Git Bash에서는 위의 WinGet 명령을 사용합니다.

### 같은 실습 터미널에서 확인

Windows는 **Git Bash**, macOS는 **Terminal**에서 확인합니다.

```bash
claude --version
claude doctor
```

`claude --version`은 버전, `claude doctor`는 설치·설정 상태를 확인합니다. 이후 Claude Code 실행·로그인·하네스 작업도 같은 실습 터미널에서 이어 갑니다. 앞의 Node.js는 **도메인 위키 실행**을 위해 준비했으며, 이 방식의 Claude Code 설치에 필요한 도구는 아닙니다.

로그인에는 Claude Code를 사용할 수 있는 계정이 필요합니다. 강사가 안내한 Pro·Max 또는 회사 Team·Enterprise·Console 등의 인증 방식을 사용합니다. 실제 로그인과 첫 응답은 다음 절에서 확인합니다. [Claude Code 인증 안내](https://code.claude.com/docs/en/authentication)

## 7. 위키 소스 받기와 Claude Code 첫 요청

1. Windows Git Bash 또는 macOS Terminal에서 `cd ~/Projects`를 실행합니다.
2. [도메인 위키 소스 받기](getting-started.md#1-소스-받기)의 두 명령으로 저장소를 내려받고 `domain-wiki` 폴더로 이동합니다. 이미 내려받았다면 기존 실습 폴더를 사용합니다.
3. 편집기에서 이 폴더를 엽니다. Windows는 일반 VS Code 창에서 Windows의 프로젝트 폴더를 열고 Git Bash 터미널을 사용합니다.
4. **같은 프로젝트 폴더의 터미널**에서 Claude Code를 시작합니다.

```bash
cd ~/Projects/domain-wiki
claude
```

첫 실행의 폴더 확인과 로그인 안내를 읽고, 수업에 사용할 계정으로 인증합니다. 브라우저가 자동으로 열리지 않으면 화면에 표시된 로그인 URL을 PC의 브라우저에서 열고 안내를 이어 갑니다. 인증 코드가 표시되면 해당 터미널의 요청 위치에 입력합니다. [첫 실행·로그인 안내](https://code.claude.com/docs/en/quickstart)

Claude Code 입력창에서 [세 줄 프롬프트 연습](prompt-practice.md#2-처음에는-세-줄로-시작하기)에 따라 궁금한 대상을 골라 요청문을 작성·전송합니다. 첫 결과를 읽고 예시나 비교를 추가하는 후속 요청도 한 번 실행합니다. 아래 완성 예시는 자신의 초안을 쓴 뒤 비교할 참고이며, 터미널 명령이 아니라 **AI에게 보낼 문장**입니다.

```text
이 폴더가 domain-wiki 실습 프로젝트인지 확인해 주세요.
AGENTS.md, package.json, docs/design/hince/DESIGN.md를 읽고,
웹 서버·작업자·DB가 각각 무엇을 하는지 쉬운 말로 설명해 주세요.
지금은 파일 수정이나 서버 실행을 하지 마세요.
.env.local과 계정 파일의 비밀 값은 읽거나 출력하지 마세요.
```

실제 프로젝트에 근거한 설명이 나오면 개발용 AI의 첫 연결을 확인한 것입니다. T3에 첫 요청·후속 요청·실제 결과를 남기고 T0의 연결 확인과 함께 기록합니다. 설치 버전 확인과 실제 AI 응답 확인을 구분합니다. 로그인 토큰·API 키·계정 비밀번호는 교재나 채팅에 붙여 넣지 않습니다.

## 8. 디자인 하네스 설치와 기존 기준 연결

디자인 하네스는 **역할을 맡는 에이전트와 작업 절차를 담은 스킬의 묶음**입니다. 이번 교육에서는 `claude-harness-library`의 `design-system`을 사용합니다. 새 디자인을 처음부터 만드는 대신, 현재 위키의 [hince 적용 기준](../design/hince/DESIGN.md)을 AI가 읽고 작은 화면 변경에도 활용할 수 있도록 준비합니다.

### 실습 프로젝트에 설치

Claude Code를 `/exit`로 종료한 뒤 **일반 터미널**에서 진행합니다. 하네스 원본은 위키와 나란한 참고 폴더에 두고, 이 프로젝트의 `.claude`에 설치합니다. 이미 참고 저장소가 있으면 새로 clone하지 않고 강사와 사용할 버전을 확인합니다.

```bash
mkdir -p ~/Projects/references
git clone https://github.com/jikime/claude-harness-library.git ~/Projects/references/claude-harness-library
cd ~/Projects/references/claude-harness-library
git checkout 5eefe85e25fa7b98a8afa3d6e6233131b4826851
```

마지막 명령은 2026년 9월 14일 확인한 교육용 참고 버전으로 맞춥니다. `detached HEAD` 안내는 참고 버전을 고정해 읽는 상태라는 뜻입니다. 원본 하네스에서 직접 개발하는 실습은 하지 않습니다. [해당 버전의 design-system 구성](https://github.com/jikime/claude-harness-library/tree/5eefe85e25fa7b98a8afa3d6e6233131b4826851/design-system)

```bash
cd ~/Projects/domain-wiki
mkdir -p .claude/agents .claude/skills
cp -R -n ../references/claude-harness-library/design-system/agents/. .claude/agents/
cp -R -n ../references/claude-harness-library/design-system/skills/. .claude/skills/
```

`-n`은 같은 이름의 기존 파일을 덮어쓰지 않도록 합니다. 이미 하네스를 설치한 사본은 복사가 생략될 수 있으므로, 강사·AI가 기존 버전과 차이를 확인합니다. 전역 설정이나 기존 `.claude` 폴더 전체를 교체하지 않습니다. 프로젝트별 설치 위치는 [Claude Code 스킬 안내](https://code.claude.com/docs/en/skills)와 [에이전트 안내](https://code.claude.com/docs/en/sub-agents)를 따릅니다.

Windows에서는 참고 pi-workbook과 같이 **Git Bash의 위키 프로젝트 폴더**에서 위 복사 명령을 실행합니다. 이후 같은 폴더에서 Claude Code를 시작해야 프로젝트에 설치한 하네스를 읽을 수 있습니다.

### 프로젝트 지침 연결

프로젝트에서 `claude`를 다시 실행하고 아래와 같이 요청합니다.

```text
이 프로젝트의 CLAUDE.md에 아래 두 문서를 참조하도록 연결해 주세요.
파일이 이미 있으면 기존 지침을 보존하고 누락된 참조만 추가해 주세요.
참조는 코드 블록이나 백틱 안이 아닌 일반 본문에 넣어 주세요.
다른 파일은 수정하지 마세요.

@AGENTS.md
@docs/design/hince/DESIGN.md
```

`CLAUDE.md`는 Claude Code가 프로젝트 지침을 읽는 파일이고, `@경로`는 다른 지침 문서를 불러오는 표기입니다. 강사 컴퓨터의 절대 경로 대신 **저장소 안의 문서**를 연결합니다. 교육생은 AI가 보고한 변경 내용을 확인하고, Claude Code를 종료한 뒤 같은 프로젝트에서 다시 시작합니다. [프로젝트 지침과 문서 참조 안내](https://code.claude.com/docs/en/memory)

### 인식과 첫 활용 확인

1. Claude Code 입력창에서 `/`를 입력해 `design-system-orchestrator` 스킬이 보이는지 확인합니다.
2. `/agents`에서 `design-analyzer`, `design-system-applier`, `design-system-reviewer` 등 설치한 역할이 보이는지 확인합니다. 고정한 참고 버전에는 에이전트 5개와 스킬 6개가 있습니다.
3. 다음 문장으로 기존 디자인 기준을 읽어 설명하는지 확인합니다.

```text
/design-system-orchestrator
이 프로젝트의 docs/design/hince/DESIGN.md와 AGENTS.md를 기준으로,
기록 입력 화면의 도움말을 바꿀 때 유지해야 할 디자인 규칙을 설명해 주세요.
색상·글꼴·간격·입력 컴포넌트와 오류 표시를 확인해 주세요.
지금은 계획 확인 단계입니다. 파일 수정·새 디자인 생성·외부 사이트 수집은 하지 마세요.
```

이 준비 단계의 완료 기준은 스킬·에이전트 인식과 **기존 기준에 근거한 설명**입니다. UI 변경과 화면 검증은 본 수업에서 진행합니다. 하네스가 추가 자료를 요구하면 저장소에 있는 기준으로 확인할 범위를 먼저 정하고, 없는 자료를 확인했다고 기록하지 않습니다.

## 9. 위키 실행과 준비 완료 확인

Docker Desktop을 켜 둔 상태에서 [처음 한 번 설정](getting-started.md#2-처음-한-번-설정)과 [앱 실행](getting-started.md#3-앱-실행)을 순서대로 진행합니다. 개발용 AI가 준비되었으므로, 같은 안내를 읽고 필요한 설정·실행을 도와 달라고 요청해도 됩니다. 서비스 AI의 기본 설정인 `AI_TRANSPORT=claude-code`, `AI_MODEL=sonnet`과 같은 사용자의 CLI 인증을 확인합니다. 임베딩 API와 교육용 계정은 강사의 안내를 사용합니다.

웹 서버와 작업자는 같은 `domain-wiki` 폴더의 서로 다른 터미널에서 실행합니다. Windows는 둘 다 Git Bash를 사용합니다. 브라우저는 Windows 또는 macOS에서 `http://localhost:3010`을 엽니다. 웹·작업자·DB를 켜고 끄는 역할은 [실행 구성 안내](project-guide.md#실행-명령과-세-가지-구성)를 함께 봅니다.

| 확인할 것 | 완료 기준 |
| --- | --- |
| Windows Docker용 WSL2 | WSL 버전과 Desktop의 WSL2 백엔드 실행 확인 |
| Windows Git for Windows·Git Bash | 시작 메뉴에서 Git Bash를 열고 Git 버전·현재 폴더 확인 |
| Git·Node.js·npm | 실습 터미널에서 Git·Node.js 22·npm 버전 출력 |
| Docker·Compose | 명령 버전과 Docker의 Client·Server 정보 출력 |
| 소스·편집기 | 같은 `domain-wiki`의 package.json·src·docs/training 확인 |
| 개발용 Claude Code | 로그인 후 실제 프로젝트를 읽고 응답 |
| 디자인 하네스 | 스킬·에이전트 인식과 hince 기준 설명 |
| 프로젝트 지침 | CLAUDE.md에서 저장소의 AGENTS.md·hince 문서 참조 |
| DB·계정·웹 화면 | 최초 설정 완료 후 localhost:3010에서 교육 계정 로그인 |
| 문서 작업자 | 강사와 교육용 Markdown 한 건의 처리 완료 확인 |
| 서비스 AI | 사용할 연결로 실제 응답 확인, 실패 시 미확인으로 기록 |

설치·인증·실제 실행 중 어디까지 확인했는지 T0에 기록합니다. 수업 중 [1주차 업무 흐름 실습](weeks/01-experience.md#6-실습-c--자료-한-건으로-업무-흐름-확인하기)으로 이어 가고, 마지막 40분에 실제 결과와 다시 사용하는 순서를 정리합니다. 미확인 항목은 강사·AI와 확인하며 장비 문제로 원격 환경을 사용한 경우에도 내 PC 설치 상태를 따로 기록합니다.

## 10. 설치 중 막혔을 때

| 증상 | 먼저 확인할 것 | 다음 조치 |
| --- | --- | --- |
| WSL 설치·가상화 오류 | 관리자 PowerShell, 재부팅, 장비의 가상화 지원 | 강사·회사 담당자와 장비 설정 확인 |
| Git Bash가 없거나 그 안에서 Git 명령을 못 찾음 | Git for Windows 설치·새 Git Bash 창 | 설치 결과를 확인하고 시작 메뉴에서 다시 실행 |
| Git Bash에서 Node·Claude 명령을 못 찾음 | Windows 설치 완료, 새 Git Bash·VS Code, PATH | 설치 안내의 실제 실행 경로를 확인하고 새 창에서 재확인 |
| Git Bash에서 winget을 못 찾음 | Windows 앱 설치 관리자 설치·업데이트 상태 | 강사와 Microsoft 공식 WinGet 안내로 준비 |
| macOS에서 nvm 설치 후 명령을 못 찾음 | 새 Terminal을 열었는지 | 강사·AI가 셸 설정의 nvm 로딩 확인 |
| Node.js 버전이 22가 아님 | 설치 버전·실제 실행 경로 | Windows는 22 설치·기존 버전 관리 도구 확인, macOS nvm은 `nvm use 22` |
| Claude가 Bash를 못 찾음 | Git for Windows 설치 위치 | 강사·AI가 공식 안내의 `CLAUDE_CODE_GIT_BASH_PATH`를 실제 bash.exe 경로에 맞춤 |
| Claude 로그인은 됐지만 응답 실패 | 사용 계정·한도·네트워크 | 인증 담당자와 연결 확인, 실제 응답 전에는 완료 표시 보류 |
| Docker Server 연결 실패 | Desktop 실행·WSL2 백엔드 | 연결 후 `docker version` 재확인 |
| 하네스 스킬·에이전트가 안 보임 | 현재 프로젝트의 `.claude/skills`·`.claude/agents`, 재시작 | 중첩 폴더·SKILL.md·기존 버전과의 충돌 확인 |
| 화면은 열리지만 문서가 처리되지 않음 | 작업자 터미널과 같은 DB 설정 | [문서 처리 진단](troubleshooting.md#3-진단-예-b--문서가-처리-대기에서-멈춤)으로 확인 |

Claude Code가 동작하면 다음처럼 요청합니다. AI도 실행되지 않으면 같은 정보를 강사에게 전달합니다.

```text
환경 준비 중 아래 단계에서 막혔습니다.
운영체제와 터미널: [예: Windows 11 / Git Bash]
현재 폴더: [pwd 결과]
실행한 명령: [명령]
오류: [키·토큰·비밀번호를 가린 오류 문구]

설치 위치와 현재 상태를 확인할 방법부터 안내해 주세요.
기존 프로젝트·DB·설정을 지우지 말고 한 단계씩 해결해 주세요.
```

DB가 준비된 뒤 중지가 필요하면 프로젝트의 `npm run db:stop`을 사용합니다. 데이터를 지우는 `docker compose down -v`는 일반적인 오류 해결 절차로 사용하지 않습니다. 실행 후의 문제는 [실습 중 문제 해결](troubleshooting.md)로 이어서 확인합니다.

## 참고 자료와 적용 범위

Pie Chat의 `00_환경설정.md`에서 WSL2·Docker 설치와 완료 점검 흐름을, 같은 pi-workbook의 Pie Form 사전 준비에서 Git·Node.js·Claude Code 안내를 참고했습니다. `/setup/manual`의 Git for Windows·Git Bash 설치와 `/setup/oneshot`의 Windows용 Git 항목도 확인했습니다. 디자인 하네스는 `/setup/harness-library` 설치 안내와 위에 연결한 실제 하네스 저장소를 대조했습니다.

도메인 위키에 맞춰 Node.js 22·npm, Windows의 Git Bash 실습 경로와 Docker용 WSL2, DB만 Docker로 실행하는 구성, 기존 hince 기준 활용으로 조정했습니다. 이 문서의 공식 설치 안내와 하네스 구성은 2026년 9월 14일에 확인했으며, 실제 교육생 장비의 설치·인증·실행 결과는 [준비표](preparation.md)에서 별도로 확인합니다.
