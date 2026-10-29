import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { workbookPages } from "../src/lib/workbook.ts";
import { lectureNotes } from "./lib/lecture-notes.mjs";

const root = new URL("../", import.meta.url);
const course = JSON.parse(
  await readFile(new URL("docs/lectures/course.json", root), "utf8"),
);
const [css, js, art] = await Promise.all([
  readFile(new URL("src/styles/lectures.css", root), "utf8"),
  readFile(new URL("scripts/lib/lecture-navigation.js", root), "utf8"),
  readFile(new URL("public/lectures/assets/knowledge-library.png", root)),
]);
const timing = course.timing;
if (
  course.weeks.length !== 7 ||
  4 * (timing.brief + timing.work + timing.review) +
    3 * timing.break +
    timing.closing !==
    240
)
  throw new Error("Invalid coaching course schedule");
const output = new URL("public/lectures/", root);
const pages = new Map(workbookPages.map((page) => [page.slug, page]));
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const title = (v) => esc(v).replace(/\n/g, "<br>");
const pad = (n) => String(n).padStart(2, "0");
const iconPaths = {
  book: '<path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2z"/>',
  file: '<path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  check: '<path d="m5 12 4 4L20 5M20 12v8H3V3h11"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-2-15-4 18"/>',
  people:
    '<circle cx="9" cy="7" r="3"/><path d="M2 21v-4c0-5 14-5 14 0v4M17 4c4 0 4 6 0 6m2 4c3 0 3 4 3 7"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7zm-10 10 10 5 10-5M2 17l10 5 10-5"/>',
};
const icons = ["book", "layers", "file", "search", "code", "check", "people"];
const icon = (name = "book", size = 32) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.book}</svg>`;
const artUrl = `data:image/png;base64,${art.toString("base64")}`;
const captureAssets = new Map();
for (const asset of new Set(
  course.weeks.flatMap((w) => [
    ...(w.opening ? [w.opening.example.asset] : []),
    ...(w.preparation ? [w.preparation.wiki.asset] : []),
    ...w.blocks.flatMap((b) =>
      b.slides.filter((s) => s.kind === "capture").map((s) => s.asset),
    ),
  ]),
)) {
  if (!/^[a-z-]+\.png$/.test(asset))
    throw new Error(`Invalid capture: ${asset}`);
  const bytes = await readFile(
    new URL(`public/lectures/assets/screens/${asset}`, root),
  );
  captureAssets.set(asset, `data:image/png;base64,${bytes.toString("base64")}`);
}
const illustration = (className = "") =>
  `<figure class="hero-art ${className}"><img src="${artUrl}" alt="흩어진 자료가 열린 책과 연결된 지식 서가로 모이는 종이 조형 일러스트" width="1536" height="1024"><figcaption>흩어진 자료에서 함께 쓰는 지식으로</figcaption></figure>`;
function cover(week) {
  const opening = week.opening;
  if (!opening)
    return `<div class="cover-grid"><div class="cover-copy"><div class="cover-tag">${icon(icons[week.week - 1], 24)} ${course.customer} · 실습 강의</div><p class="cover-number">${pad(week.week)}<span>/ 07</span></p><h1>${esc(week.title)}</h1><p class="cover-goal">${esc(week.goal)}</p><div class="cover-bottom">계획을 확인하고 · 직접 개발하고 · 회사에 적용합니다</div></div>${illustration()}</div>`;
  if (
    opening.heading.replace(/\s+/g, " ") !== week.title ||
    !opening.message ||
    ![3, 4].includes(opening.steps.length) ||
    !captureAssets.has(opening.example.asset)
  )
    throw new Error(`Invalid opening: ${week.week}`);
  const example = opening.example;
  const source = captureAssets.get(example.asset);
  const preview = example.dashboard
    ? `<div class="opening-dashboard"><p class="opening-dashboard-search">${esc(example.dashboard.searchLabel)}</p><h2>${esc(example.dashboard.title)}</h2><p class="opening-dashboard-summary">${esc(example.dashboard.summary)}</p><ul>${example.dashboard.items.map((item) => `<li><strong>${esc(item.title)}</strong><span>${esc(item.meta)}</span></li>`).join("")}</ul></div>`
    : example.choices
      ? `<div class="opening-choice-preview"><p class="shortcut-eyebrow">${esc(example.targetLabel)}</p><ol class="opening-choices">${example.choices.map((choice) => `<li><h2>${esc(choice.title)}</h2><p>${esc(choice.example)}</p><p class="opening-choice-action">${esc(choice.action)}</p></li>`).join("")}</ol></div>`
      : `<div class="shortcut-preview"><span class="shortcut-eyebrow">${esc(example.targetLabel)}</span><strong class="shortcut-label">${esc(example.after)} <span aria-hidden="true">↗</span></strong><span class="shortcut-connector">${esc(example.constraint)} <span aria-hidden="true">↓</span></span><div class="shortcut-result">${icon("search", 24)}<strong>${esc(example.destination)}</strong></div></div>`;
  return `<div class="opening-layout"><div class="opening-stage">
    <header class="opening-header"><p class="opening-tag">${pad(week.week)} / 07 <span>${esc(course.customer)} · 회사 위키 개발</span></p><h1>${title(opening.heading)}</h1><p class="opening-message">${esc(opening.message)}</p></header>
    <div class="opening-comparison">
      <figure class="opening-panel"><figcaption><strong>현재 화면</strong><span>${esc(example.location)}</span></figcaption><div class="opening-card-visual"><img src="${source}" width="706" height="382" alt="개선 전 스타터킷 홈의 ‘${esc(example.before)}’ 카드"></div><p class="opening-panel-note">${esc(example.question)}</p></figure>
      <span class="opening-change-arrow" aria-hidden="true">→</span>
      <figure class="opening-panel opening-target"><figcaption><strong>이번에 만들 화면 · 예시</strong><span>앞으로 만들 모습입니다</span></figcaption>
        ${preview}
        <p class="opening-panel-note">${esc(example.check)}</p>
      </figure>
    </div>
    <ol class="opening-steps${opening.steps.length === 4 ? " opening-steps-four" : ""}" aria-label="오늘 할 일의 순서">${opening.steps.map((step, i) => `<li><div class="opening-step-heading"><span class="opening-step-number">${opening.steps.length === 4 ? `${i + 1}교시` : pad(i + 1)}</span><h2>${esc(step.title)}</h2>${i < opening.steps.length - 1 ? '<span class="opening-arrow" aria-hidden="true">→</span>' : ""}</div><p>${esc(step.body)}</p></li>`).join("")}</ol>
  </div></div>`;
}
function agenda(week) {
  const plan = week.agenda;
  if (!plan)
    return `<h2>오늘, 위키를 여기까지 만듭니다.</h2><div class="agenda">${week.blocks.map((b, i) => `<article><span class="agenda-number">${pad(i + 1)}</span><div><p class="micro">${i + 1}교시</p><h3>${esc(b.title)}</h3></div></article>`).join("")}</div><p class="note">계획을 확인한 뒤 직접 만들고 검증합니다. 강사는 판단과 개발을 코칭합니다. 작업 상황에 맞춰 설명과 실습을 이어갑니다.</p><div class="learning-path"><span>실제 화면 보기</span><b>→</b><span>계획 확인·수정</span><b>→</b><span>확인 후 구현</span><b>→</b><span>확인·이어 만들기</span></div>`;
  if (
    !plan.title ||
    plan.steps.length !== week.blocks.length ||
    plan.practice.length !== 3
  )
    throw new Error(`Invalid agenda: ${week.week}`);
  return `<div class="plan-layout"><div class="plan-stage"><header class="plan-header"><p class="plan-tag">${pad(week.week)} / 07 <span>오늘의 작업 순서</span></p><h2>${title(plan.title)}</h2><p class="plan-message">${esc(plan.message)}</p></header><ol class="plan-path" aria-label="네 교시의 작업 순서">${plan.steps.map((step, i) => `<li><div class="plan-period"><span>${pad(i + 1)}</span><span>교시</span></div><h3>${title(step.title)}</h3><p class="plan-description">${esc(step.body)}</p><div class="plan-output"><span>남길 것</span><strong>${esc(step.output)}</strong></div></li>`).join("")}</ol><section class="plan-options" aria-label="내 진행에 맞게 이어가기">${plan.practice.map((item) => `<div><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p></div>`).join("")}</section></div></div>`;
}
function workbook(slug, label, anchor) {
  if (!pages.has(slug)) throw new Error(`Unknown workbook: ${slug}`);
  const href = `/workbook/${slug}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
  return `<a href="${href}" data-workbook="${href}" target="_blank" rel="noopener">${esc(label || pages.get(slug).title)} <span aria-hidden="true">↗</span></a>`;
}
function preparation(week) {
  const prep = week.preparation;
  if (!prep.title || !captureAssets.has(prep.wiki.asset) || !prep.warmup?.text)
    throw new Error(`Invalid preparation: ${week.week}`);
  return `<div class="prepare-layout"><div class="prepare-stage"><header class="prepare-header"><p class="prepare-tag">${pad(week.week)} / 07 <span>${esc(prep.tag || "작은 성공부터 시작하기")}</span></p><h2>${title(prep.title)}</h2><p>${esc(prep.message)}</p></header><div class="prepare-desk"><section class="prepare-wiki"><div class="prepare-label"><span>01</span><h3>내 위키</h3></div><p class="prepare-action">${esc(prep.wiki.action)}</p><figure><button type="button" class="prepare-capture" data-capture aria-label="홈 화면 예시 크게 보기"><img src="${captureAssets.get(prep.wiki.asset)}" alt="${esc(prep.wiki.alt)}"><span class="prepare-expand js-only">크게 보기 ↗</span></button><figcaption>실제 스타터킷 · 가상 교육 자료 · 개선 전 홈</figcaption></figure><p class="prepare-detail">${esc(prep.wiki.check)}</p></section><div class="prepare-tools"><section class="prepare-ai"><div class="prepare-label"><span>02</span><h3>개발용 AI</h3></div><p class="prepare-action">${esc(prep.ai.action)}</p><pre id="prepare-warmup" class="prepare-prompt copy-source">${esc(prep.warmup.text)}</pre><div class="prepare-copy js-only"><button type="button" class="copy" data-copy="prepare-warmup" data-copy-message="복사했습니다. 한 번에 입력하세요.">전체 요청문 복사</button><span class="status" role="status"></span></div><p class="prepare-tool-note">${esc(prep.ai.hint)}</p></section><section class="prepare-record"><div class="prepare-label"><span>03</span><h3>${esc(prep.record.action)}</h3></div><blockquote><p>${esc(prep.record.example)}</p></blockquote><p class="prepare-tool-note">${esc(prep.record.hint)}</p></section></div></div><footer class="prepare-ready"><div><span>준비가 되면</span><strong>${esc(prep.ready)}</strong></div><nav aria-label="실습 준비 워크북">${workbook("week-02", "시작 실습과 개발 순서")}${workbook("company-project", "작업 카드 양식")}</nav></footer></div></div>`;
}
const refs = (slugs = []) =>
  `<nav class="refs" aria-label="자세히 볼 워크북"><span>워크북</span>${[...new Set(slugs)].map((slug) => workbook(slug)).join("")}</nav>`;
