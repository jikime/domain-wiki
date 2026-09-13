import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [profile, backup] = process.argv.slice(2);
if (
  !/^wiki-stage(?:7|16)(?:-|$)/.test(profile ?? "") ||
  !/^\.local\/deploy\/backup-stage(?:7|16)(?:-|$)/.test(backup ?? "")
)
  throw new Error("7·16단계 복구 리허설만 실행할 수 있습니다.");
const folder = mkdtempSync(join(tmpdir(), "wiki-backup-guard-"));
function rejected(path, expected) {
  const r = spawnSync(
    process.execPath,
    ["scripts/restore.mjs", profile, path],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes(expected), r.stderr);
}
try {
  cpSync(backup, join(folder, "copy"), { recursive: true });
  const root = join(folder, "copy");
  const dump = join(root, "database.dump");
  const bytes = readFileSync(dump);
  writeFileSync(dump, Buffer.concat([bytes, Buffer.from("손상 시험")]));
  rejected(root, "DB 백업 해시가 일치하지 않습니다.");
  writeFileSync(dump, bytes);
  const manifest = JSON.parse(
    readFileSync(join(root, "manifest.json"), "utf8"),
  );
  writeFileSync(join(root, "originals", manifest.files[0].key), "변조된 원본");
  rejected(root, "원본 백업 해시가 일치하지 않습니다.");
  console.log("DB·원본 백업 변조는 DB 생성 전에 거부: 2개 검사 통과");
} finally {
  rmSync(folder, { recursive: true, force: true });
}
