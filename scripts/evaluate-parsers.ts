import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  type ExtractionResult,
  parseDocument,
} from "../src/server/parsers/document";

type Result = {
  file: string;
  sha256: string;
  productionParser?: Partial<ExtractionResult> & {
    status: string;
    message?: string;
  };
  officeParser: {
    status: string;
    text?: string;
    nodes?: unknown[];
    message?: string;
  };
};

async function main() {
  const root = "docs/evaluation/stage-02";
  const files = [
    "text-pages.pdf",
    "columns-table.pdf",
    "scan-only.pdf",
    "broken.pdf",
    "conditions-table.docx",
    "screen-notes.pptx",
  ];
  const results: Result[] = [];
  for (const file of files) {
    const path = `${root}/fixtures/${file}`;
    const bytes = readFileSync(path);
    let native: Result["productionParser"];
    if (file.endsWith(".pdf")) {
      try {
        native = {
          status: "extracted",
          ...(await parseDocument(bytes, "application/pdf")),
        };
      } catch (error) {
        native = {
          status: "rejected",
          message: error instanceof Error ? error.message : "추출 실패",
        };
      }
    }
    // Separate PDF.js versions install different global workers in one process.
    const comparison = spawnSync(
      process.execPath,
      ["scripts/evaluate-office.mjs", path],
      {
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    if (comparison.status !== 0)
      throw new Error(`비교 파서 실행 실패: ${file}`);
    const office: Result["officeParser"] = JSON.parse(comparison.stdout);
    results.push({
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      productionParser: native,
      officeParser: office,
    });
  }
  const xml = spawnSync("python3", ["scripts/evaluate-office-xml.py"], {
    encoding: "utf8",
  });
  if (xml.status !== 0) throw new Error("OOXML 표본 위치 확인 실패");
  const rawLocations = JSON.parse(xml.stdout);
  const pdf = results[0].productionParser;
  const checks = {
    pdfPageOneCondition:
      pdf?.chunks?.some(
        (item) =>
          item.locator.kind === "pdf" &&
          item.locator.page === 1 &&
          item.text.includes("30초"),
      ) ?? false,
    pdfPageOneNegation:
      pdf?.chunks?.some(
        (item) =>
          item.locator.kind === "pdf" &&
          item.locator.page === 1 &&
          item.text.includes("표시하면 안 된다"),
      ) ?? false,
    pdfPageTwoUnit:
      pdf?.chunks?.some(
        (item) =>
          item.locator.kind === "pdf" &&
          item.locator.page === 2 &&
          item.text.includes("60초"),
      ) ?? false,
    scanExplicitFailure: results[2].productionParser?.status === "rejected",
    brokenExplicitFailure: results[3].productionParser?.status === "rejected",
    docxNegation:
      results[4].officeParser.text?.includes("최신 값으로 표시하면 안 된다") ??
      false,
    docxTableValues: ["새봄시", "30초", "겨울시", "10초"].every((value) =>
      results[4].officeParser.text?.includes(value),
    ),
    pptxSpeakerNote:
      results[5].officeParser.text?.includes(
        "발표자 주석: 반영 완료가 아니라 검토 중이다",
      ) ?? false,
  };
  const report = {
    evaluatedAt: new Date().toISOString(),
    scope:
      "직접 작성한 개발 표본 6개. 실제 고객 문서 품질과 OCR은 평가하지 않음.",
    versions: {
      node: process.version,
      pdfParse: "2.4.5",
      officeParser: "7.8.0",
      officePdfJsOverride: "6.3.289",
    },
    checks,
    results,
    rawLocations,
  };
  writeFileSync(
    process.env.PARSER_EVALUATION_OUTPUT ?? `${root}/results.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (Object.values(checks).some((value) => !value))
    throw new Error("파서 표본 검증 실패: results.json 확인");
  console.log(
    `개발 표본 ${files.length}개, 필수 보존 검사 ${Object.keys(checks).length}개 통과`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
