(() => {
  const offline = location.protocol === "file:";
  if (offline) {
    for (const link of document.querySelectorAll("[data-workbook]")) {
      link.href = `http://localhost:3010${link.dataset.workbook}`;
    }
    for (const link of document.querySelectorAll(
      'a[href="domain-wiki-lectures.zip"]',
    )) {
      link.hidden = true;
    }
  }
  const slides = Array.from(document.querySelectorAll(".slide"));
  if (!slides.length) return;
  const previous = document.querySelector("[data-previous]");
  const next = document.querySelector("[data-next]");
  const counter = document.querySelector("[data-counter]");
  const progress = document.querySelector("[data-progress]");
  const toc = document.querySelector("#toc");
  const tocButton = document.querySelector("[data-toc]");
  const allButton = document.querySelector("[data-all]");
  const status = document.querySelector("[data-status]");
  const captureDialog = document.querySelector(".capture-dialog");
  for (const button of document.querySelectorAll("[data-capture]")) {
    button.addEventListener("click", () => {
      const source = button.querySelector("img");
      const target = captureDialog.querySelector("img");
      target.src = source.src;
      target.alt = source.alt;
      captureDialog.showModal();
    });
  }
  captureDialog
    ?.querySelector("[data-close-capture]")
    .addEventListener("click", () => captureDialog.close());
  let showAll = false;
  let current = 0;
  const hashIndex = () => {
    const found = slides.findIndex((slide) => `#${slide.id}` === location.hash);
    return found < 0 ? 0 : found;
  };
  function render(focus = false) {
    document.body.classList.toggle(
      "stage-active",
      !showAll && slides[current].classList.contains("slide-stage"),
    );
    slides.forEach((slide, index) => {
      slide.hidden = !showAll && index !== current;
      slide.setAttribute("aria-label", `${index + 1} / ${slides.length}`);
    });
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    counter.textContent = `${current + 1} / ${slides.length}`;
    progress.style.width = `${((current + 1) / slides.length) * 100}%`;
    for (const link of document.querySelectorAll("[data-chapter]")) {
      if (link.dataset.chapter === slides[current].dataset.block) {
        link.setAttribute("aria-current", "step");
      } else {
        link.removeAttribute("aria-current");
      }
    }
    document.title = `${slides[current].dataset.title} | ${document.body.dataset.title}`;
    if (focus) {
      slides[current].focus({ preventScroll: true });
      if (showAll) slides[current].scrollIntoView({ block: "start" });
      else window.scrollTo(0, 0);
    }
  }
  function go(index) {
    const target = Math.max(0, Math.min(slides.length - 1, index));
    if (target === current) return;
    current = target;
    history.replaceState(null, "", `#${slides[current].id}`);
    render(true);
  }
  previous.addEventListener("click", () => go(current - 1));
  next.addEventListener("click", () => go(current + 1));
  window.addEventListener("hashchange", () => {
    current = hashIndex();
    render(true);
  });
  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    if (
      event.target.closest(
        "button, a, summary, input, textarea, select, [contenteditable]",
      )
    )
      return;
    if (toc.hidden === false || showAll || captureDialog?.open) return;
    const destinations = {
      ArrowRight: current + 1,
      PageDown: current + 1,
      ArrowLeft: current - 1,
      PageUp: current - 1,
      Home: 0,
      End: slides.length - 1,
    };
    if (Object.hasOwn(destinations, event.key)) {
      event.preventDefault();
      go(destinations[event.key]);
    }
  });
  tocButton.addEventListener("click", () => {
    toc.hidden = !toc.hidden;
    tocButton.setAttribute("aria-expanded", String(!toc.hidden));
    if (!toc.hidden) toc.querySelector("a").focus();
  });
  toc.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link) return;
    event.preventDefault();
    toc.hidden = true;
    tocButton.setAttribute("aria-expanded", "false");
    const target = slides.findIndex(
      (slide) => `#${slide.id}` === link.getAttribute("href"),
    );
    if (target === current) render(true);
    else go(target);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !toc.hidden) {
      toc.hidden = true;
      tocButton.setAttribute("aria-expanded", "false");
      tocButton.focus();
    }
  });
  allButton.addEventListener("click", () => {
    showAll = !showAll;
    allButton.setAttribute("aria-pressed", String(showAll));
    allButton.textContent = showAll ? "한 장씩 보기" : "전체 보기";
    render(true);
  });
  document
    .querySelector("[data-print]")
    .addEventListener("click", () => window.print());
  let printClosedAnswers = [];
  window.addEventListener("beforeprint", () => {
    if (captureDialog?.open) captureDialog.close();
    printClosedAnswers = Array.from(
      document.querySelectorAll(".answer:not([open])"),
    );
    for (const answer of printClosedAnswers) answer.open = true;
  });
  window.addEventListener("afterprint", () => {
    for (const answer of printClosedAnswers) answer.open = false;
    printClosedAnswers = [];
  });
  document
    .querySelector("[data-fullscreen]")
    .addEventListener("click", async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        status.textContent =
          "전체 화면을 지원하지 않는 환경입니다. 브라우저의 확대 기능을 이용하세요.";
      }
    });
  for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
      const source = document.getElementById(button.dataset.copy);
      const message = button.parentElement.querySelector("[role=status]");
      try {
        await navigator.clipboard.writeText(source.textContent);
        message.textContent =
          button.dataset.copyMessage ||
          "복사했습니다. 입력할 곳을 확인하고, 대괄호가 있으면 실제 내용으로 바꾸세요.";
      } catch {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(source);
        selection.removeAllRanges();
        selection.addRange(range);
        message.textContent =
          "자동 복사가 제한되어 글을 선택했습니다. Ctrl+C 또는 ⌘C로 복사하세요.";
      }
    });
  }
  current = hashIndex();
  document.body.classList.add("enhanced");
  render();
})();
