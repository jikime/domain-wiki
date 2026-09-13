import { isPathAllowedBySourceWatch } from "./reference/source-watch-config";
import type { SourceWatchConfig } from "./reference/source-watch-types";
import { SOURCE_FORMATS, safeRelativePath } from "./source-formats";
export const isImportImage = (path: string) =>
  SOURCE_FORMATS[path.split(".").at(-1)?.toLowerCase() ?? ""]?.startsWith(
    "image/",
  ) ?? false;
// Companion images follow explicit exclusions and glob rules, even when the
// document extension picker only includes Markdown/PDF/Office files.
export function isPathAllowedForImport(
  path: string,
  config: SourceWatchConfig,
) {
  return isPathAllowedBySourceWatch(
    path,
    isImportImage(path) ? { ...config, includeExtensions: [] } : config,
  );
}
export type FolderMediaSnapshot = {
  ref: string;
  path: string | null;
  versionId: string | null;
  sha256: string | null;
};
export function folderMediaSignature(items: FolderMediaSnapshot[]) {
  return JSON.stringify(
    items.map(({ ref, path, sha256 }) => [ref, path, sha256]),
  );
}
export function folderImagePath(documentPath: string, ref: string) {
  const normalized = ref.replace(/\\/g, "/").normalize("NFC");
  if (/^(?:\/|[A-Za-z][A-Za-z0-9+.-]*:)/.test(normalized)) return null;
  const parts = documentPath.split("/").slice(0, -1);
  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return safeRelativePath(parts.join("/"));
}
