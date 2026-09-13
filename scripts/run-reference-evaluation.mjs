// Runs only the separately built reference copy. Real provider credentials stay in memory.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { getServerEnv } = await import("../src/server/env.ts"),
  env = getServerEnv();
const model = env.AI_CHAT_MODEL ?? env.AI_MODEL,
  key = env.AI_CHAT_API_KEY ?? env.AI_API_KEY,
  upstream = env.AI_CHAT_BASE_URL ?? env.AI_BASE_URL;
assert(model && key && upstream);
assert.equal(
  upstream.replace(/\/$/, ""),
  "https://api.openai.com/v1",
  "원본 기본 OpenAI 연결과 같은 주소가 필요합니다.",
);
const faithful = process.argv.includes("--faithful");
const clone = resolve(".local/reference-stage16"),
  out = faithful
    ? "docs/evaluation/core/reference-16-faithful"
    : "docs/evaluation/core/reference-16",
  secretPath = resolve(".local/reference-runtime-stage16.json"),
  appFolder = join(
    homedir(),
    "Library/Application Support/com.llmwiki.stage16",
  );
assert.equal(
  JSON.parse(readFileSync(join(clone, "src-tauri/tauri.conf.json"), "utf8"))
    .identifier,
  "com.llmwiki.stage16",
);
mkdirSync(out, { recursive: true });
const baseline = JSON.parse(
  readFileSync("docs/evaluation/core/baseline-09/results.json", "utf8"),
);
const runtime = existsSync(secretPath)
  ? JSON.parse(readFileSync(secretPath, "utf8"))
  : {
      token: randomBytes(32).toString("hex"),
      proxyToken: randomBytes(32).toString("hex"),
      projects: {},
    };
if (!Object.keys(runtime.projects).length) {
  assert(!existsSync(appFolder), "평가 전용 앱 설정이 이미 있습니다.");
  for (const scope of ["all", "spring", "winter"]) {
    const folder = resolve(`.local/reference-input-stage16/${scope}`),
      id = randomUUID();
    for (const sub of ["raw/sources", "wiki", ".llm-wiki"])
      mkdirSync(join(folder, sub), { recursive: true });
    const files =
      scope === "all"
        ? baseline.fixture.sourceFiles
        : scope === "spring"
          ? baseline.fixture.sourceFiles.slice(0, 2)
          : baseline.fixture.sourceFiles.slice(2);
    const inputs = [];
    for (const file of files) {
      const bytes = readFileSync(`docs/evaluation/sources/${file}`),
        hash = createHash("sha256").update(bytes).digest("hex");
      assert.equal(hash, baseline.fixture.sources[file].fileHash);
      writeFileSync(join(folder, "raw/sources", file), bytes);
      inputs.push({ file, sha256: hash });
    }
    if (scope !== "winter")
      writeFileSync(
        join(folder, "wiki/baseline.md"),
        "---\ntitle: 새봄시 관제 화면의 정상 갱신 조건\ntype: concept\nsources: [raw/sources/01-project-guide.md]\n---\n\n가상 새봄시 관제 시범사업에서는 정상 통신 상태일 때 관제 화면을 30초 간격으로 갱신합니다. 이 조건을 모든 사업의 법적 의무로 일반화하지 않습니다.\n",
      );
    writeFileSync(
      join(folder, ".llm-wiki/project.json"),
      JSON.stringify({ id, name: `고정 평가 ${scope}` }),
    );
    runtime.projects[scope] = {
      id,
      name: `고정 평가 ${scope}`,
      path: folder,
      inputs,
    };
  }
  writeFileSync(secretPath, JSON.stringify(runtime), {
    mode: 0o600,
    flag: "wx",
  });
}
mkdirSync(appFolder, { recursive: true, mode: 0o700 });
writeFileSync(
  join(appFolder, "app-state.json"),
  JSON.stringify({
    projectRegistry: Object.fromEntries(
      Object.values(runtime.projects).map((p) => [
        p.id,
        { name: p.name, path: p.path },
      ]),
    ),
    llmConfig: {
      provider: "openai",
      model,
      apiKey: key,
      customEndpoint: "",
      maxContextSize: 120000,
      maxTokens: 4096,
      streamingEnabled: true,
    },
    apiConfig: {
      enabled: true,
      mcpEnabled: false,
      token: runtime.token,
      allowUnauthenticated: false,
      allowLanAccess: false,
    },
    outputLanguage: "ko",
    sourceWatchConfig: { enabled: false, autoIngest: false },
  }),
  { mode: 0o600 },
);
const nativeLog = join(
  clone,
  faithful ? "native-faithful.log" : "native-run.log",
);
const calls = [];
function readCalls() {
  const lines = (
    existsSync(nativeLog) ? readFileSync(nativeLog, "utf8") : ""
  ).split("\n");
  const values = lines
    .filter((l) => l.startsWith("[stage16-usage] "))
    .map((l) => JSON.parse(l.slice("[stage16-usage] ".length)));
  calls.splice(0, calls.length, ...values);
  writeFileSync(
    `${out}/model-calls.json`,
    `${JSON.stringify(calls, null, 2)}\n`,
  );
}
readCalls();
const log = openSync(nativeLog, "a", 0o600),
  child = spawn(join(clone, "src-tauri/target/debug/llm-wiki"), [], {
    cwd: clone,
    stdio: ["ignore", log, log],
  });
