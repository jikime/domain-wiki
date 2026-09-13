import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
async function main() {
  const { getServerEnv } = await import("../src/server/env");
  getServerEnv();
  const { searchProviderConfigs } = await import(
    "../src/server/research/search"
  );
  searchProviderConfigs();
  console.log("서버 환경 변수 검사 통과");
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "환경 변수 검사 실패");
  process.exitCode = 1;
});
