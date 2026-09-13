// Deliberate image-start failure on the new restored rehearsal only.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { deployment, execute } from "./lib/deployment.mjs";

const [profile] = process.argv.slice(2);
assert.equal(profile, "wiki-stage16-restored");
const t = deployment(profile);
const missing = "my-domain-wiki:stage16-deliberately-missing";
assert.equal(execute("docker", ["image", "ls", "-q", missing]), "");
const counts = t.tableCounts();
const fingerprints = Object.fromEntries(
  Object.keys(counts).map((name) => [
    name,
    t.sql(
      `SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)),'')) FROM public."${name}" t`,
    ),
  ]),
);
let rejected = false;
try {
  t.compose(["up", "-d", "--no-deps", "--pull", "never", "web"], {
    env: { ...process.env, APP_IMAGE: missing },
  });
} catch {
  rejected = true;
}
assert.equal(rejected, true);
assert.deepEqual(t.tableCounts(), counts);
for (const [name, fingerprint] of Object.entries(fingerprints))
  assert.equal(
    t.sql(
      `SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)),'')) FROM public."${name}" t`,
    ),
    fingerprint,
  );
t.compose(["up", "-d", "--wait", "web", "worker"]);
const health = await fetch(`${t.env.BETTER_AUTH_URL}/api/health`);
assert.equal(health.status, 200);
const imageId = execute("docker", [
  "inspect",
  t.compose(["ps", "-q", "web"]),
  "--format",
  "{{.Image}}",
]);
assert.equal(
  imageId,
  execute("docker", [
    "image",
    "inspect",
    t.env.APP_IMAGE,
    "--format",
    "{{.Id}}",
  ]),
);
writeFileSync(
  "docs/evaluation/core/deployment-16/failed-release-recovery.json",
  `${JSON.stringify({ date: new Date().toISOString(), profile, failedImage: missing, pullDisabled: true, rejected, databaseTablesUnchanged: Object.keys(counts).length, recoveredImage: t.env.APP_IMAGE, recoveredImageId: imageId, health: health.status, limitation: "별도 복원 환경에서 잘못된 이미지 기동 실패 후 검증된 동일 스키마 이미지로 복귀. 파괴적 스키마 변경의 역마이그레이션 시험이 아니다." }, null, 2)}\n`,
);
console.log(
  "새 복원 환경의 잘못된 이미지 기동 거부·DB 보존·검증 이미지 복귀 확인",
);
