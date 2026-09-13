import { z } from "zod";
import { safeRelativePath } from "./source-formats";

// llm_wiki commands/project_maintenance.rs archive limits.
export const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 100_000;
export const ARCHIVE_MANIFEST = ".domain-wiki/manifest.json";
export const aggregatePaths = new Set([
  "wiki/index.md",
  "wiki/overview.md",
  "wiki/log.md",
]);
export function archivePath(value: string) {
  if (value.includes("\\") || value.startsWith("./")) return null;
  return safeRelativePath(value);
}
const projectRef = z.string().max(100).nullable().default(null);
export const archiveManifestSchema = z.object({
  format: z.literal("my-domain-wiki"),
  version: z.literal(1),
  domain: z
    .object({
      name: z.string().max(100),
      purpose: z.string().max(3000),
      recordTemplate: z.string().max(5000).optional(),
    })
    .optional(),
  projects: z
    .array(
      z.object({
        id: z.string().max(100),
        name: z.string().min(1).max(150),
        clientName: z.string().max(150),
        description: z.string().max(3000),
      }),
    )
    .max(MAX_ARCHIVE_ENTRIES)
    .default([]),
  sources: z
    .array(
      z.object({
        path: z.string().max(500),
        title: z.string().max(160),
        projectId: projectRef,
        category: z.enum(["guideline", "project", "reference"]),
        originUrl: z.string().max(4000).nullable().optional(),
      }),
    )
    .max(MAX_ARCHIVE_ENTRIES)
    .default([]),
  pages: z
    .array(z.object({ path: z.string().max(500), projectId: projectRef }))
    .max(MAX_ARCHIVE_ENTRIES)
    .default([]),
});
export type ArchiveManifest = z.infer<typeof archiveManifestSchema>;

export function nativePagePath(id: string, path?: string) {
  return path &&
    archivePath(path) &&
    path.startsWith("wiki/") &&
    path.endsWith(".md") &&
    !aggregatePaths.has(path)
    ? path
    : `wiki/pages/${id}.md`;
}

// Mirrors project_maintenance.rs: group by frontmatter type, sort by title.
export function rebuildNativeIndex(
  pages: { path: string; title: string; type: string }[],
) {
  const groups = new Map<string, typeof pages>();
  for (const page of pages) {
    if (aggregatePaths.has(page.path)) continue;
    const items = groups.get(page.type) ?? [];
    items.push(page);
    groups.set(page.type, items);
  }
  let output = "# Wiki Index\n\n";
  for (const [kind, items] of [...groups].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    output += `## ${kind}\n\n`;
    for (const page of items.sort((a, b) =>
      a.title.toLowerCase() < b.title.toLowerCase()
        ? -1
        : a.title.toLowerCase() > b.title.toLowerCase()
          ? 1
          : 0,
    ))
      output += `- [[${page.path.replace(/^wiki\//, "").replace(/\.md$/i, "")}|${page.title.replace(/[\]\n\r|]/g, " ")}]]\n`;
    output += "\n";
  }
  return output;
}
