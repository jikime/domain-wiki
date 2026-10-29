import nextEnv from "@next/env";
import pg from "pg";
import {
  checkTrainingData,
  installTrainingBundle,
  localAccounts,
  localDatabase,
  readBundle,
  removeCreatedFiles,
} from "./lib/training-samples.mjs";

nextEnv.loadEnvConfig(process.cwd());
const mode = process.argv[2];
let client;
let committed = false;
const createdFiles = [];
try {
  if (
    !["install", "check"].includes(mode) ||
    process.argv.length > (mode === "install" ? 4 : 3)
  )
    throw new Error(
      "사용법: npm run db:seed-training [-- 샘플백업.json] 또는 npm run db:check-training",
    );
  const bundle = mode === "install" ? await readBundle(process.argv[3]) : null;
  client = new pg.Client({
    connectionString: localDatabase(process.env),
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
  await client.connect();
  await client.query(mode === "check" ? "BEGIN READ ONLY" : "BEGIN");
  const accounts = await localAccounts(client);
  const originalsDir = process.env.ORIGINALS_DIR || ".local/originals";
  if (mode === "install") {
    const result = await installTrainingBundle(client, bundle, {
      ...accounts,
      originalsDir,
      createdFiles,
    });
    if (!result.created) {
      console.log(
        "같은 이름의 교육용 도메인이 이미 있습니다. 기존 자료와 실습 결과를 유지했습니다.",
      );
      console.log(
        "초기 상태 확인: npm run db:check-training. 누락이 있어도 기존 도메인을 자동으로 덮어쓰지 않습니다.",
      );
    } else {
      const summary = await checkTrainingData(
        client,
        accounts.workspaceId,
        originalsDir,
      );
      console.log(
        `샘플 준비 완료: 프로젝트 ${summary.projects.length}개 · 자료 ${summary.sources}건 · 문단 ${summary.chunks}개 · 게시 위키 ${summary.wikiPages}건`,
      );
      console.log(
        "홈에서 ‘가상 교통관제 자료’를 선택하세요. 로그인 정보는 기존 개인 계정을 그대로 사용합니다.",
      );
    }
  } else {
    const summary = await checkTrainingData(
      client,
      accounts.workspaceId,
      originalsDir,
    );
    console.log(
      `샘플 확인 완료: 자료 ${summary.sources}건 · 문단 ${summary.chunks}개 · 게시 위키 ${summary.wikiPages}건, 원본 파일·근거 연결 정상`,
    );
  }
  await client.query("COMMIT");
  committed = true;
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => {});
  // DB 드라이버 오류에는 설정·원문이 포함될 수 있어 코드만 출력한다.
  const code = /^[A-Z0-9_]{2,40}$/.test(error.code ?? "") ? error.code : null;
  console.error(
    code
      ? `샘플 준비 실패 [${code}]. DB 실행·마이그레이션·원본 경로를 확인하세요.`
      : error.name === "ZodError"
        ? "샘플 백업의 형식이 맞지 않습니다. 저장소의 원본 파일을 확인하세요."
        : error.message,
  );
  process.exitCode = 1;
} finally {
  try {
    if (!committed) await removeCreatedFiles(createdFiles);
  } catch {
    console.error(
      "이번 실행에서 만든 원본 파일 일부를 정리하지 못했습니다. 강사와 저장 폴더의 권한을 확인하세요.",
    );
    process.exitCode = 1;
  } finally {
    if (client) await client.end();
  }
}