const note = (text) =>
  text
    ? `<p class="note">${icon("check", 20)}<span>${esc(text)}</span></p>`
    : "";
const items = (values, cls = "plain-list") =>
  `<ul class="${cls}">${values.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>`;
const header = `<a class="skip" href="#main">본문으로 건너뛰기</a><header class="topbar"><a class="brand" href="index.html">${icon("book", 22)}<span>도메인 위키 <em>강의실</em></span></a><nav aria-label="자료 이동">${workbook("company-project", "회사 개발 노트")}<a href="domain-wiki-lectures.zip" download>전체 내려받기 ↓</a></nav></header>`;
const shell = (name, body, className = "") =>
  `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="엠큐닉 · 교육생과 함께 보고 실습하는 도메인 위키 강의"><title>${esc(name)}</title><style>${css}</style></head><body class="${className}" data-title="${esc(name)}">${header}${body}<script>${js}</script></body></html>\n`;
const kinds = {
  concept: "이해하기",
  flow: "흐름 살펴보기",
  compare: "비교해 보기",
  screen: "화면 읽기",
  capture: "실제 화면에서 찾기",
  document: "완성 예시",
  table: "기준 살펴보기",
  input: "함께 입력하기",
  practice: "직접 해 보기",
  check: "생각 나누기",
};
function periodContext(period, label) {
  return `<div class="period-context"><p class="focus-tag">${period ? `${period}교시` : "완성 확인"} <span>${esc(label)}</span></p></div>`;
}
function content(s, id, period = 1, periodStart = false) {
  if (s.layout === "bundle") {
    if (
      s.features.length !== 3 ||
      !s.target ||
      (!s.asset && s.currentFlow?.length !== 3)
    )
      throw new Error(`Incomplete feature bundle: ${s.title}`);
    const current = s.asset
      ? `<figure class="bundle-current"><figcaption><strong>현재 화면</strong><span>${esc(s.route)}</span></figcaption><button class="bundle-capture" type="button" data-capture aria-label="${esc(s.route)} 실제 화면 크게 보기"><img src="${captureAssets.get(s.asset)}" alt="${esc(s.alt)}"><span class="js-only">크게 보기 ↗</span></button><p>${esc(s.current)}</p><small>실제 스타터킷 · 가상 자료 · 개선 전 캡처</small></figure>`
      : `<section class="bundle-current"><div class="bundle-caption"><strong>${esc(s.currentLabel || "현재 연결")}</strong><span>${esc(s.currentBasis || "코드에서 확인한 흐름")}</span></div><ol class="bundle-current-flow">${s.currentFlow.map((step, i) => `<li><span>${pad(i + 1)}</span><div><h3>${esc(step.title)}</h3><p>${esc(step.body)}</p></div></li>`).join("")}</ol><p>${esc(s.current)}</p><small>${esc(s.currentNote || "브라우저 뒤로 가기와 화면 안의 목록 링크는 다릅니다.")}</small></section>`;
    return `<div class="iteration-layout bundle-layout"><div class="bundle-stage"><header class="focus-header">${periodContext(period, "이번에 이어 만들 기능")}<h2>${title(s.title)}</h2><p>${esc(s.lead)}</p></header><div class="bundle-grid">${current}<section class="bundle-target"><div class="bundle-caption"><strong>이번에 만들 화면 · 예시</strong><span>앞으로 만들 모습입니다</span></div><p class="bundle-target-title">${esc(s.target)}</p><ol>${s.features.map((feature, i) => `<li><span>${pad(i + 1)}</span><div><h3>${esc(feature.title)}</h3><p>${esc(feature.body)}</p></div></li>`).join("")}</ol></section></div><div class="bundle-question"><h3>${esc(s.question)}</h3><p>${esc(s.example)}</p></div><footer class="focus-footer"><p>${esc(s.footer || "첫 동작을 만들고, 다음 두 기능을 이어 개발합니다.")}</p>${refs(s.refs)}</footer></div></div>`;
  }
  if (s.kind === "compare" && s.layout === "verification") {
    if (s.observations.length !== 3 || !s.exampleLabel || !s.followUp.body)
      throw new Error(`Invalid verification slide: ${s.title}`);
    return `<div class="iteration-layout"><div class="iteration-stage"><header class="focus-header">${periodContext(period, s.stageTag, periodStart)}<h2>${title(s.title)}</h2><p>${esc(s.lead)}</p></header><section class="verification-example" aria-label="직접 확인하고 보완할 곳을 정하는 예시"><p class="verification-caption">${esc(s.exampleLabel)}</p><ol class="verification-observations">${s.observations.map((item, i) => `<li><div><span aria-hidden="true">${pad(i + 1)}</span><h3>${esc(item.title)}</h3></div><p>${esc(item.body)}</p></li>`).join("")}</ol><div class="verification-next"><span>${esc(s.followUp.label)}</span><strong>${esc(s.followUp.body)}</strong></div></section><div class="focus-discussion"><div><h3>${esc(s.question)}</h3><p>${esc(s.action)}</p></div></div><footer class="focus-footer"><p>${esc(s.note)}</p>${refs(s.refs)}</footer></div></div>`;
  }
  if (s.kind === "compare" && s.layout === "iteration") {
    if (
      s.branches.length !== 2 ||
      !s.example.before ||
      !s.example.after ||
      !s.example.check
    )
      throw new Error(`Invalid iteration slide: ${s.title}`);
    return `<div class="iteration-layout"><div class="iteration-stage"><header class="focus-header">${periodContext(period, "직접 확인한 결과에서 이어가기", periodStart)}<h2>${title(s.title)}</h2><p>${esc(s.lead)}</p></header><div class="iteration-grid"><section class="iteration-branches" aria-label="내 결과에 맞게 선택하기">${s.branches.map((b) => `<article><span class="iteration-label">${esc(b.label)}</span><h3>${esc(b.title)}</h3><p>${esc(b.body)}</p></article>`).join("")}</section><section class="iteration-example" aria-label="다음 개선의 예시"><p class="iteration-label">${esc(s.example.label)}</p><h3>${esc(s.example.observation)}</h3><dl><div><dt>현재 설명</dt><dd>${esc(s.example.before)}</dd></div><div><dt>바꿀 설명 후보</dt><dd>${esc(s.example.after)}</dd></div></dl><p class="iteration-keep">${esc(s.example.keep)}</p><p class="iteration-check"><strong>확인할 것</strong>${esc(s.example.check)}</p></section></div><div class="focus-discussion"><div><h3>${esc(s.question)}</h3><p>${esc(s.action)}</p></div></div><footer class="focus-footer"><p>${esc(s.note)}</p>${refs(s.refs)}</footer></div></div>`;
  }
  if (s.kind === "practice" && s.layout === "lab") {
    if (
      s.steps.length !== 3 ||
      s.stepTitles.length !== s.steps.length ||
      s.stepLocations.length !== s.steps.length ||
      s.doneChecks.length !== 3 ||
      s.recordFields.length !== 3
    )
      throw new Error(`Invalid lab slide: ${s.title}`);
    const requestId = `slide-${pad(Number(id.slice(6)) - 1)}`;
    const extra = s.extensions
      ? `<section class="lab-record lab-extensions"><h3>기본을 마쳤다면 · 선택 과제</h3><ul>${s.extensions.map((item) => `<li><strong>${esc(item.title)}</strong><span>${esc(item.body)}</span></li>`).join("")}</ul></section>`
      : `<section class="lab-record"><h3>${esc(s.recordHeading || "내 기록 문서에 남길 것")}</h3><ul>${s.recordFields.map((field) => `<li>${esc(field)}</li>`).join("")}</ul><p>${esc(s.recordExample)}</p></section>`;
    const nextId = `slide-${pad(Number(id.slice(6)) + 1)}`;
    return `<div class="lab-layout"><div class="lab-stage"><header class="lab-header"><div><p class="lab-tag">${period}교시 <span>${esc(s.stageTag || "이제 내 프로젝트에서")}</span></p><h2>${title(s.title)}</h2><p class="lab-lead">${esc(s.lead)}</p></div></header><ol class="lab-steps" aria-label="직접 작업 순서">${s.steps.map((step, i) => `<li><span class="lab-number">${pad(i + 1)}</span><span class="lab-step-location">${esc(s.stepLocations[i])}</span><h3>${esc(s.stepTitles[i])}</h3><p>${esc(step)}</p></li>`).join("")}</ol><div class="lab-outcomes">${extra}<section class="lab-done"><h3>${esc(s.doneHeading || "이름 변경 예시의 확인 기준")}</h3><ul>${s.doneChecks.map((check) => `<li>${esc(check)}</li>`).join("")}</ul><small>${esc(s.scope)}</small></section></div><footer class="lab-footer"><p>${esc(s.note)}</p><nav aria-label="실습 참고 자료"><a href="#${requestId}">요청문 다시 보기 ↗</a>${workbook(s.refs[0], s.workbookAnchor ? "실습 순서·다음 요청" : "실습 순서", s.workbookAnchor)}${workbook(s.refs[1], "작업 카드")}<a href="#${nextId}">${esc(s.nextLabel || "다음 작업 고르기 →")}</a></nav></footer></div></div>`;
  }
  if (s.kind === "input" && s.layout === "request") {
    if (!s.text.trim() || s.checks.length !== 3)
      throw new Error(`Invalid request: ${s.title}`);
    const prompt = esc(s.text);
    const flow = s.flow || ["내 작업으로 바꾸기", "입력", "화면 확인"];
    return `<div class="request-layout"><div class="request-stage" data-phase="${esc(s.phase || "implement")}"><header class="request-header"><p class="request-tag">${period}교시 <span>${esc(s.stageTag || "작은 변경부터 요청하기")}</span></p><h2>${title(s.title)}</h2><p class="request-lead">${esc(s.lead)}</p></header><div class="request-grid"><section class="request-panel" aria-label="복사해서 쓸 요청 예시"><div class="request-location"><span>입력할 곳</span><strong>${esc(s.where)}</strong></div><pre id="${id}-input" class="request-source copy-source">${prompt}</pre><div class="request-copy js-only"><button type="button" class="copy" data-copy="${id}-input" data-copy-message="${s.phase === "plan" ? "계획 요청을 복사했습니다. 답변을 확인한 뒤 실행 요청으로 넘어가세요." : "실행 요청을 복사했습니다. 계획을 확인한 경우에만 보내세요."}">${s.phase === "plan" ? "계획 요청 복사" : "실행 요청 복사"}</button><span class="status" role="status"></span></div></section><aside class="request-review"><h3>${esc(s.reviewHeading || "내가 정할 것")}</h3><ol>${s.checks.map((check, i) => `<li><span aria-hidden="true">${pad(i + 1)}</span><div><h4>${esc(check.title)}</h4><p>${esc(check.body)}</p></div></li>`).join("")}</ol><div class="request-adapt"><strong>예시를 내 작업으로</strong><p>${esc(s.adapt)}</p></div></aside></div><footer class="request-footer"><p>${flow.map(esc).join(' <span aria-hidden="true">→</span> ')}</p>${s.alternative ? `<nav class="refs" aria-label="선택한 기능의 요청 예시">${workbook(s.refs[0], "A·B 요청 보기", s.workbookAnchor)}${workbook(s.refs[1], "회사 개발 노트")}</nav>` : refs(s.refs)}</footer></div></div>`;
  }
  if (s.kind === "capture" && s.layout === "focus") {
    if (
      !captureAssets.has(s.asset) ||
      s.callouts.length !== 3 ||
      s.callouts.some(
        (c) =>
          !Number.isFinite(c.markerTop) || c.markerTop < 0 || c.markerTop > 100,
      )
    )
      throw new Error(`Invalid focused capture: ${s.title}`);
    return `<div class="focus-layout"><div class="focus-stage"><header class="focus-header">${periodContext(period, "실제 화면에서 바꿀 곳 찾기", periodStart)}<h2>${title(s.title)}</h2><p>${esc(s.lead)}</p></header><div class="focus-grid"><figure class="focus-figure"><figcaption><strong>현재 화면</strong><span>${esc(s.route)}</span></figcaption><div class="focus-visual"><div class="focus-image"><button type="button" class="focus-capture" data-capture aria-label="${esc(s.route)} 실제 화면 크게 보기"><img src="${captureAssets.get(s.asset)}" alt="${esc(s.alt)}" width="706" height="382"><span class="focus-expand js-only">크게 보기 ↗</span></button>${s.callouts.map((c, i) => `<span class="focus-pin" style="top:${c.markerTop}%" aria-hidden="true">${i + 1}</span>`).join("")}</div></div><p class="focus-caption">실제 스타터킷 · 가상 교육 자료 · 개선 전 화면</p></figure><section class="focus-map" aria-label="내 업무에 맞게 바꿀 곳 고르기"><p class="focus-map-label">화면에서 짚고 <span aria-hidden="true">→</span> 내 업무로 생각하기</p><ol>${s.callouts.map((c, i) => `<li><span class="focus-number" aria-hidden="true">${i + 1}</span><div><h3>${esc(c.title)}</h3><p class="focus-value">${esc(c.body)}</p><p class="focus-detail">${esc(c.detail)}</p></div></li>`).join("")}</ol></section></div><div class="focus-discussion focus-discussion-example"><div><h3>${esc(s.question)}</h3><p>${esc(s.discussion)}</p></div><blockquote class="focus-decision"><span>예시 · 내 말로 정리하기</span><p>${esc(s.discussionExample)}</p></blockquote></div><footer class="focus-footer"><p>${esc(s.next)}</p>${refs(s.refs)}</footer></div></div>`;
  }
  const heading = `${periodStart ? periodContext(period, kinds[s.kind], true) : ""}<h2>${title(s.title)}</h2>`;
  const lead = s.lead ? `<p class="lead">${esc(s.lead)}</p>` : "";
  let body;
  switch (s.kind) {
    case "capture":
      body = `${heading}<div class="capture-grid"><figure class="capture-figure"><div class="capture-location">${icon("search", 18)}${esc(s.route)}</div><button type="button" class="capture-open" data-capture aria-label="${esc(s.route)} 실제 화면 크게 보기"><img src="${captureAssets.get(s.asset)}" alt="${esc(s.alt)}"><span class="capture-expand js-only">화면 크게 보기 ↗</span></button><figcaption>실제 스타터킷 · 가상 교육 자료 · 개선 전 화면</figcaption></figure><aside class="capture-notes">${s.callouts.map((c, i) => `<article><span class="micro">${pad(i + 1)} · ${esc(c.title)}</span><p>${esc(c.body)}</p></article>`).join("")}</aside></div>`;
      break;
    case "concept":
    case "flow":
      body = `${heading}${lead}<div class="${s.kind === "flow" ? "flow" : "concept-grid"}">${s.nodes.map((n, i) => `<article class="concept-node"><span class="node-index">${pad(i + 1)}</span><div class="node-icon">${icon(s.kind === "flow" ? ["file", "layers", "check"][i % 3] : ["book", "search", "people"][i % 3])}</div><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p></article>`).join("")}</div>`;
      break;
    case "compare":
      body = `${heading}<div class="compare-grid">${s.panels.map((p, i) => `<article class="compare-panel ${i ? "accent" : ""}"><p class="micro">${esc(p.label)}</p><h3>${esc(p.title)}</h3>${items(p.items)}</article>`).join("")}</div>`;
      break;
    case "screen":
      body = `${heading}<div class="screen-grid"><figure class="screen-guide"><figcaption>${s.planned ? "목표 화면 도식 · 이번에 개발할 동작을 보여 줍니다" : "화면 구조 예시 · 실제 화면의 주요 항목을 간추렸습니다"}</figcaption><div class="screen-bar">${icon("book", 20)} 우리 업무 위키 <span>교육용 예제</span></div><div class="route">${s.route.map((r) => `<span>${esc(r)}</span>`).join('<b aria-hidden="true">›</b>')}</div><dl>${s.fields.map((f, i) => `<div><dt><span class="marker">${i + 1}</span>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join("")}</dl></figure><aside class="annotations">${s.callouts.map((c, i) => `<article><span class="marker">${c.field || i + 1}</span><div><h3>${esc(c.title)}</h3><p>${esc(c.body)}</p></div></article>`).join("")}</aside></div>`;
      break;
    case "document":
      body = `${heading}<article class="document-example"><div class="document-label">${icon("file", 22)} ${esc(s.label)}</div>${
        s.text.includes("\n\n")
          ? `<div class="document-sections">${s.text
              .split("\n\n")
              .map((part) => {
                const [head, ...lines] = part.split("\n");
                return `<section><h3>${esc(head)}</h3><p>${esc(lines.join("\n"))}</p></section>`;
              })
              .join("")}</div>`
          : `<pre>${esc(s.text)}</pre>`
      }</article>`;
      break;
    case "table":
      body = `${heading}<div class="table-wrap"><table><thead><tr>${s.headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${s.rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
      break;
    case "input": {
      const terminal = /일반 터미널|macOS Terminal/.test(s.where);
      const browser = s.where.startsWith("브라우저");
      body = `${heading}<div class="input-grid"><div class="input-panel ${terminal ? "terminal" : ""}"><div class="input-label">${icon(terminal ? "code" : "file", 20)} ${esc(s.where)}</div><pre id="${id}-input" class="copy-source">${esc(s.text)}</pre><div class="copy-row"><button type="button" class="copy js-only" data-copy="${id}-input">${browser ? "주소 복사" : terminal ? "명령 복사" : "내용 복사"}</button><span class="status" role="status"></span></div></div><aside class="result-note"><span class="micro">${s.activityType === "record" ? "기록 후 확인할 것" : "입력 후 확인할 것"}</span>${icon("check", 36)}<p>${esc(s.result)}</p></aside></div>`;
      break;
    }
    case "practice":
      body = `<div class="practice-heading"><span class="practice-symbol">${icon("code", 42)}</span><div><p class="micro">${s.practicePhase === "continue" ? `실습 계속 · ${Number(id.slice(6)) - 1}장에서 이어서` : "직접 만들기 · 강사 코칭"}</p>${heading}</div></div><div class="location">입력할 곳 <strong>${esc(s.where)}</strong></div><div class="practice-grid"><ol class="practice-steps">${s.steps.map((v, i) => `<li><span>${pad(i + 1)}</span><p>${esc(v)}</p></li>`).join("")}</ol><aside class="practice-result"><span class="micro">여기까지 되면 됩니다</span>${icon("check", 40)}<p>${esc(s.result)}</p></aside></div>`;
      break;
    case "check":
      body = `<div class="check-grid"><article><p class="micro">잠깐, 생각해 볼까요?</p>${heading}<p class="question">${esc(s.question)}</p><details class="answer"><summary>판단과 이유 보기 <span aria-hidden="true">＋</span></summary><p>${esc(s.answer)}</p></details></article><aside class="evidence"><span class="micro">내 결과 확인</span>${items(s.proof, "evidence-list")}<p class="small">확인하지 못한 항목은 표시해 두고, 막힌 화면과 함께 질문해 주세요.</p></aside></div>`;
      break;
    default:
      throw new Error(`Unknown slide kind: ${s.kind}`);
  }
  return `${body}${note(s.note)}${refs(s.refs)}`;
}
await mkdir(output, { recursive: true });
const files = new Map();
const manifests = [];
for (const week of course.weeks) {
  const weekTiming = week.timing || timing;
  if (
    (weekTiming.opening || 0) +
      4 * (weekTiming.brief + weekTiming.work + weekTiming.review) +
      3 * weekTiming.break +
      weekTiming.closing !==
    240
  )
    throw new Error(`Invalid weekly coaching schedule: ${week.week}`);
  if (week.blocks.length !== 4)
    throw new Error(`${week.week}: four lesson blocks required`);
  for (const block of week.blocks) {
    if (
      block.slides.filter((s) => s.kind === "input").length !==
        (block.mode === "development" ? 2 : 1) ||
      block.slides.filter((s) => s.kind === "practice").length !== 1
    )
      throw new Error("Development needs separate plan and execution requests");
    const requests = block.slides.filter((s) => s.kind === "input");
    const request = requests.at(-1);
    const practice = block.slides.find((s) => s.kind === "practice");
    if (
      block.mode === "development" &&
      (requests[0].phase !== "plan" ||
        request.phase !== "implement" ||
        !requests[0].text.includes("아직 바꾸지 마") ||
        block.slides.indexOf(requests[0]) + 1 !==
          block.slides.indexOf(request) ||
        block.slides.indexOf(practice) !== block.slides.indexOf(request) + 1)
    )
      throw new Error(
        `Practice must continue from its request slide: ${block.title}`,
      );
    if (requests.some((r) => !r.where?.trim() || !r.text?.trim()))
      throw new Error(`Incomplete request: ${block.title}`);
    for (const followup of practice.followups || []) {
      if (
        !followup.plan?.includes("아직 바꾸지 마") ||
        !followup.review?.length ||
        !followup.text?.trim()
      )
        throw new Error(
          `Follow-up needs a plan, learner review and execution: ${followup.title}`,
        );
    }
  }
  const slides = [];
  const add = (name, body, kind, block = 0, layout) => {
    const id = `slide-${pad(slides.length + 1)}`;
    const stage =
      (kind === "cover" && week.opening) ||
      kind === "plan" ||
      kind === "preparation" ||
      layout === "focus" ||
      layout === "request" ||
      layout === "lab" ||
      layout === "bundle" ||
      layout === "iteration" ||
      layout === "verification";
    slides.push({
      id,
      title: name,
      kind,
      block,
      html: `<section class="slide slide-${kind}${kind === "cover" && week.opening ? " slide-opening" : ""}${stage ? " slide-stage" : ""}" id="${id}" tabindex="-1" data-title="${esc(name.replace(/\n/g, " "))}" data-block="${block}"><div class="slide-meta"><span>${pad(week.week)}회차 · ${esc(week.title)}</span><span>${block ? `${block}교시 / ` : ""}${esc(kinds[kind] || "함께 만드는 회사 위키")}</span></div><div class="slide-content">${typeof body === "function" ? body(id) : body}</div></section>`,
    });
  };
  add(week.title, cover(week), "cover");
  add(
    week.agenda?.title || "오늘 이어 만들 네 가지",
    agenda(week),
    week.agenda ? "plan" : "agenda",
  );
  if (week.preparation) {
    add(week.preparation.title, preparation(week), "preparation");
  } else {
    add(
      "지난 결과에서 이어 만들기",
      (id) =>
        content(
          {
            kind: "compare",
            title: "같은 위키를 이어서 개발합니다.",
            panels: [
              {
                label: "시작할 상태",
                title: "이전 결과 열기",
                items: [week.start],
              },
              {
                label: "오늘 남길 결과",
                title: "위키에 쌓을 변화",
                items: week.deliver,
              },
            ],
            note: week.next,
            refs: [`week-${pad(week.week)}`, "company-project"],
          },
          id,
        ),
      "compare",
    );
  }
  week.blocks.forEach((b, i) => {
    b.slides.forEach((s, index) => {
      add(
        s.title,
        (id) => content(s, id, i + 1, index === 0),
        s.kind,
        i + 1,
        s.layout,
      );
    });
  });
  const outcomes = week.deliver;
  if (week.closing) {
    add(
      week.closing.title,
      (id) => content(week.closing, id, 0),
      "compare",
      0,
      week.closing.layout,
    );
  } else {
    add(
      "오늘 만든 것을 이어 갑니다.",
      `<div class="closing-grid"><div><p class="micro">오늘의 결과</p><h2>오늘의 변경을 보관하고<br>다음 개발로 이어 갑니다.</h2>${items(outcomes, "closing-list")}</div><aside class="closing-aside">${icon(icons[week.week - 1], 56)}<p>${esc(week.next)}</p><div class="refs">${workbook("company-project", "개발 노트에 결과 남기기")}${week.week < 7 ? `<a href="week-${pad(week.week + 1)}.html">다음 강의 →</a>` : `<a href="index.html">전체 강의 목록 →</a>`}</div></aside></div>`,
      "closing",
    );
  }
  const starts = week.blocks.map((b, i) => ({
    title: b.title,
    id: slides.find((s) => s.block === i + 1).id,
  }));
  const chapters = `<nav class="chapters js-only" aria-label="교시 이동">${starts.map((b, i) => `<a data-chapter="${i + 1}" href="#${b.id}"><span>${pad(i + 1)}</span>${esc(b.title)}</a>`).join("")}</nav>`;
  const toc = `<nav id="toc" class="toc" aria-label="슬라이드 목차" hidden><ol>${slides.map((s) => `<li><a href="#${s.id}"><span>${s.block ? `${s.block}교시` : "안내"}</span>${esc(s.title.replace(/\n/g, " "))}</a></li>`).join("")}</ol></nav>`;
  const controls = `<footer class="controls js-only"><div class="actions"><button type="button" data-previous aria-label="이전 슬라이드">←</button><span class="counter" data-counter aria-live="polite"></span><button type="button" data-next aria-label="다음 슬라이드">→</button></div><div class="actions"><button type="button" data-toc aria-controls="toc" aria-expanded="false">목차</button><button type="button" data-all aria-pressed="false">전체 보기</button><button type="button" data-fullscreen>전체 화면</button><button type="button" data-print>인쇄 · PDF</button></div><span class="status" role="status" data-status></span><div class="progress" aria-hidden="true"><span data-progress></span></div></footer>`;
  const captureDialog = `<dialog class="capture-dialog" aria-label="실제 화면 확대"><div class="capture-dialog-bar"><span>실제 스타터킷 · 개선 전 화면</span><button type="button" data-close-capture>닫기 ×</button></div><div class="capture-dialog-body"><img alt=""></div></dialog>`;
  files.set(
    `week-${pad(week.week)}.html`,
    shell(
      `${week.week}회차 · ${week.title}`,
      `${chapters}${toc}<main class="deck" id="main">${slides.map((s) => s.html).join("\n")}</main>${controls}${captureDialog}`,
      "lecture-page",
    ),
  );
  manifests.push({
    week: week.week,
    slides: slides.length,
    workMinutes: 4 * weekTiming.work,
    workbook: `week-${pad(week.week)}`,
    blocks: starts,
  });
  const page = pages.get(`week-${pad(week.week)}`);
  const mdLink = (slug) => {
    const target = pages.get(slug);
    if (!target) throw new Error(`Unknown workbook reference: ${slug}`);
    return `[${target.title}](../${target.file})`;
  };
  const warmup = week.preparation?.warmup;
  const warmupSection = warmup
    ? `## ${warmup.title || "시작 실습: 이름 한 곳 바꾸기"}

${warmup.intro || "내 위키와 같은 프로젝트의 Claude Code를 엽니다. 이미 이름을 바꿨다면 기존 동작을 확인하고 기본 과제로 이어가세요."}

\`\`\`text
${warmup.text}
\`\`\`

**직접 확인:** ${warmup.check}

`
    : "";
  const sections = week.blocks.map((block, i) => {
    const practice = block.slides.find((s) => s.kind === "practice");
    const plan = block.slides.find((s) => s.phase === "plan");
    const input =
      block.slides.find((s) => s.phase === "implement") ||
      block.slides.find((s) => s.kind === "input");
    const planSection = plan
      ? `### 1. 계획 요청\n\n\`\`\`text\n${plan.text}\n\`\`\`\n\n**계획을 읽고 내가 확인할 것**\n\n${plan.checks.map((c) => `- **${c.title}** ${c.body}`).join("\n")}\n\n내 결정과 다르면 계획부터 고칩니다. 확인하기 전에는 아래 실행 요청을 보내지 않습니다.\n\n### 2. 확인한 뒤 실행\n\n`
      : input.activityType === "record"
        ? `**내 문서에 적을 양식입니다. 개발 AI에 보내는 요청이 아닙니다.**\n\n`
        : input.activityType === "terminal"
          ? `**터미널 명령입니다. 처음 준비하는 환경에서 한 줄씩 실행하고 결과를 확인합니다.**\n\n`
          : `**위키의 채팅에 입력하는 질문입니다. 개발용 AI와 구분하세요.**\n\n`;
    const references = [...new Set(practice.refs)]
      .filter((slug) => slug !== page.slug)
      .map(mdLink);
    const followups = practice.followups?.length
      ? `**이어서 개발하기**\n\n기본 기능을 확인한 뒤 이어갑니다. 각 요청 상자는 한 번에 입력하되, 계획과 실행을 함께 보내지 않습니다. 이미 완성한 동작은 확인하고 건너뜁니다. 선택 과제는 기본 기능 뒤에 진행합니다.\n\n${practice.followups.map((item) => `### ${item.optional ? "선택 과제" : "다음 기능"} · ${item.title}\n\n**먼저 계획 요청**\n\n\`\`\`text\n${item.plan}\n\`\`\`\n\n**내가 확인할 것**\n\n${item.review.map((r) => `- ${r}`).join("\n")}\n\n**계획을 확인한 뒤 실행**\n\n\`\`\`text\n${item.text}\n\`\`\``).join("\n\n")}\n\n`
      : "";
    const walkthroughs = practice.walkthroughs?.length
      ? `**만든 뒤 직접 눌러 보기**\n\n${practice.walkthroughs.map((guide) => `### ${guide.title}\n\n${guide.intro}\n\n${guide.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n\n${guide.note}`).join("\n\n")}\n\n`
      : "";
    return `## ${i + 1}. ${block.title}

[함께 볼 강의 화면](/lectures/week-${pad(week.week)}.html#${starts[i].id})

${(practice.workbookSteps || practice.steps).map((step, index) => `${index + 1}. ${step}`).join("\n")}

${practice.decision ? `**내가 정할 것:** ${practice.decision}\n\n` : ""}${block.storage ? `**저장 기준:** ${block.storage}\n\n` : ""}**입력할 곳:** ${input.where}

${planSection}${input.workbookLabel ? `### ${input.workbookLabel}\n\n` : ""}\`\`\`text
${input.text}
\`\`\`

${input.alternative ? `### ${input.alternative.label}\n\n\`\`\`text\n${input.alternative.text}\n\`\`\`\n\n` : ""}${followups}${practice.designPrompt ? `### 추가할 기능을 정해서 요청하기\n\n괄호를 내 업무에 맞게 채워 한 번에 입력하세요. 아래에서는 내가 고른 기능의 예시를 참고합니다.\n\n\`\`\`text\n${practice.designPrompt}\n\`\`\`\n\n${practice.designExamples.map((e) => `- **${e.title}:** ${e.text}`).join("\n")}\n\n` : ""}${walkthroughs}**확인:** ${practice.result}

${practice.scenarios ? `| 먼저 준비할 것 | 직접 해 볼 일 | 이렇게 되면 성공 |\n| --- | --- | --- |\n${practice.scenarios.map((s) => `| ${s.given} | ${s.action} | ${s.expected} |`).join("\n")}\n\n` : ""}${
  practice.extensions
    ? `**기본을 마쳤다면 — 선택 과제**

${practice.extensions.map((item) => `- **${item.title}:** ${item.body}`).join("\n")}

${practice.followups ? "필요한 과제를 선택하거나 다음 기능으로 이어가세요. 막히면 첫 동작부터 강사와 함께 완성합니다." : "한 가지만 골라도 됩니다. 막히면 기본 기능부터 강사와 함께 완성하세요."}

`
    : ""
}${block.hint ? `${block.hint}\n\n` : ""}참고: ${references.join(" · ")}`;
  });
  const md = `# ${week.title}

${week.goal}

[강의 화면](/lectures/week-${pad(week.week)}.html) · [회사 개발 노트](../company-project.md)

**${week.projectBrief ? "시작 전에 준비할 것" : "시작할 상태"}:** ${week.start}

**남길 결과:** ${week.deliver.join(" / ")}

${week.workflow || ""}

${week.projectBrief ? `${week.projectBrief}\n` : ""}${warmupSection}${sections.join("\n\n")}

${week.wrapupPrompt ? `## 화면에서 확인한 뒤 코드 보관하기\n\n${week.wrapupIntro || "직접 확인한 결과와 미확인 항목을 구분합니다."}\n\n**먼저 보관할 변경 확인**\n\n\`\`\`text\n${week.wrapupPrompt}\n\`\`\`\n\n${week.wrapupExecute ? `**포함할 코드·DB 변경과 제외할 설정을 확인한 뒤 실행**\n\n\`\`\`text\n${week.wrapupExecute}\n\`\`\`\n\n` : ""}` : ""}## 이어서 할 일

${week.next} ${week.projectBrief ? "바꾼 내용과 직접 확인한 결과는 회사 개발 노트의 같은 작업 카드에 적으세요." : "변경 코드와 확인 결과는 회사 개발 노트의 같은 작업 카드에 연결합니다."}
`;
  await writeFile(new URL(`docs/training/${page.file}`, root), md);
  await mkdir(new URL("docs/training/instructor/slide-notes/", root), {
    recursive: true,
  });
  await writeFile(
    new URL(
      `docs/training/instructor/slide-notes/week-${pad(week.week)}.md`,
      root,
    ),
    lectureNotes(week, slides),
  );
}
const index = `<main id="main" class="index"><section class="index-hero"><div class="index-copy"><p class="eyebrow">엠큐닉 · 계획을 확인하고 함께 개발하는 과정</p><h1>우리 회사 위키,<br>함께 개발하고<br><em>계속 키웁니다.</em></h1><p class="lead">스타터킷에서 시작해 회사 요구를 반영합니다.<br>강사의 코칭을 받으며 직접 개발하고,<br>만든 위키를 회사에 적용합니다.</p><div class="actions"><a class="button primary" href="week-01.html">첫 강의 시작하기 →</a><a class="button" href="domain-wiki-lectures.zip" download>전체 HTML ↓</a></div></div>${illustration()}</section><section class="index-guide"><p class="micro">이렇게 따라오세요</p><div><h2>화면으로 작업을 정하고,<br>직접 개발할 시간을 갖습니다.</h2><p>진행 상황에 맞춰 설명과 실습을 이어갑니다. 기본 기능을 완성한 뒤 자신의 업무에 적용하고, 먼저 마치면 선택 과제로 넓혀 봅니다. 강사는 막힌 부분을 코칭하고, 워크북은 순서·요청문·완료 기준을 안내합니다. 환경 준비와 업무 검증도 직접 작업에 포함됩니다.</p>${workbook("company-project", "회사 위키 실습 노트 열기")}</div></section><section class="course-list" aria-labelledby="course-list-title"><div class="section-heading"><p class="micro">우리 회사의 위키를 만드는 여정</p><h2 id="course-list-title">일곱 번의 만남, 하나의 위키.</h2></div><div class="course-grid">${course.weeks.map((w, i) => `<article class="course-card"><div class="card-top"><span>${pad(w.week)} / 07</span>${icon(icons[i], 30)}</div><p class="micro">${w.week}회차 · ${manifests[i].slides}장</p><h3><a href="week-${pad(w.week)}.html">${esc(w.title)} <span aria-hidden="true">↗</span></a></h3><p>${esc(w.goal)}</p><ol>${w.blocks.map((b) => `<li>${esc(b.title)}</li>`).join("")}</ol><div class="card-bottom"><a href="week-${pad(w.week)}.html">강의 열기 →</a><a href="week-${pad(w.week)}.html" download>HTML 저장 ↓</a></div></article>`).join("")}</div></section><section class="index-outro"><span>${icon("people", 48)}</span><h2>다음 동료도<br>이어 쓸 수 있도록.</h2><p>회사 공용 위키에서 직원의 업무를 확인하고,<br>개발 코드·운영 담당·다음 개선을 함께 인계합니다.</p>${workbook("company-project", "실습 결과와 인계 기록하기")}</section><p class="offline-note">내려받은 HTML은 그림·스타일을 포함해 단독으로 열립니다. 강의 사이를 이동하려면 ZIP을 같은 폴더에 풀어 주세요. 위키·워크북은 서비스 실행이 필요하며, 파일로 열 때는 http://localhost:3010으로 연결됩니다.</p></main><footer class="index-footer">김동학 / Anthony Kim · ${esc(course.title)}</footer>`;
files.set("index.html", shell(course.title, index, "index-page"));
files.set(
  "읽어주세요.txt",
  "도메인 위키 · 교육생용 실습 강의\n\nindex.html에서 시작하세요. 각 HTML에는 이미지·스타일·스크립트가 포함됩니다.\n방향키·PageUp/PageDown·Home/End로 이동합니다. 교시 탭과 목차로 실습을 찾을 수 있습니다.\n실습 화면을 열어 둔 채 개발·검증하고 강사의 코칭을 받습니다. 워크북에서 같은 작업의 순서와 요청문을 찾을 수 있습니다.\n실제 캡처를 누르면 확대됩니다. 닫기 또는 Esc로 돌아갑니다. 인쇄 시 모든 슬라이드가 포함됩니다.\n\n캡처는 가상 자료를 넣은 실제 스타터킷의 개선 전 화면입니다. 옆의 목표는 교육 중 개발할 후보이며 구현 완료를 뜻하지 않습니다.\n캡처의 수치·문서는 가상 교육 예제입니다. AI 답변 생성과 회사 배포의 성공을 증명하는 화면은 아닙니다.\n위키·워크북은 별도 서비스 실행이 필요합니다. 파일로 열면 http://localhost:3010을 사용합니다.\n공용 서버에서는 서버 주소 뒤 /lectures/index.html로 접속하세요.\n",
);
const zip = new JSZip();
for (const [name, data] of files) {
  await writeFile(new URL(name, output), data);
  zip.file(name, data, { date: new Date("2026-01-01T00:00:00Z") });
}
await writeFile(
  new URL("domain-wiki-lectures.zip", output),
  await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
);
await writeFile(
  new URL("docs/lectures/manifest.json", root),
  `${JSON.stringify(manifests, null, 2)}\n`,
);
console.log(
  `${manifests.length}개 교육생 강의 · ${manifests.reduce((n, w) => n + w.slides, 0)}장 · ${fileURLToPath(output)}`,
);
