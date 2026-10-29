# 내 PC 환경 준비

자기 운영체제의 절차만 따라 하세요. 이미 설치된 도구는 버전을 확인하고 넘어갑니다. 설치와 실행은 강사의 도움을 받아 진행합니다. [입력 위치](start-here.md#어디에-입력하나요)를 먼저 확인하세요.

## 1. 무엇을 준비하나요

편집기·Git은 파일과 변경을 관리하고, Node.js 22는 위키를 실행합니다. Docker Desktop은 로컬 DB를, Claude Code는 코드 조사·수정을 맡습니다. 설치 권한과 회사 계정·사용 한도를 먼저 확인합니다.

설치가 막히면 강사가 준비한 개발 가능한 대체 환경으로 이어갑니다. 웹 화면만 볼 수 있는 계정으로 개발 환경을 대신하지 않습니다.

## 2. 터미널과 작업 위치 정하기

[VS Code](https://code.visualstudio.com/download)를 설치합니다. Windows는 Git 설치 후 VS Code의 **Terminal: Select Default Profile → Git Bash**를 선택합니다. macOS는 Terminal을 사용합니다.

Git 설치를 마치면 같은 터미널에서 작업 폴더를 준비합니다.

```bash
mkdir -p ~/Projects
cd ~/Projects
pwd
```

`~`는 내 사용자 폴더입니다. 출력된 경로를 기억하고 같은 프로젝트 폴더에서 작업합니다.

## 3. Git 설치

**Windows:** [Git for Windows](https://git-scm.com/install/windows)에서 PC에 맞는 설치 파일을 받아 Git Bash와 함께 설치합니다. 설치 후 새 Git Bash를 엽니다.

**macOS:** Terminal에서 Git이 없다고 나오면 아래 명령으로 Command Line Tools를 설치한 뒤 새 창을 엽니다.

```bash
xcode-select --install
```

**설치 확인:** 두 운영체제 모두 일반 터미널에서 실행합니다.

```bash
git --version
```

## 4. Node.js 22와 npm 설치

**Windows:** [Node.js 22 다운로드](https://nodejs.org/download/release/latest-v22.x/)에서 PC에 맞는 `x64.msi` 또는 `arm64.msi`를 받습니다. npm·PATH를 포함해 설치하고 Git Bash를 다시 엽니다.

**macOS:** Terminal의 `command -v nvm`에 결과가 없다면 아래 순서로 준비합니다. 이미 nvm이 있으면 설치를 생략합니다.

```bash
touch ~/.zshrc
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
```

위 명령은 nvm 설치 스크립트를 실행합니다. 새 Terminal을 열고 Node.js를 선택합니다.

```bash
nvm install 22
nvm use 22
```

**설치 확인:** 두 운영체제 모두 실행합니다. Node.js는 `v22.`로 시작하고 npm도 버전이 나와야 합니다.

```bash
node --version
npm --version
```

## 5. Docker Desktop과 Compose 준비

**Windows:** 관리자 PowerShell에서 `wsl --version`을 확인합니다. WSL이 없으면 다음 명령을 실행하고 안내에 따라 재부팅합니다.

```powershell
wsl --install --no-distribution
```

다시 관리자 PowerShell에서 확인합니다.

```powershell
wsl --update
wsl --version
```

[Docker Desktop Windows 안내](https://docs.docker.com/desktop/setup/install/windows-install/)에 따라 설치합니다. WSL2 백엔드와 Linux 컨테이너를 사용합니다. 별도의 Ubuntu 설치는 필요하지 않습니다. 회사 PC의 가상화·설치 제한은 담당자와 확인하세요.

**macOS:** [Docker Desktop Mac 안내](https://docs.docker.com/desktop/setup/install/mac-install/)에서 Apple Silicon 또는 Intel에 맞는 파일을 받아 설치합니다.

**실행 확인:** Docker Desktop을 켜고 준비가 끝나면 일반 터미널에서 실행합니다.

```bash
docker compose version
docker version
```

`docker version`에 Client와 Server가 모두 나와야 합니다. 여기서는 Docker 연결을 확인하며, 위키 DB는 첫 실행 절차에서 준비합니다.

## 6. 개발용 Claude Code 설치

**Windows Git Bash:** WinGet을 사용합니다. 설치 후 터미널을 다시 엽니다. WinGet이 없으면 앱 설치 관리자 상태를 강사와 확인합니다.

```bash
winget --version
winget install --id Anthropic.ClaudeCode -e
```

**macOS Terminal:** 설치 스크립트를 실행한 뒤 새 창을 엽니다.

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**설치 확인:**

```bash
claude --version
claude doctor
```

[Claude Code 설치 안내](https://code.claude.com/docs/en/setup)의 인증 절차를 따릅니다. 개발용 AI와 위키 서비스 AI의 실제 응답은 따로 확인합니다.

## 7. 위키 소스 받기와 Claude Code 첫 요청

[소스 받기](getting-started.md#1-소스-받기)를 따라 `domain-wiki` 폴더를 엽니다. 이미 받았다면 기존 폴더에서 이어갑니다.

```bash
cd ~/Projects/domain-wiki
claude
```

로그인 안내를 마친 뒤 Claude Code 대화창에 요청합니다.

```text
이 프로젝트의 AGENTS.md와 package.json을 읽어 줘.
웹·작업자·DB의 역할과 실행 순서를 쉬운 말로 설명해 줘.
지금은 수정·실행하지 말고 비밀 설정 값도 읽거나 출력하지 마.
```

실제 응답을 받으면 개발용 AI 준비가 끝납니다. 로그인 토큰과 비밀번호는 공유하지 않습니다.

## 8. 디자인 하네스 설치와 기존 기준 연결

[디자인 하네스 안내](design-harness.md)는 첫 화면 수정 때 필요하면 사용합니다. 기본 설치·실행을 모두 마친 뒤 강사와 연결합니다.

## 9. 위키 실행과 준비 완료 확인

[첫 실행](getting-started.md)의 명령을 순서대로 진행합니다. 계정 준비 뒤 [교육용 샘플 넣기](sample-data.md)를 마칩니다. 웹 화면·로그인·자료 처리·서비스 AI 응답을 각각 확인하고 미완료 항목은 [개발 노트](company-project.md)에 남깁니다.

## 10. 설치 중 막혔을 때

오류가 난 단계와 실제 문구를 강사에게 보여 주세요. 다음 명령으로 넘어가지 말고 [도움 요청 틀](start-here.md#결과가-다르면-이렇게-도움을-요청하세요)을 사용합니다. DB 인증 오류는 기존 설정부터 확인하며, 데이터가 있는 DB를 삭제하지 않습니다.
