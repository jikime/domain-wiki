// DB adapter for upstream wiki-page-resolver.ts path/slug/alias resolution.
// Unlike a file tree, a workspace may contain duplicate names; ambiguous names
// stay unresolved so one domain's page cannot silently replace another's.
export type WikiReferencePage = {
  id: string;
  title: string;
  metadata?: { aliases?: string[]; path?: string };
};
export const normalizeWikiReference = (value: string) =>
  value
    .normalize("NFKC")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\.md$/gi, "")
    .toLowerCase();
export function wikiTitleSlug(title: string) {
  return title
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
export function buildWikiReferenceIndex(pages: WikiReferencePage[]) {
  const index = new Map<string, string | null>();
  for (const page of pages) {
    const path = page.metadata?.path;
    for (const name of [
      page.title,
      wikiTitleSlug(page.title),
      ...(page.metadata?.aliases ?? []),
      ...(path
        ? [path, path.replace(/^wiki\//, ""), path.split("/").at(-1) ?? ""]
        : []),
    ]) {
      const key = normalizeWikiReference(name);
      if (!key) continue;
      if (!index.has(key)) index.set(key, page.id);
      else if (index.get(key) !== page.id) index.set(key, null);
    }
  }
  for (const page of pages) index.set(page.id, page.id);
  return index;
}
