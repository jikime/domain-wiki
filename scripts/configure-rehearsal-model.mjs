import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import nextEnv from "@next/env";
import { deployment } from "./lib/deployment.mjs";

nextEnv.loadEnvConfig(process.cwd());
const { getServerEnv } = await import("../src/server/env.ts");
const profile = process.argv[2];
assert(profile?.startsWith("wiki-stage16-"));
const target = deployment(profile),
  source = getServerEnv();
for (const [name, value] of Object.entries(source))
  if (name.startsWith("AI_") || name === "JOB_LEASE_SECONDS")
    target.env[name] = value === undefined ? "" : String(value);
for (const value of Object.values(target.env))
  assert(!/[\r\n'$]/.test(value), "환경 값의 안전한 직렬화를 확인하세요.");
writeFileSync(
  target.file,
  Object.entries(target.env)
    .map(([name, value]) => `${name}='${value}'\n`)
    .join(""),
  { mode: 0o600 },
);
console.log(
  "평가 전용 웹·작업자 모델 설정을 저장했습니다. 비밀값은 출력하지 않습니다.",
);
