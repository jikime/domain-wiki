import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
const source = await readFile(new URL("./init-local-db.mjs", import.meta.url));
async function run(t, code, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), "wiki-db-init-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "init.mjs"), source);
  for (const [name, body] of [
    ["@next/env", "export default { loadEnvConfig() {} }"],
    [
      "pg",
      `export default { Pool: class {
        async query() {
          throw Object.assign(new Error('secret-password-in-driver-message'), {code: process.env.MOCK_CODE});
        }
        async end() { console.log('POOL_CLOSED'); }
      }};`,
    ],
  ]) {
    const folder = join(dir, "node_modules", name);
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "package.json"),
      JSON.stringify({ name, type: "module", main: "index.js" }),
    );
    await writeFile(join(folder, "index.js"), body);
  }
  try {
    await execute(process.execPath, [join(dir, "init.mjs")], {
      cwd: dir,
      env: {
        ...process.env,
        POSTGRES_PASSWORD: "secret-password-in-driver-message",
        APP_DB_PASSWORD: "test-app-password",
        DB_PORT: "55433",
        MOCK_CODE: code,
        ...overrides,
      },
      timeout: 5000,
    });
    assert.fail("초기화 실패를 예상했습니다");
  } catch (error) {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /POOL_CLOSED/);
    assert.doesNotMatch(error.stderr, /secret-password-in-driver-message/);
    return error.stderr;
  }
}

test("인증 실패는 원인과 데이터 보존 안내만 출력하고 비밀 값을 숨긴다", async (t) => {
  const output = await run(t, "28P01");
  assert.match(output, /28P01.*관리자 연결/);
  assert.match(output, /비밀번호 인증/);
  assert.match(output, /볼륨을 삭제하지/);
});
test("연결 거부는 비밀번호 오류와 구분한다", async (t) => {
  const output = await run(t, "ECONNREFUSED");
  assert.match(output, /DB_PORT/);
  assert.doesNotMatch(output, /비밀번호 인증/);
});
test("필수 설정과 잘못된 포트는 연결 시도 전에 구분한다", async (t) => {
  assert.match(
    await run(t, "28P01", { APP_DB_PASSWORD: "" }),
    /LOCAL_DB_PASSWORD_MISSING.*환경 설정/,
  );
  assert.match(
    await run(t, "28P01", { DB_PORT: "abc" }),
    /LOCAL_DB_PORT_INVALID.*환경 설정/,
  );
});
test("알 수 없는 오류의 메시지와 유효하지 않은 코드를 노출하지 않는다", async (t) => {
  assert.match(await run(t, "secret-password-in-driver-message"), /UNKNOWN/);
});
