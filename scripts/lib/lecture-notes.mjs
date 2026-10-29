export function lectureNotes(week, slides) {
  const rows = week.blocks.map((block, i) => {
    const members = slides.filter((s) => s.block === i + 1);
    return `| ${i + 1}교시 | ${Number(members[0].id.slice(6))}–${Number(members.at(-1).id.slice(6))}장 | ${block.title} | ${block.mode === "development" ? "현재 화면 → 계획 → 확인 후 실행 → 직접 작업" : "현재 화면 → 활동 안내 → 직접 수행"} |`;
  });
  const notes = slides.map((slide, index) => {
    const block = week.blocks[slide.block - 1];
    const source = block?.slides.find((s) => s.title === slide.title);
    let core, opening, order, example, ending, transition;
    if (!block) {
      if (index === 0) {
        core = week.goal;
        opening =
          "오늘 끝났을 때 내 위키에서 무엇을 할 수 있을지 먼저 보겠습니다.";
        order = week.deliver.join(" → ");
        example = week.deliver[0];
        ending = "이 결과를 네 교시에 이어 만들겠습니다.";
        transition = "교육생이 오늘의 완성 모습을 자기 말로 설명하면 넘어간다.";
      } else if (index === 1) {
        core =
          "각 교시의 결과를 다음 교시에서 이어 쓰며 계획 확인과 직접 개발을 반복한다.";
        opening = "첫 기능을 만들면 그 결과가 다음 기능의 출발점이 됩니다.";
        order = week.blocks.map((b) => b.title).join(" → ");
        example = `첫 교시의 ‘${week.blocks[0].title}’에서 사용할 자료와 업무를 짚는다.`;
        ending =
          "계획을 확인한 뒤 실행하고, 직접 눌러 본 결과로 다음 작업을 정하겠습니다.";
        transition =
          "네 교시의 연결과 기본·선택 과제를 구분하면 준비 화면으로 넘어간다.";
      } else if (index === 2) {
        core = week.start;
        opening =
          "각자 작업하던 위키와 같은 프로젝트의 Claude Code를 열어 주세요.";
        order = "실행 환경 → 자료·계정 → 이전 결과 → 오늘 바꿀 곳";
        example = week.preparation?.record?.example || week.start;
        ending =
          "내 환경에서 기존 동작을 확인했으면 첫 작업의 계획을 세워 보겠습니다.";
        transition =
          "이전 결과와 실습 자료가 열리고 개발 대상 환경을 구분하면 시작한다.";
      } else {
        core =
          "직접 확인한 결과와 미확인 항목을 나누고 다음 개발에 이어 쓸 기록을 남긴다.";
        opening = "오늘 만든 위키로 처음 정한 업무를 다시 해 보세요.";
        order = "목표와 실제 결과 → 코드·DB 적용 → 남은 일과 다음 담당";
        example = week.deliver.join(" / ");
        ending = week.next;
        transition =
          "직접 확인·AI 검사·미확인을 구분하고 다음에 열 작업 카드가 남으면 마친다.";
      }
    } else if (source.phase === "plan") {
      core =
        "AI의 계획을 읽고 동작·저장·권한·확인 방법을 교육생이 판단한다. 이 단계에서는 구현하지 않는다.";
      opening =
        "아직 실행 요청을 보내지 마세요. 이 계획이 내가 원하는 사용 방식인지 먼저 보겠습니다.";
      order = source.checks.map((c) => `${c.title} ${c.body}`).join(" → ");
      example = block.slides.at(-1).decision;
      ending =
        "다른 점이 있으면 계획부터 고치세요. 내가 확인한 뒤 다음 장의 실행 요청을 보냅니다.";
      transition =
        "무엇을 바꾸고 어디에 저장하며 어떻게 확인할지 설명할 수 있을 때 실행 단계로 넘어간다.";
    } else if (
      source.phase === "implement" &&
      source.actionKind === "procedure"
    ) {
      core =
        "확인한 대상과 계획을 담당자가 실행할 절차로 정리한다. 이 요청 자체가 공용 배포를 실행하지는 않는다.";
      opening =
        "어느 환경에 어떤 순서로 반영할지 확인했으면 담당자가 따라갈 절차를 정리하겠습니다.";
      order = "대상·버전 → 코드·DB 적용 순서 → 중단·복구 기준 → 실제 확인 결과";
      example = block.slides.at(-1).decision;
      ending =
        "실제 반영은 담당 절차로 진행하고, 준비되지 않은 환경은 미반영으로 남깁니다.";
      transition =
        "담당·대상·실행 순서가 정리되고 준비 상태가 확인되면 합의된 반영과 직접 확인으로 넘어간다.";
    } else if (source.phase === "implement") {
      core =
        "확인한 계획에서 이번 단계만 구현한다. 계획에 없던 저장·권한 변경은 다시 확인한다.";
      opening =
        "확인한 계획과 지금 요청이 같은지 보고 이번 단계만 실행하겠습니다.";
      order = "내 결정 반영 → AI 구현·필요한 DB 적용 → 검사 결과 → 직접 확인";
      example = block.slides.at(-1).decision;
      ending = "AI의 완료 보고를 본 뒤 내 화면에서 실제로 눌러 보세요.";
      transition =
        "변경한 화면을 열 수 있고 실제로 확인할 입력과 기대 결과를 알면 직접 작업을 이어간다.";
    } else if (source.kind === "practice") {
      core = source.result;
      opening =
        "지금부터 각자의 위키에서 만들고 사용해 보세요. 막히면 계획과 실제 화면을 함께 보겠습니다.";
      order = source.steps.join(" → ");
      example =
        source.walkthroughs?.[0]?.steps?.[0] ||
        source.decision ||
        source.steps[0];
      ending =
        "기본 완료 기준을 확인한 분은 선택 과제의 계획을 세워 이어가세요.";
      transition =
        "기본 동작을 직접 수행하면 다음 기능으로 간다. 못한 부분은 숨기지 않고 같은 작업 카드에 남긴다.";
    } else if (source.kind === "input") {
      core =
        source.activityType === "record"
          ? "이 화면은 내 문서에 남길 기록 양식이며 개발 AI에 보낼 명령이 아니다."
          : source.activityType === "terminal"
            ? "실행 명령은 준비한 환경에서 한 줄씩 결과를 확인한다."
            : "위키 채팅의 답변은 원문과 적용 범위로 확인한다.";
      opening = `먼저 입력할 곳을 확인하겠습니다. ${source.where}입니다.`;
      order = "입력할 곳 → 이번 입력 → 실제 결과 → 근거 또는 다음 행동";
      example = source.result;
      ending = "안내한 곳에서 직접 수행하고 실제 결과를 확인해 주세요.";
      transition =
        "수행한 결과와 확인하지 못한 부분을 구분하면 직접 작업을 이어간다.";
    } else {
      core =
        source.lead ||
        source.callouts?.at(-1)?.body ||
        source.panels?.at(-1)?.items?.join(" ") ||
        block.title;
      opening =
        source.question ||
        source.callouts?.[1]?.body ||
        "현재 내 위키에서 이 작업을 어떻게 하는지 살펴볼까요?";
      order =
        source.features?.map((f) => `${f.title}: ${f.body}`).join(" → ") ||
        "현재 화면 → 불편한 조작 → 원하는 결과";
      example =
        source.example ||
        block.slides.at(-1).decision ||
        source.callouts?.[1]?.body ||
        block.title;
      ending =
        "이미 되는 부분은 유지하고, 이번에 더할 부분의 계획부터 확인하겠습니다.";
      transition =
        "현재 동작과 개발할 목표를 구분하고 교육생이 바꿀 이유를 설명하면 계획으로 넘어간다.";
    }
    return `### ${index + 1}장 · ${slide.title.replaceAll("\n", " ")}

- **꼭 전할 말:** ${core}
- **시작할 말:** “${opening}”
- **설명 순서:** ${order}
- **사례 하나:** ${example}
- **마무리할 말:** “${ending}”
- **전환 기준:** ${transition}
${block?.storage ? `- **저장·권한 코칭:** ${block.storage}\n` : ""}${source?.kind === "practice" && source.extensions?.length ? `- **시간이 남으면:** ${source.extensions.map((e) => `${e.title}: ${e.body}`).join(" / ")}\n` : ""}`;
  });
  return `# ${week.week}회차 강사용 설명 메모 — ${week.title}

교육생 공개 화면·워크북·다운로드에 포함하지 않습니다. 공통 원고와 생성기에서 함께 갱신합니다. 파일 반영 상태이며 사용자 확인과 교육생 실습 리허설 완료를 뜻하지 않습니다.

## 오늘의 연결

${week.start}

| 구간 | 장 | 할 일 | 설명·작업 순서 |
| --- | --- | --- | --- |
${rows.join("\n")}

마지막 ${slides.length}장은 직접 확인한 결과를 정리합니다. 교시마다 계획을 읽고 교육생이 결정한 뒤 구현합니다. 작은 기능의 계획 설명만으로 한 교시를 채우지 않습니다.

## 운영과 코칭

도입 5분, 교시별 50분, 휴식 세 번 각 10분, 마무리 5분으로 240분을 계획합니다. 각 교시의 직접 개발·사용 약 40분을 확보하려는 운영 기준이며 실측값은 아닙니다. 고정 시간을 교육생 화면에 표시하지 않습니다.

계획의 기술 용어를 읽는 대신 ‘원하는 동작인가 / 무엇을 누구의 기록으로 남길까 / 누가 볼 수 있을까 / 어떻게 확인할까’를 묻습니다. 코드 조사·구현·기술 검사는 AI가 맡고 교육생에게 코드 독해를 완료 조건으로 요구하지 않습니다.

기본을 마친 교육생은 같은 기능의 선택 과제를 계획하고 이어 만듭니다. 막히면 다음 기능에 필요한 최소 동작부터 함께 완성하되 미완료 항목을 완료로 표시하지 않습니다. 오류나 AI 대기 시간이 있어야 성립하는 실습으로 운영하지 않습니다.

각자 위키를 개발하고 배정된 역할별 계정으로 본인이 확인합니다. 동료의 사용을 실습 완료 조건으로 삼지 않습니다. 자료 공개·위키 게시의 별도 검토 담당과 제품의 권한 규칙은 유지합니다. 공용 환경 반영과 실제 운영 인수는 담당의 준비·확인 상태를 따로 기록합니다.

DB 구조 변경 파일, 실제 개발용 DB 적용, 화면의 저장·조회는 각각 확인합니다. 새로고침만으로 DB 저장을 증명하지 않습니다. 같은 서버 주소에 다른 브라우저로 로그인해 확인하고, 다른 사람의 개인 기록이 보이지 않는지도 확인합니다. 서로 다른 개인 서버의 DB는 자동으로 합쳐지지 않습니다.

## 장별 설명

${notes.join("\n")}

## 수업 전 리허설 기록

대표 과제를 별도 실습 환경에서 진행해 계획 판단·AI 구현·직접 확인·막힌 부분·선택 과제의 소요 시간을 기록합니다. 현재 자료 생성과 화면 검사는 기능 개발 리허설을 대신하지 않습니다. 원문 두 개·역할별 계정·개발용 DB·통합 환경 등 이 회차의 출발 조건부터 준비합니다.

다음 연결: ${week.next}
`;
}
