import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "wiki-inventory-")));
try {
  mkdirSync(join(folder, "raw/sources"), { recursive: true });
  mkdirSync(join(folder, "wiki"));
  writeFileSync(join(folder, "raw/sources/원본.md"), "원문 보존 검사");
  writeFileSync(
    join(folder, "wiki/위키.md"),
    "---\nsources: [원본.md]\n---\n검토 전 위키",
  );
  symlinkSync(
    join(folder, "raw/sources/원본.md"),
    join(folder, "wiki/링크.md"),
  );
  const run = () => {
    const r = spawnSync(
      process.execPath,
      ["scripts/inventory-legacy.mjs", folder],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0);
    return JSON.parse(r.stdout);
  };
  const first = run();
  assert.deepEqual(run(), first);
  assert.equal(first.sourceCount, 1);
  assert.equal(first.wikiCount, 1);
  assert.equal(first.skipped.length, 1);
  assert.ok(first.items.every((x) => x.proposedState === "검토 대기"));
  assert.equal(
    readFileSync(join(folder, "raw/sources/원본.md"), "utf8"),
    "원문 보존 검사",
  );
  writeFileSync(join(folder, "raw/sources/원본.md"), "개정 내용");
  const changed = run();
  assert.equal(changed.items[0].identity, first.items[0].identity);
  assert.notEqual(changed.items[0].sha256, first.items[0].sha256);
  console.log(
    "읽기 전용 조사: 반복 결과·원본 보존·ID 유지·개정 해시·심볼릭 링크 제외 통과",
  );
} finally {
  rmSync(folder, { recursive: true, force: true });
}
