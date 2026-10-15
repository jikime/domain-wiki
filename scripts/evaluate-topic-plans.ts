// Real-model planning evaluation only. No database writes, publishing or customer data.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import {
  assertGenerationBudget,
  type GenerationAnalysis,
  generationMessages,
  validateWikiPlan,
  WIKI_GENERATION_PROMPT_VERSION,
  type WikiCandidate,
  wikiPlanPrompt,
} from "../src/lib/wiki-generation";

async function main() {
  loadEnvConfig(process.cwd());
  const { modelProfile, streamModel } = await import("../src/server/ai/client");
  const dir = "docs/evaluation/topic-accumulation-20260924";
  const output = process.argv[2] ?? `${dir}/real-plan-results.json`;
  if (existsSync(output))
    throw new Error("기존 평가 결과가 있습니다. 새 출력 경로를 지정하세요.");
  const inputs = ["01-rfp.md", "02-design.md", "03-exception.md"].map((file) =>
    readFileSync(`${dir}/${file}`, "utf8").trim(),
  );
  const profile = modelProfile("knowledge");
  const projectId = randomUUID();
  const topicId = randomUUID();
  const candidate: WikiCandidate = {
    pageId: topicId,
    publishedVersionId: randomUUID(),
    latestVersionId: "",
    projectId,
    title: "화면 갱신 조건",
    body: inputs[0],
    chunkIds: [randomUUID()],
    sourceIds: [randomUUID()],
    metadata: { type: "concept", aliases: ["가시화응답성"], links: [] },
    score: 1,
  };
  candidate.latestVersionId = candidate.publishedVersionId;
  const report = {
    date: new Date().toISOString(),
    scope:
      "실제 모델의 계획 선택만 평가. 분석 주장은 사람이 구성한 가상 표본이며 본문 생성·병합·DB 게시를 실행하지 않음.",
    transport: profile.transport,
    model: profile.model,
    promptVersion: WIKI_GENERATION_PROMPT_VERSION,
    cases: [] as Record<string, unknown>[],
  };
  const exceptionOnly = process.argv.includes("--exception-only");
  if (exceptionOnly) {
    candidate.body += `\n\n${inputs[1]}`;
    candidate.chunkIds.push(randomUUID());
    candidate.sourceIds?.push(randomUUID());
  }
  for (const index of exceptionOnly ? [2] : [1, 2]) {
    const chunkId = randomUUID();
    const sourceId = randomUUID();
    const analysis: GenerationAnalysis = {
      summaries: [{ unitId: "u1", text: inputs[index] }],
      claims: [
        {
          id: "claim-1",
          unitId: "u1",
          kind: index === 1 ? "requirement" : "exception",
          subject: index === 1 ? "보조 화면" : "",
          predicate: index === 1 ? "갱신 주기" : "통신 단절 시 처리",
          text: inputs[index],
          polarity: index === 1 ? "affirmed" : "negated",
          value: index === 1 ? "90" : null,
          unit: index === 1 ? "초" : null,
          condition: null,
          evidence: [{ partId: "part-1", chunkId, quote: inputs[index] }],
        },
      ],
      comparisons: [],
      questions: [],
      dispositions: [
        {
          partId: "part-1",
          status: "analyzed",
          reason: "표본 원문 전체",
          unitId: "u1",
        },
      ],
      coverage: {
        totalChunks: 1,
        processedChunks: 1,
        totalUnits: 1,
        processedUnits: 1,
        totalParts: 1,
        processedParts: 1,
        totalChars: inputs[index].length,
        processedChars: inputs[index].length,
        excluded: [],
      },
      warnings: [],
    };
    const payload = {
      sourceTitle: index === 1 ? "보조 화면 설계 기준" : "통신 장애 처리 기준",
      sourceId,
      category: "project",
      projectId,
      domain: {
        name: "가상 교통관제",
        purpose:
          "같은 사업의 화면 갱신 조건과 예외를 주제별로 축적하고 새 요구사항 검토에 활용한다.",
        terms: [],
        recordTemplate: "상황·조건·예외·근거",
      },
      analysis,
      existingWikis: [candidate],
      relatedSources: [],
      excludedCandidates: [],
    };
    const messages = generationMessages(wikiPlanPrompt, payload);
    assertGenerationBudget(messages, profile.contextChars);
    console.log(`실제 모델 계획 평가 ${index}/2 시작`);
    const started = Date.now();
    const result = await streamModel(
      messages,
      async () => {},
      AbortSignal.timeout(180000),
      "knowledge",
    );
    const parsed = JSON.parse(
      result.text
        .trim()
        .replace(/^```(?:json)?\s*\n/i, "")
        .replace(/\n```\s*$/, ""),
    );
    let plan: ReturnType<typeof validateWikiPlan>;
    try {
      plan = validateWikiPlan(parsed, analysis, [candidate], projectId);
    } catch (error) {
      report.cases.push({
        case: index,
        passed: false,
        input: structuredClone(payload),
        rawPlan: parsed,
        validationError:
          error instanceof Error ? error.message : "계획 검증 실패",
        durationMs: Date.now() - started,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
      writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
      throw error;
    }
    const updates = plan.pages.filter(
      (p) => p.pageId === topicId && ["update", "conflict"].includes(p.kind),
    );
    const passed = updates.length === 1;
    report.cases.push({
      case: index,
      passed,
      input: structuredClone(payload),
      plan,
      sameTopicId: topicId,
      durationMs: Date.now() - started,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      `실제 모델 계획 평가 ${index}/2: ${passed ? "기존 주제 수정" : "기존 주제 수정 미선택"}`,
    );
    if (!passed) {
      process.exitCode = 1;
      break;
    }
    // The next input is a human-constructed cumulative fixture, not a claim that
    // this model has generated or published the merged body.
    candidate.body += `\n\n${inputs[index]}`;
    candidate.chunkIds.push(chunkId);
    candidate.sourceIds?.push(sourceId);
  }
}
main().catch((error: unknown) => {
  // Do not print provider request objects or authentication settings.
  console.error(error instanceof Error ? error.message : "계획 평가 실패");
  process.exitCode = 1;
});
