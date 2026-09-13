import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

// 사용자가 지정한 프로젝트 루트의 raw/sources와 wiki만 읽습니다.
const root = resolve(process.argv[2] ?? "");
const items = [];
const skipped = [];
async function walk(directory) {
  const info = await lstat(directory).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return;
  if (info.isSymbolicLink()) {
    skipped.push({
      path: relative(root, directory),
      reason: "심볼릭 링크 제외",
    });
    return;
  }
  if (info.isDirectory()) {
    for (const name of (await readdir(directory)).sort())
      await walk(join(directory, name));
    return;
  }
  if (!info.isFile()) return;
  if (info.size > 25 * 1024 * 1024) {
    skipped.push({
      path: relative(root, directory),
      reason: "25MB 초과, 별도 조사 필요",
    });
    return;
  }
  const bytes = await readFile(directory);
  const path = relative(root, directory).replaceAll("\\", "/");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  items.push({
    path,
    bytes: bytes.length,
    sha256,
    kind: path.startsWith("raw/sources/") ? "source" : "wiki",
    proposedState: "검토 대기",
    identity: createHash("sha256").update(path).digest("hex"),
  });
}
try {
  if (!process.argv[2])
    throw new Error(
      "사용법: node scripts/inventory-legacy.mjs 기존프로젝트경로",
    );
  if ((await realpath(root)) !== root)
    throw new Error("심볼릭 링크가 아닌 실제 프로젝트 경로를 지정하세요.");
  const raw = join(root, "raw");
  const rawInfo = await lstat(raw).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (rawInfo?.isSymbolicLink())
    skipped.push({ path: "raw", reason: "심볼릭 링크 제외" });
  else await walk(join(raw, "sources"));
  await walk(join(root, "wiki"));
  console.log(
    JSON.stringify(
      {
        version: 1,
        sourceCount: items.filter((x) => x.kind === "source").length,
        wikiCount: items.filter((x) => x.kind === "wiki").length,
        decision:
          items.length || skipped.length
            ? "내용·근거·승인 이력 조사 후 이관 규칙 확정 필요"
            : "지정 경로에 이관 데이터 없음",
        items,
        skipped,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
