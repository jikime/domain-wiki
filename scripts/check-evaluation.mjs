import { readFileSync } from "node:fs";
import { join } from "node:path";

const questions = JSON.parse(
  readFileSync("docs/evaluation/questions.json", "utf8"),
);
const ids = new Set();
for (const question of questions) {
  if (
    ids.has(question.id) ||
    !question.question ||
    !question.scope ||
    !question.expectedClaims?.length
  )
    throw new Error(`평가 항목 확인 필요: ${question.id}`);
  ids.add(question.id);
  if (question.answerable && !question.evidence.length)
    throw new Error(`기대 근거 누락: ${question.id}`);
  if (!question.answerable && !question.reason)
    throw new Error(`답변 불가 이유 누락: ${question.id}`);
  for (const evidence of question.evidence) {
    const lines = readFileSync(
      join("docs/evaluation", evidence.source),
      "utf8",
    ).split("\n");
    const line = Number(evidence.locator.match(/(\d+)행/)?.[1]);
    if (!lines[line - 1]?.includes(evidence.quote))
      throw new Error(`원문 구절·위치 불일치: ${question.id}`);
  }
}
console.log(
  `평가 목록 ${questions.length}개: 항목·원문 구절·위치 확인 통과 (AI 품질 평가는 아직 실행하지 않음)`,
);
