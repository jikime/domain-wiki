// Local, deterministic contract fixture. This is not a real model or a quality evaluation.
import { createServer } from "node:http";

const calls = [];
const usageRequests = [];
const models = [];
const temperatures = [];
const researchSearches = [];
const failedAnalysisUnits = new Set();
const failedWikiPages = new Set();
const server = createServer(async (req, res) => {
  if (req.url === "/stats") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        calls,
        usageRequests,
        models,
        temperatures,
        researchSearches,
      }),
    );
    return;
  }
  if (req.url?.startsWith("/research/search?")) {
    const params = new URL(req.url, "http://127.0.0.1").searchParams;
    const query = params.get("q") ?? "";
    researchSearches.push({
      query,
      categories: params.get("categories"),
      format: params.get("format"),
    });
    res.setHeader("Content-Type", "application/json");
    if (query.includes("검색실패")) {
      res.writeHead(503);
      res.end("{}");
      return;
    }
    const results = query.includes("빈검색")
      ? []
      : Array.from({ length: 5 }, (_, i) => ({
          title: `검색 발췌 ${query} ${i + 1}`,
          url: `https://research.example/${encodeURIComponent(query.includes("중복검색") ? "동일" : query)}/${i + 1}`,
          content: `검색어 ${query}의 실제 제공자 발췌 ${i + 1}입니다. 검수 기록을 72시간 보관하고 담당자가 검토한 후 문서를 게시합니다. 원문 전문의 별도 확인이 필요합니다.`,
        }));
    res.end(JSON.stringify({ results }));
    return;
  }
  if (req.headers.authorization !== `Bearer ${process.env.AI_API_KEY}`) {
    res.writeHead(401);
    res.end();
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  if (req.url === "/v1/embeddings") {
    if (body.input.some((text) => text.includes("임베딩오류"))) {
      res.writeHead(503);
      res.end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        usage: {
          prompt_tokens: body.input.reduce(
            (sum, text) => sum + Math.ceil(text.length / 4),
            0,
          ),
        },
        data: body.input.map((text, index) => ({
          index,
          embedding: text.includes("알수없는무근거문자열")
            ? [0, 0, 1, 0]
            : /갱신|새로고침|재연결|관제/.test(text)
              ? [1, 0.1, 0.01, 0.1]
              : [0.01, 1, 0.1, 0.01],
        })),
      }),
    );
    return;
  }
  if (req.url !== "/v1/chat/completions") {
    res.writeHead(404);
    res.end();
    return;
  }
  calls.push(body.messages);
  models.push(body.model);
  temperatures.push(body.temperature ?? null);
  usageRequests.push(body.stream_options?.include_usage === true);
  if (Array.isArray(body.messages.at(-1)?.content)) {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "이미지에는 검수 결과와 72시간 보관 조건이 표시되어 있습니다. 자료 등록에서 검토를 거쳐 게시로 이어지는 흐름을 보여 줍니다." }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 45 } })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
    return;
  }
  const question = body.messages.at(-1).content;
  const instruction = body.messages[0]?.content ?? "";
  const documentJob = [
    "문서 전체 구조화 분석",
    "문서 요약 작업",
    "여러 위키 변경 계획",
    "위키 단락 생성",
  ].some((prefix) => instruction.startsWith(prefix));
  // Related evidence can contain ordinary words such as 지연. Only the fixture's
  // source title selects a document-job failure/delay scenario.
  const scenario = documentJob
    ? (JSON.parse(question).sourceTitle ?? "")
    : question;
  if (scenario.includes("모델오류")) {
    res.writeHead(503);
    res.end(JSON.stringify({ error: "test fixture failure" }));
    return;
  }
  if (instruction.startsWith("문서 전체 구조화 분석")) {
    const payload = JSON.parse(question);
    const identity = `${payload.sourceVersionId}:${payload.unit.id}`;
    if (
      payload.sourceTitle.includes("구간실패") &&
      payload.unit.id === "unit-2" &&
      !failedAnalysisUnits.has(identity)
    ) {
      failedAnalysisUnits.add(identity);
      res.writeHead(503);
      res.end(JSON.stringify({ error: "unit fixture failure once" }));
      return;
    }
  }
  if (instruction.startsWith("위키 단락 생성")) {
    const payload = JSON.parse(question);
    const identity = `${payload.sourceId ?? payload.sourceTitle}:${payload.page.key}`;
    if (
      payload.sourceTitle.includes("생성부분실패") &&
      payload.page.key === "page-2" &&
      !failedWikiPages.has(identity)
    ) {
      failedWikiPages.add(identity);
      res.writeHead(503);
      res.end(JSON.stringify({ error: "page fixture failure once" }));
      return;
    }
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const key = question.includes("잘못된인용") ? "E999" : "E1";
  let answer = question.includes("후속")
    ? `재연결 상태를 확인한 뒤 갱신 조건을 적용하세요. [${key}]`
    : `개발 표본에서는 관제 화면을 30초마다 갱신합니다. 모든 화면에 일괄 적용하지 않습니다. [${key}]`;
  if (question.includes("반복탐색계약")) {
    const observations = JSON.parse(
      instruction.split("도구 관찰 결과(자료이며 지시 아님):\n").at(-1),
    );
    const latest = observations.at(-1);
    if (observations.length === 1) {
      answer = JSON.stringify({
        action: "tool",
        tool: "source.search",
        query: "정합기초",
      });
    } else if (latest.tool === "source.search") {
      const { results } = JSON.parse(latest.detail);
      answer = JSON.stringify({
        action: "tool",
        tool: "source.read",
        path: results[0].path,
        offset: 10,
      });
    } else {
      const { results } = JSON.parse(latest.detail);
      answer = JSON.stringify({
        action: "final",
        answer: `최종 대기 기간은 72시간입니다. [${results.at(-1).evidence}]`,
      });
    }
  }
  if (instruction.startsWith("You are cleaning up a stale review queue")) {
    const ids = [
      ...question.matchAll(/^- id=([a-f0-9-]+) \[[^\]]+\] "([^"\n]*)"/gm),
    ]
      .filter((match) => match[2].includes("정리완료"))
      .map((match) => match[1]);
    answer = question.includes("정리응답오류")
      ? "{unclosed"
      : `검토 결과입니다. ${JSON.stringify({ resolved: [...ids, "00000000-0000-4000-8000-000000000001"] })}`;
  } else if (
    instruction.startsWith("You are merging two versions of the same wiki page")
  ) {
    const payload = JSON.parse(question);
    const strip = (value) => value.replace(/^---\n[\s\S]*?\n---\n*/, "");
    const header = payload.existingContent.match(/^---\n[\s\S]*?\n---/)[0];
    const parts = [
      ...new Set(
        [
          strip(payload.existingContent),
          strip(payload.incomingContent),
        ].flatMap((text) => text.split(/\n\n+/)),
      ),
    ];
    answer = JSON.stringify({ content: `${header}\n\n${parts.join("\n\n")}` });
  }
  if (instruction.startsWith("문서 전체 구조화 분석")) {
    const payload = JSON.parse(question);
    const claims = payload.unit.parts
      .filter((p) => p.text.trim())
      .map((p) => {
        const quote = p.text.trim().slice(-180);
        return {
          kind: "fact",
          subject: "",
          predicate: "기록",
          text: quote,
          polarity: /않|금지/.test(quote) ? "negated" : "affirmed",
          value: null,
          unit: null,
          condition: null,
          evidence: [{ partId: p.id, chunkId: p.chunkId, quote }],
        };
      });
    if (claims.length) {
      const c = claims[0];
      if (payload.sourceTitle.includes("분석수치변조")) c.text += " 999999초";
      if (payload.sourceTitle.includes("분석단위변조")) c.unit = "밀리초";
      if (payload.sourceTitle.includes("분석대상변조"))
        c.subject = "다른 회사 B";
      if (payload.sourceTitle.includes("분석부정변조")) {
        c.text = "모든 화면에 적용합니다.";
        c.polarity = "affirmed";
      }
      if (payload.sourceTitle.includes("분석근거변조"))
        c.evidence[0].chunkId = "00000000-0000-4000-8000-000000000099";
    }
    const parts = payload.unit.parts.map((p) => ({
      partId: p.id,
      status: p.text.trim() ? "analyzed" : "no_facts",
      reason: p.text.trim() ? "원문 조건 확인" : "공백 구분자",
    }));
    if (payload.sourceTitle.includes("분석범위누락")) parts.pop();
    answer = JSON.stringify({
      summary: `${payload.unit.id}의 원문 조건을 확인했습니다.`,
      claims,
      parts,
      questions: [],
    });
  } else if (instruction.startsWith("여러 위키 변경 계획")) {
    const payload = JSON.parse(question);
    const count =
      !payload.sourceTitle.includes("자동정리") &&
      /생성여섯|생성부분실패|생성큰순환/.test(payload.sourceTitle)
        ? 6
        : 2;
    const available = payload.existingWikis.filter(
      (w) => w.projectId === payload.projectId,
    );
    const target = available.find((w) => w.title.includes("생성대상"));
    const merge = available.find((w) => w.title.includes("병합대상"));
    const pages = Array.from({ length: count }, (_, index) => ({
      key: `page-${index + 1}`,
      kind: "new",
      type: index === 0 ? "source" : "concept",
      title: `${payload.sourceTitle} ${index === 0 ? "문서 요약" : `조건 ${index}`}`,
      subject: "관제 화면",
      scope: "개발 표본의 관제 화면",
      pageId: null,
      mergedPageIds: [],
      claimIds:
        index === 0
          ? payload.analysis.claims.map((c) => c.id)
          : [
              payload.analysis.claims[
                (index - 1) % payload.analysis.claims.length
              ].id,
            ],
      aliases: [],
      links:
        index === 0
          ? Array.from({ length: count - 1 }, (_, i) => ({
              key: `page-${i + 2}`,
              reason: "세부 조건 확인",
            }))
          : [],
      reason: "원문의 적용 조건을 독립적으로 확인합니다.",
      questions: [],
    }));
    if (payload.sourceTitle.includes("생성순환"))
      pages[1].links = [{ key: "page-1", reason: "문서 요약 확인" }];
    if (payload.sourceTitle.includes("자동정리")) {
      for (const page of pages) {
        const previous = available.find((w) => w.title === page.title);
        if (previous) {
          page.kind = "update";
          page.pageId = previous.pageId;
        }
      }
      if (payload.sourceTitle.includes("개정복제오류")) {
        pages[0].kind = "new";
        pages[0].pageId = null;
      }
    }
    if (payload.sourceTitle.includes("생성큰순환"))
      for (let i = 0; i < pages.length; i++)
        pages[i].links = [
          { key: `page-${((i + 1) % count) + 1}`, reason: "다음 페이지" },
        ];
    if (/생성보완|생성병합/.test(payload.sourceTitle) && target) {
      pages[0].kind = "update";
      pages[0].pageId = target.pageId;
    }
    if (payload.sourceTitle.includes("생성병합") && merge) {
      pages[0].kind = "merge";
      pages[0].mergedPageIds = [merge.pageId];
    }
    if (payload.sourceTitle.includes("생성유형혼동")) {
      pages[0].kind = "procedure";
      delete pages[0].type;
    }
    if (payload.sourceTitle.includes("생성허위ID"))
      pages[0].claimIds = ["허위-claim"];
    if (payload.sourceTitle.includes("생성범위누락")) pages[0].claimIds.pop();
    if (payload.sourceTitle.includes("생성다른범위")) {
      pages[0].kind = "update";
      pages[0].pageId =
        payload.existingWikis.find((w) => w.projectId !== payload.projectId)
          ?.pageId ?? "00000000-0000-4000-8000-000000000099";
    }
    answer = JSON.stringify({
      summary: "원문의 모든 적용 조건으로 위키를 구성합니다.",
      pages,
      questions: ["실제 업무에 적용할 대상 범위를 확인해 주세요."],
    });
  } else if (instruction.startsWith("위키 단락 생성")) {
    const payload = JSON.parse(question);
    const sections = payload.claims.map((c) => ({
      heading: "원문 조건",
      content: c.text,
      claimIds: [c.id],
    }));
    if (payload.sourceTitle.includes("생성수치변조"))
      sections[0].content += " 999999초";
    if (payload.sourceTitle.includes("생성링크변조"))
      sections[0].content += " [임의 링크](https://outside.invalid)";
    answer = JSON.stringify({
      sections,
      conflict: payload.sourceTitle.includes("생성모순"),
      questions: payload.sourceTitle.includes("생성모순")
        ? ["기존 적용 조건과 일치하는지 확인해 주세요."]
        : [],
    });
  } else if (instruction.startsWith("문서 요약 작업")) {
    const payload = JSON.parse(question);
    answer = JSON.stringify({
      summary: "개발 원문의 적용 조건을 확인합니다.",
      claims: [
        {
          text: "원문에 적힌 조건",
          chunkId: question.includes("거짓근거")
            ? "00000000-0000-4000-8000-000000000099"
            : payload.evidence[0].id,
          quote: question.includes("잘못된구절")
            ? "존재하지 않는 구절"
            : payload.evidence[0].text,
        },
      ],
    });
  } else if (instruction.startsWith("실무 메모 정리")) {
    answer = JSON.stringify({
      situation: "관제 화면 갱신이 지연되었습니다.",
      reasoning: "개발 표본의 30초 조건을 확인했습니다.",
      result: "모든 화면에 일괄 적용하지 않았습니다.",
      followUp: "실제 업무 조건 확인 필요",
    });
  } else if (instruction.startsWith("RFP 업무 분석")) {
    const payload = JSON.parse(question);
    const rfp = payload.evidence.find(
      (e) => e.sourceId === payload.rfpSourceId,
    );
    const guideline = payload.evidence.find(
      (e) => e.sourceId !== payload.rfpSourceId && e.category === "guideline",
    );
    const sections = [
      {
        kind: "requirement",
        title: "관제 화면 요구",
        meaning: "원문의 갱신 조건과 일괄 적용 제외를 확인합니다.",
        quote: question.includes("잘못된구절")
          ? "원문에 없는 확정 의무"
          : rfp.text,
        chunkIds: [
          question.includes("거짓근거")
            ? "00000000-0000-4000-8000-000000000099"
            : rfp.id,
        ],
        questions: ["적용할 화면과 예외 범위는 어디까지인가요?"],
      },
    ];
    if (guideline)
      sections.push({
        kind: "standard",
        title: "검토할 관련 기준",
        meaning: "사업에 적용할 조건을 원문과 함께 검토합니다.",
        quote: guideline.text,
        chunkIds: [guideline.id],
        questions: ["이 지침이 본 사업에 적용되나요?"],
      });
    sections.push({
      kind: "inference",
      title: "설계 검토 의견",
      meaning: "예외 화면을 나누어 확인할 필요가 있다는 추론입니다.",
      quote: "",
      chunkIds: [],
      questions: ["예외 화면의 처리 방식은 고객 확인이 필요한가요?"],
    });
    answer = JSON.stringify({ title: "관제 RFP 개발 분석", sections });
  } else if (instruction.startsWith("원문 기반 위키 변경 제안")) {
    const payload = JSON.parse(question);
    let draftBody =
      "개발 표본의 갱신 조건은 30초입니다. 모든 화면에 일괄 적용하지 않습니다.";
    if (question.includes("파일블록"))
      draftBody = `---FILE: wiki/generated.md---\r\n${draftBody}\r\n---END FILE---`;
    if (question.includes("위험경로"))
      draftBody = "---FILE: ../../outside.md---\n내용\n---END FILE---";
    if (question.includes("미완성블록"))
      draftBody = "---FILE: wiki/generated.md---\n끝나지 않은 내용";
    answer = JSON.stringify({
      title: "개발 표본 갱신 제안",
      body: draftBody,
      reason: "원문 부정문과 갱신 조건을 반영했습니다.",
      chunkIds: question.includes("거짓근거")
        ? ["00000000-0000-4000-8000-000000000099"]
        : [payload.evidence[0].id],
      conflict: question.includes("모순제안"),
    });
  }
  if (instruction.startsWith("위키 품질 검토 직원")) {
    const payload = JSON.parse(question);
    const quotes = payload.units.map((u) => ({
      pageId: u.pageId,
      quote: u.text.trim().slice(0, Math.min(u.text.trim().length, 100)),
    }));
    const findings = [];
    if (question.includes("품질후보없음")) {
      /* Deliberately empty recheck contract. */
    } else if (question.includes("품질거짓구절"))
      findings.push({
        kind: "missing-explanation",
        severity: "warning",
        title: "입력 밖 구절 시험",
        note: "존재하지 않는 구절을 서버가 거부해야 합니다.",
        quotes: [
          {
            pageId: payload.units[0].pageId,
            quote: "입력에 존재하지 않는 꾸며낸 검사 구절입니다.",
          },
        ],
      });
    else if (payload.comparison === "related-pair")
      findings.push({
        kind: "contradiction",
        severity: "warning",
        title: "같은 검수 조건의 기간 비교",
        note: "두 페이지의 같은 적용 대상과 기간 차이를 원문과 대조해 주세요.",
        quotes,
      });
    else if (question.includes("보완후보표본")) {
      findings.push({
        kind: "missing-explanation",
        severity: "info",
        title: "조건 설명 보완 후보",
        note: "이 구간에서 예외 상황의 확인 절차를 추가로 검토해 주세요.",
        quotes,
      });
      const purposeQuestion =
        payload.purpose.purposeGuide?.keyQuestions?.split("\n")[0];
      if (purposeQuestion)
        findings.push({
          kind: "purpose-gap",
          severity: "info",
          title: "핵심 질문 설명 보완",
          note: "핵심 질문에 대한 설명을 보완할지 검토해 주세요. 목적 변경은 관리자에게 제안합니다.",
          quotes,
          purposeQuestion,
        });
    }
    answer = JSON.stringify({ findings });
  }
  if (question.startsWith("Edit the selected text according to")) {
    answer = "```markdown\n검수 기록은 72시간 보관합니다.\n```";
  }
  if (
    question.startsWith("Answer the user's instruction about the selected text")
  ) {
    answer = question.includes("후속")
      ? "앞선 질문에 이어 설명하면 보관 기간은 72시간입니다. [1]"
      : "선택한 문장은 검수 기록의 72시간 보관 조건을 설명합니다. [1] [[concepts/retention|보관 기준 문서]]를 함께 확인하세요.";
  }
  if (
    instruction.startsWith(
      "You are a research assistant. Given a knowledge gap",
    )
  ) {
    answer =
      "TOPIC: 검수 기록 보관 기준 조사\nQUERY: 검수기초\nQUERY: 검수 기록 보관\nQUERY: 검수 공개 절차";
  }
  if (
    instruction.startsWith(
      "You are a research assistant. Synthesize the collected",
    )
  ) {
    const sources = [...question.matchAll(/^\[(\d+)\] \*\*/gm)].map((m) =>
      Number(m[1]),
    );
    const citation = question.includes("연구인용오류") ? 999 : 1;
    answer = question.includes("연구본문오류")
      ? "<think>검토만 했습니다.</think>"
      : `# 검수 기록 조사\n\n자료에 따르면 검수 기록의 보관 기간은 72시간이며 담당자의 확인과 게시 검토가 필요합니다. 검색 제공자가 반환한 발췌문을 바탕으로 한 조사이므로 실제 원문에서 적용 대상과 예외 조건을 대조해야 합니다. 이러한 조건을 확인한 후 업무 절차에 반영하고 변경된 근거를 함께 관리하는 것이 필요합니다. [${citation}]\n\n## 연결 및 추가 확인\n\n기존 [[concepts/검수기초|검수 기준]]를 함께 살펴봅니다. 자료 사이의 차이와 누락된 예외 조건을 추가로 조사하고 공개 전에 원문 근거를 검토합니다.${question.includes("혼합인용") && sources.length > 5 ? " [6]" : ""}`;
  }
  if (question.includes("채팅위키연결계약")) {
    answer =
      "[[concepts/검수기초|검수 기준]]에 따르면 기록을 72시간 보관합니다. [E1]";
  }
  const tokens = [answer.slice(0, 12), answer.slice(12, 35), answer.slice(35)];
  let i = 0;
  const send = () => {
    if (res.destroyed) return;
    if (i < tokens.length) {
      const buf = Buffer.from(
        `data: ${JSON.stringify({ choices: [{ delta: { content: tokens[i++] } }] })}\r\n\r\n`,
      );
      const split = buf.indexOf(Buffer.from("개발")) + 1;
      res.write(buf.subarray(0, Math.max(1, split)));
      res.write(buf.subarray(Math.max(1, split)));
      setTimeout(send, scenario.includes("지연") ? 1800 : 25);
    } else if (scenario.includes("강제단절")) {
      res.end();
    } else {
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: null })}\n\n`,
      );
      if (body.stream_options?.include_usage)
        res.write(
          `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 40 } })}\n\n`,
        );
      res.end("data: [DONE]");
    }
  };
  setTimeout(send, scenario.includes("지연") ? 1800 : 5);
});
server.listen(3102, "127.0.0.1", () =>
  console.log("시험용 모델 계약 서버 준비"),
);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