const report = existsSync(`${out}/partial.json`)
  ? JSON.parse(readFileSync(`${out}/partial.json`, "utf8"))
  : {
      date: new Date().toISOString(),
      referenceVersion: "0.6.11",
      referenceGit: "8bcf9b52",
      model,
      transport:
        "원본 네이티브 앱의 API와 기본 OpenAI 연결. 별도 식별자·포트·프로젝트 폴더 사용. 응답 사용량 관측 로그만 복사본에 추가.",
      projects: runtime.projects,
      queries: [],
      businessReview: null,
    };
let currentQuestion = "";
try {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null)
      throw new Error("원본 복사본 프로세스가 종료됐습니다.");
    try {
      const r = await fetch("http://127.0.0.1:19838/api/v1/health");
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const headers = {
    Authorization: `Bearer ${runtime.token}`,
    "Content-Type": "application/json",
  };
  const available = await fetch("http://127.0.0.1:19838/api/v1/projects", {
    headers,
  });
  assert.equal(available.status, 200);
  for (const q of JSON.parse(
    readFileSync("docs/evaluation/questions.json", "utf8"),
  )) {
    if (report.queries.some((previous) => previous.id === q.id)) continue;
    if (faithful && !["Q02", "Q05", "Q08"].includes(q.id)) continue;
    currentQuestion = q.id;
    const scope =
        q.scope === "교통관제 업무"
          ? "all"
          : q.scope.includes("겨울")
            ? "winter"
            : "spring",
      project = runtime.projects[scope],
      sessionId = `stage16_${randomUUID()}`,
      begin = Date.now(),
      callStart = calls.length;
    let response;
    for (const message of [q.previousQuestion, q.question].filter(Boolean)) {
      const r = await fetch(
        `http://127.0.0.1:19838/api/v1/projects/${project.id}/chat`,
        {
          method: "POST",
          headers: { ...headers, Connection: "close" },
          body: JSON.stringify({
            message,
            sessionId,
            mode: "standard",
            retrievalMode: faithful ? "faithful" : "standard",
            includeContent: faithful,
            topK: 8,
            tools: { wiki: true, web: false, anytxt: false },
            persistSession: true,
            stream: false,
          }),
          signal: AbortSignal.timeout(180000),
        },
      );
      response = await r.json();
      assert.equal(r.status, 200, `원본 질문 ${q.id}: HTTP ${r.status}`);
    }
    readCalls();
    report.queries.push({
      id: q.id,
      question: q.question,
      scope,
      elapsedMs: Date.now() - begin,
      answer: response.message?.content,
      response,
      modelCalls: calls.slice(callStart),
    });
    writeFileSync(
      `${out}/partial.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      `${q.id}: 원본 응답 완료, ${Date.now() - begin}ms, 모델 ${calls.length - callStart}회`,
    );
  }
  report.retrievalMode = faithful ? "faithful" : "standard";
  report.completedAt = new Date().toISOString();
  report.calls = calls;
  writeFileSync(`${out}/results.json`, `${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  readCalls();
  report.failures ??= [];
  report.failures.push({
    question: currentQuestion,
    date: new Date().toISOString(),
    message: String(error.message).replaceAll(key, "[비밀값 삭제]"),
    code: error.cause?.code ?? null,
    exitCode: child.exitCode,
    signalCode: child.signalCode,
  });
  report.calls = calls;
  writeFileSync(`${out}/partial.json`, `${JSON.stringify(report, null, 2)}\n`);
  throw error;
} finally {
  if (child.exitCode === null && child.signalCode === null)
    await new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill("SIGTERM");
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000).unref();
    });
  const cleaned = JSON.parse(
    readFileSync(join(appFolder, "app-state.json"), "utf8"),
  );
  cleaned.llmConfig.apiKey = "";
  writeFileSync(join(appFolder, "app-state.json"), JSON.stringify(cleaned), {
    mode: 0o600,
  });
}
