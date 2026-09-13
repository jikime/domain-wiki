import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
async function main() {
  const { indexPublishedContent } = await import(
    "../src/server/ai/knowledge-index"
  );
  const { getPool } = await import("../src/server/db");
  try {
    await indexPublishedContent();
    console.log("이번 주기의 공개 자료 색인을 처리했습니다.");
  } finally {
    await getPool().end();
  }
}
main().catch(() => {
  console.error("공개 자료 색인에 실패했습니다. 모델·DB 설정을 확인하세요.");
  process.exitCode = 1;
});
