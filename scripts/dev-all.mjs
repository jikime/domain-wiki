import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(".env.local")) {
  console.error(
    "프로젝트에서 npm run dev:all로 실행하세요. 첫 설치는 docs/training/getting-started.md에 따라 .env.local·DB·계정을 준비해 주세요.",
  );
  process.exit(1);
}

const requireFromProject = createRequire(resolve("package.json"));
const missing = [
  "@next/env",
  "pg",
  "next/package.json",
  "tsx/package.json",
].filter((name) => {
  try {
    requireFromProject.resolve(name);
    return false;
  } catch {
    return true;
  }
});
if (missing.length) {
  console.error("프로젝트 실행에 필요한 패키지가 설치되지 않았습니다.");
  console.error(`누락: ${missing.join(", ")}`);
  console.error(
    "이 폴더에서 npm ci를 실행한 뒤 npm run dev:all로 다시 시작하세요.",
  );
  process.exit(1);
}

const windows = process.platform === "win32";
const children = new Set();
let stopping = false;
let finish;
const finished = new Promise((resolve) => {
  finish = resolve;
});

function alive(child) {
  if (!child.pid) return false;
  if (windows) return child.exitCode === null && child.signalCode === null;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function terminate(child, signal) {
  if (!child.pid) return;
  if (windows) {
    // npm uses cmd.exe on Windows. Stop only this launch's process tree.
    await new Promise((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/T", "/F"],
        {
          stdio: "ignore",
        },
      );
      killer.once("error", resolve);
      killer.once("close", resolve);
    });
  } else {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") {
        console.error("실행한 프로세스의 종료 상태를 확인해 주세요.");
      }
    }
  }
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  console.log("실행한 프로그램을 종료합니다. DB는 켜 둡니다.");
  const owned = [...children];
  await Promise.all(owned.map((child) => terminate(child, "SIGTERM")));
  const deadline = Date.now() + 10000;
  while (owned.some(alive) && Date.now() < deadline) await delay(100);
  await Promise.all(
    owned.filter(alive).map((child) => terminate(child, "SIGKILL")),
  );
  process.exitCode = code;
  finish();
}

process.on("SIGINT", () => void stop(130));
process.on("SIGTERM", () => void stop(143));

function launch(script) {
  console.log(`[실행] npm run ${script}`);
  // Invoke npm's JS entry directly, avoiding .cmd quoting on Windows.
  const child = spawn(process.execPath, [npmCli, "run", script], {
    stdio: "inherit",
    detached: !windows,
  });
  children.add(child);
  const done = new Promise((resolve) => {
    child.once("error", () => {
      console.error(`${script} 실행에 실패했습니다.`);
      resolve(1);
    });
    child.once("close", (code) => resolve(code ?? 1));
  });
  return { child, done };
}

const database = launch("db:up");
const dbCode = await database.done;
if (!stopping && dbCode !== 0) {
  console.error(
    "DB 시작 또는 초기화가 실패했습니다. 위에 표시된 오류를 확인하세요.",
  );
  await stop(dbCode);
} else if (!stopping) {
  children.delete(database.child);
  console.log(
    "웹 서버·작업자를 시작합니다. 준비 로그를 확인한 뒤 http://localhost:3010 으로 접속하세요. 종료: Ctrl+C",
  );
  for (const script of ["dev", "worker"]) {
    const running = launch(script);
    void running.done.then(async (code) => {
      if (stopping) return;
      console.error(`${script}가 종료되어 함께 실행한 프로그램도 정리합니다.`);
      await stop(code || 1);
    });
  }
}
await finished;
