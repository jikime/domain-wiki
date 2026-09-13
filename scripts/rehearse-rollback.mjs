import assert from "node:assert/strict";
import { deployment, execute } from "./lib/deployment.mjs";

const profile = process.argv[2];
if (!profile?.startsWith("wiki-stage7"))
  throw new Error("7단계 리허설 환경만 실행할 수 있습니다.");
const before = deployment(profile);
const counts = before.tableCounts();
let rejected = false;
try {
  execute(process.execPath, [
    "scripts/deploy.mjs",
    "image",
    profile,
    "node:22.23.1-bookworm-slim",
  ]);
  try {
    deployment(profile).compose([
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "12",
      "web",
      "worker",
    ]);
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true);
} finally {
  execute(process.execPath, [
    "scripts/deploy.mjs",
    "image",
    profile,
    before.env.APP_IMAGE,
  ]);
  execute(process.execPath, ["scripts/deploy.mjs", "up", profile]);
}
assert.deepEqual(deployment(profile).tableCounts(), counts);
console.log(
  "잘못된 앱 이미지의 health 실패 → 이전 이미지 복귀 → DB 행 수 보존 통과",
);
