import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const launcher = resolve("scripts/dev-all.mjs");
const fixture = `
import { appendFileSync } from 'node:fs';
const name=process.argv[3];
appendFileSync('events',name+' '+process.pid+'\\n');
if(name==='db:up' && process.env.SCENARIO!=='cancel-db') {
 process.exit(process.env.SCENARIO==='db-fail'?7:0);
}
if(name==='worker' && process.env.SCENARIO==='worker-fail') {
 setTimeout(()=>process.exit(9),100);
} else { setInterval(()=>{},1000); }
process.on('SIGTERM',()=>process.exit(0));
`;
async function scenario(t, mode, envFile = true) {
  const dir = await mkdtemp(join(tmpdir(), "wiki-dev-all-"));
  if (envFile) await writeFile(join(dir, ".env.local"), "");
  for (const name of ["@next/env", "pg", "next", "tsx"]) {
    if (mode === "missing-package" && name === "@next/env") continue;
    const location = join(dir, "node_modules", name);
    await mkdir(location, { recursive: true });
    await writeFile(
      join(location, "package.json"),
      JSON.stringify({ name, main: "index.js" }),
    );
    await writeFile(join(location, "index.js"), "");
  }
  await writeFile(join(dir, "npm.mjs"), fixture);
  const child = spawn(process.execPath, [launcher], {
    cwd: dir,
    env: { ...process.env, npm_execpath: join(dir, "npm.mjs"), SCENARIO: mode },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (x) => {
    output += x;
  });
  child.stderr.on("data", (x) => {
    output += x;
  });
  let ended = false;
  const exit = new Promise((resolve) =>
    child.on("close", (code) => {
      ended = true;
      resolve(code);
    }),
  );
  async function events() {
    try {
      return (await readFile(join(dir, "events"), "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split(" "));
    } catch {
      return [];
    }
  }
  t.after(async () => {
    if (!ended) {
      child.kill("SIGTERM");
      await Promise.race([exit, delay(12000)]);
    }
    for (const [, pid] of await events()) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {}
    }
    if (!ended) child.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  });
  return { child, exit, events, output: () => output };
}
async function until(check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  throw new Error("준비 상태 대기 시간 초과");
}
function gone(pid) {
  try {
    process.kill(Number(pid), 0);
    return false;
  } catch {
    return true;
  }
}

test(
  "DB 완료 뒤 앱 둘을 시작하고 Ctrl+C로 모두 종료한다",
  { timeout: 15000 },
  async (t) => {
    const s = await scenario(t, "normal");
    await until(async () => (await s.events()).length === 3);
    const events = await s.events();
    assert.equal(events[0][0], "db:up");
    assert.deepEqual(
      events
        .slice(1)
        .map((e) => e[0])
        .sort(),
      ["dev", "worker"],
    );
    s.child.kill("SIGINT");
    assert.equal(await s.exit, 130);
    for (const [, pid] of events) assert.ok(gone(pid));
  },
);
test(
  "DB 실패 시 웹 서버와 작업자를 시작하지 않는다",
  { timeout: 15000 },
  async (t) => {
    const s = await scenario(t, "db-fail");
    assert.equal(await s.exit, 7);
    assert.deepEqual(
      (await s.events()).map((e) => e[0]),
      ["db:up"],
    );
  },
);
test("작업자 실패 시 웹 서버도 종료한다", { timeout: 15000 }, async (t) => {
  const s = await scenario(t, "worker-fail");
  assert.equal(await s.exit, 9);
  const events = await s.events();
  assert.equal(events.length, 3);
  for (const [, pid] of events) assert.ok(gone(pid));
});
test(
  "DB 준비 중 취소하면 앱을 시작하지 않는다",
  { timeout: 15000 },
  async (t) => {
    const s = await scenario(t, "cancel-db");
    await until(async () => (await s.events()).length === 1);
    s.child.kill("SIGINT");
    assert.equal(await s.exit, 130);
    assert.deepEqual(
      (await s.events()).map((e) => e[0]),
      ["db:up"],
    );
  },
);
test(
  "첫 설정이 없으면 DB 명령을 실행하지 않는다",
  { timeout: 15000 },
  async (t) => {
    const s = await scenario(t, "normal", false);
    assert.equal(await s.exit, 1);
    assert.equal((await s.events()).length, 0);
    assert.match(s.output(), /첫 설치/);
  },
);
test(
  "패키지가 빠졌으면 npm ci를 안내하고 DB를 실행하지 않는다",
  { timeout: 15000 },
  async (t) => {
    const s = await scenario(t, "missing-package");
    assert.equal(await s.exit, 1);
    assert.equal((await s.events()).length, 0);
    assert.match(s.output(), /@next\/env/);
    assert.match(s.output(), /npm ci/);
    assert.doesNotMatch(s.output(), /DB 준비가 실패/);
  },
);
