import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import { sourceVersion } from "@/server/db/schema";
import type { FolderImageInput } from "@/server/parsers/folder-markdown";
import { originals } from "@/server/storage/originals";
// These references were authorized and frozen when the document was uploaded.
// Each extracted image becomes a document-owned copy, like an embedded DOCX image.
export async function loadFolderMedia(
  version: typeof sourceVersion.$inferSelect,
  signal: AbortSignal,
) {
  const images: FolderImageInput[] = [],
    warnings: string[] = [];
  const ids = version.folderMedia.flatMap((item) =>
    item.versionId ? [item.versionId] : [],
  );
  const rows = ids.length
    ? await getDb()
        .select()
        .from(sourceVersion)
        .where(
          and(
            eq(sourceVersion.workspaceId, version.workspaceId),
            inArray(sourceVersion.id, ids),
          ),
        )
    : [];
  let total = 0;
  for (const item of version.folderMedia) {
    signal.throwIfAborted();
    try {
      const original = rows.find(
        (row) =>
          row.id === item.versionId &&
          row.sha256 === item.sha256 &&
          row.mimeType.startsWith("image/"),
      );
      if (!original) throw new Error("missing image");
      total += original.byteSize;
      if (total > 100 * 1024 * 1024) throw new Error("image limit");
      const bytes = await originals.read(original.storageKey);
      if (createHash("sha256").update(bytes).digest("hex") !== item.sha256)
        throw new Error("image integrity");
      images.push({ ref: item.ref, bytes: bytes.toString("base64") });
    } catch {
      warnings.push(
        `연결 이미지 ${item.ref}를 가져오지 못했습니다. 같은 가져오기 폴더의 경로·제외 규칙·원본 파일을 확인해 다시 가져와 주세요.`,
      );
    }
  }
  return { images, warnings };
}
