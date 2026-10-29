# 화면 변경에 디자인 하네스 활용하기

첫 화면을 수정할 때 강사와 필요 여부를 정합니다. 기본 실행의 선행 조건은 아닙니다.


디자인 하네스는 **역할을 맡는 에이전트와 작업 절차를 담은 스킬의 묶음**입니다. 이번 교육에서는 `claude-harness-library`의 `design-system`을 사용합니다. 새 디자인을 처음부터 만드는 대신, 현재 위키의 [hince 적용 기준](../design/hince/DESIGN.md)을 AI가 읽고 작은 화면 변경에도 활용할 수 있도록 준비합니다.

### 실습 프로젝트에 설치

Claude Code를 `/exit`로 종료한 뒤 **일반 터미널**에서 진행합니다. 하네스 원본은 위키와 나란한 참고 폴더에 두고, 이 프로젝트의 `.claude`에 설치합니다. 이미 참고 저장소가 있으면 새로 clone하지 않고 강사와 사용할 버전을 확인합니다.

```bash
mkdir -p ~/Projects/references
git clone https://github.com/jikime/claude-harness-library.git ~/Projects/references/claude-harness-library
cd ~/Projects/references/claude-harness-library
git checkout 5eefe85e25fa7b98a8afa3d6e6233131b4826851
```

마지막 명령은 확인된 교육용 참고 버전으로 맞춥니다. `detached HEAD` 안내는 참고 버전을 고정해 읽는 상태라는 뜻입니다. 원본 하네스에서 직접 개발하는 실습은 하지 않습니다. [해당 버전의 design-system 구성](https://github.com/jikime/claude-harness-library/tree/5eefe85e25fa7b98a8afa3d6e6233131b4826851/design-system)

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
이 프로젝트의 CLAUDE.md에 아래 두 문서를 참조하도록 연결해 줘.
파일이 이미 있으면 기존 지침을 보존하고 누락된 참조만 추가해 줘.
참조는 코드 블록이나 백틱 안이 아닌 일반 본문에 넣어 줘.
다른 파일은 수정하지 마.

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
기록 입력 화면의 도움말을 바꿀 때 유지해야 할 디자인 규칙을 설명해 줘.
색상·글꼴·간격·입력 컴포넌트와 오류 표시를 확인해 줘.
지금은 계획 확인 단계야. 파일 수정·새 디자인 생성·외부 사이트 수집은 하지 마.
```

이 준비 단계의 완료 기준은 스킬·에이전트 인식과 **기존 기준에 근거한 설명**입니다. UI 변경과 화면 검증은 본 수업에서 진행합니다. 하네스가 추가 자료를 요구하면 저장소에 있는 기준으로 확인할 범위를 먼저 정하고, 없는 자료를 확인했다고 기록하지 않습니다.
