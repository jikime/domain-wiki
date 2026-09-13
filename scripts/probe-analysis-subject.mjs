// Isolated prompt probe using the same failed synthetic unit. Does not edit application data.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";
import {
  analysisPrompt,
  validateUnitAnalysis,
} from "../src/lib/document-analysis.ts";
import {
  domainKnowledgeRules,
  purposeContextInstruction,
} from "../src/lib/domain-purpose.ts";
import { modelProfile, streamModel } from "../src/server/ai/client.ts";
import { deployment, literal } from "./lib/deployment.mjs";

nextEnv.loadEnvConfig(process.cwd());
const t = deployment("wiki-stage16-main");
const reportFile =
  "docs/evaluation/core/deployment-16/analysis-subject-probe.json";
if (existsSync(reportFile)) throw new Error("기존 실험 결과를 보존하세요.");
const failure = JSON.parse(
  readFileSync("docs/evaluation/core/deployment-16/revision.json", "utf8"),
);
const unit = JSON.parse(
  t.sql(
    `SELECT input->'unit' FROM ai_step WHERE task_id=${literal(failure.run.analysisTaskId)} AND kind='analyze' ORDER BY ordinal LIMIT 1`,
  ),
);
const context = JSON.parse(
  t.sql(
    `SELECT json_build_object('sourceTitle',s.title,'sourceVersionId',v.id,'category',s.category,'domain',json_build_object('name',d.name,'purpose',d.purpose,'terms',d.terms,'recordTemplate',d.record_template,'purposeGuide',d.purpose_guide)) FROM source_version v JOIN source s ON s.id=v.source_id JOIN domain d ON d.id=s.domain_id WHERE v.id=${literal(failure.run.sourceVersionId)}`,
  ),
);
context.domain = domainKnowledgeRules(context.domain);
const instruction =
  "subject는 인용한 part의 quote 또는 headingPath에 완전히 동일하게 존재하는 연속 문자열을 복사하세요. 조사·어미를 바꾸거나 다른 문구를 조합해 대상 이름을 만들지 마세요. 조건 구절은 condition에 원문 그대로 적고, 원문에 명시된 대상 이름이 없다면 subject를 빈 문자열로 두세요. 응답 전 각 subject가 해당 quote 또는 headingPath에 그대로 포함되는지 대조하세요.";
const candidatePrompt = analysisPrompt.includes(instruction)
  ? analysisPrompt
  : `${analysisPrompt}\n${instruction}`;
const messages = [
  {
    role: "system",
    content: `${candidatePrompt}\n${purposeContextInstruction}`,
  },
  { role: "user", content: JSON.stringify({ ...context, unit }) },
];
const started = Date.now();
const response = await streamModel(
  messages,
  async () => {},
  AbortSignal.timeout(90000),
  "knowledge",
);
const report = {
  date: new Date().toISOString(),
  model: modelProfile("knowledge").model,
  instruction,
  elapsedMs: Date.now() - started,
  inputTokens: response.inputTokens,
  outputTokens: response.outputTokens,
  modelOutput: response.text,
  passed: false,
};
try {
  report.result = validateUnitAnalysis(JSON.parse(response.text), unit);
  report.passed = true;
} catch (e) {
  report.error = e.message;
} finally {
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(
  JSON.stringify({
    passed: report.passed,
    error: report.error,
    inputTokens: report.inputTokens,
    outputTokens: report.outputTokens,
    elapsedMs: report.elapsedMs,
  }),
);
if (!report.passed) process.exitCode = 1;
