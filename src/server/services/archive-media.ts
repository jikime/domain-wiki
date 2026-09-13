import "server-only";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import {
  resolveArchiveReference,
  rewriteMarkdownUrls,
} from "@/lib/archive-markdown";
import { MAX_FILE_BYTES } from "@/lib/content";
import { AccessError, requireWorkspace } from "@/server/access";
import { getDb } from "@/server/db";
import { archiveFile, wikiPage, wikiVersion } from "@/server/db/schema";
import { originals } from "@/server/storage/originals";
import { isWriter, parseId, validEvidenceSql } from "./content-access";

const rasterPath = /\.(?:png|jpe?g|gif|webp|avif)$/i;
function referencedMedia(body: string, pagePath: string, paths: Set<string>) {
  const used = new Map<string, string>();
  const add = (url: string) => {
    const path = resolveArchiveReference(pagePath, url, paths);
    if (path) used.set(url, path);
    return undefined;
  };
  rewriteMarkdownUrls(body, add);
  for (const match of body.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g))
    add(match[1]);
  return used;
}

export async function archiveMediaDestinations(
  w: string,
  domainId: string,
  pagePath: string | undefined,
  versionId: string,
  body: string,
) {
  if (!pagePath) return {};
  const media = await getDb()
    .select({ id: archiveFile.id, path: archiveFile.path })
    .from(archiveFile)
    .where(
      and(eq(archiveFile.workspaceId, w), eq(archiveFile.domainId, domainId)),
    );
  const byPath = new Map(
    media.filter((f) => rasterPath.test(f.path)).map((f) => [f.path, f.id]),
  );
  return Object.fromEntries(
    [...referencedMedia(body, pagePath, new Set(byPath.keys()))].map(
      ([url, path]) => [
        url,
        `/api/workspaces/${w}/archive-files/${byPath.get(path)}?version=${versionId}`,
      ],
    ),
  );
}

export async function archiveImageFile(
  h: Headers,
  w: string,
  id: string,
  versionId: string,
) {
  const context = await requireWorkspace(h, w);
  const [file] = await getDb()
    .select()
    .from(archiveFile)
    .where(
      and(eq(archiveFile.id, parseId(id)), eq(archiveFile.workspaceId, w)),
    );
  const [record] = await getDb()
    .select({
      page: wikiPage,
      version: wikiVersion,
      valid: validEvidenceSql(wikiVersion.id).as("valid"),
    })
    .from(wikiVersion)
    .innerJoin(wikiPage, eq(wikiPage.id, wikiVersion.pageId))
    .where(
      and(
        eq(wikiVersion.workspaceId, w),
        eq(wikiVersion.id, parseId(versionId)),
      ),
    );
  const privateAccess =
    record &&
    (context.role === "reviewer" ||
      (isWriter(context) && record.version.authorId === context.user.id));
  const publicAccess =
    record &&
    record.page.publishedVersionId === record.version.id &&
    record.version.state === "approved" &&
    record.valid;
  if (
    !file ||
    !record ||
    (!privateAccess && !publicAccess) ||
    file.domainId !== record.page.domainId ||
    !rasterPath.test(file.path) ||
    file.byteSize > MAX_FILE_BYTES ||
    ![
      ...referencedMedia(
        record.version.body,
        record.version.metadata.path ?? "",
        new Set([file.path]),
      ).values(),
    ].includes(file.path)
  )
    throw new AccessError(404, "그림을 찾을 수 없습니다.");
  const bytes = await originals.read(file.storageKey);
  let format: string | undefined;
  try {
    format = (await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata())
      .format;
  } catch {
    throw new AccessError(415, "그림 형식을 확인해 주세요.");
  }
  if (
    !format ||
    !["png", "jpeg", "gif", "webp", "avif", "heif"].includes(format)
  )
    throw new AccessError(415, "표시할 수 있는 그림 형식이 아닙니다.");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": `image/${format === "heif" ? "avif" : format}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
