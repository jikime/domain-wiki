import "server-only";
import { posix } from "node:path";
import { markdownReferences, nativeWikiLinks } from "@/lib/wiki-links";
import {
  buildWikiReferenceIndex,
  normalizeWikiReference,
} from "@/lib/wiki-reference-index";
import { knowledgeSql } from "@/server/ai/knowledge-index";
import { getPool } from "@/server/db";
import type { ChatScope } from "@/server/db/schema";

export async function publishedWikiReferences(
  w: string,
  scope: Partial<ChatScope> = {},
) {
  const result = await getPool().query<{
    id: string;
    title: string;
    aliases: string;
    metadata: { path?: string };
  }>(
    `WITH allowed AS (${knowledgeSql}) SELECT a.id,a.title,a.aliases,v.metadata FROM allowed a JOIN wiki_version v ON v.id=a.version_id WHERE a.kind='wiki' ORDER BY a.id`,
    [
      w,
      scope.domainId ?? null,
      scope.projectId ?? null,
      scope.sourceId ?? null,
      scope.wikiId ?? null,
    ],
  );
  return buildWikiReferenceIndex(
    result.rows.map((r) => ({
      id: r.id,
      title: r.title,
      metadata: { aliases: JSON.parse(r.aliases), path: r.metadata?.path },
    })),
  );
}
export async function wikiLinkDestinations(
  w: string,
  markdown: string,
  scope: Partial<ChatScope>,
  currentPath?: string,
  draftAccess?: { userId: string; reviewer: boolean },
) {
  const links = nativeWikiLinks(markdown);
  const plainLinks = markdownReferences(markdown).urls.filter(
    (url) => !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url),
  );
  if (!links.length && !plainLinks.length) return {};
  const index = await publishedWikiReferences(w, scope);
  if (draftAccess) {
    const candidates = await getPool().query<{
      id: string;
      title: string;
      metadata: { aliases?: string[]; path?: string };
    }>(
      `SELECT DISTINCT ON (p.id) p.id,v.title,v.metadata FROM wiki_page p JOIN wiki_version v ON v.page_id=p.id
       WHERE p.workspace_id=$1 AND ($2::uuid IS NULL OR p.domain_id=$2)
         AND ($3::uuid IS NULL OR p.project_id=$3 OR p.project_id IS NULL)
         AND ($4::boolean OR v.author_id=$5) ORDER BY p.id,v.number DESC`,
      [
        w,
        scope.domainId ?? null,
        scope.projectId ?? null,
        draftAccess.reviewer,
        draftAccess.userId,
      ],
    );
    const privateIndex = buildWikiReferenceIndex(candidates.rows);
    for (const [key, id] of privateIndex) {
      if (!index.has(key)) index.set(key, id);
      else if (index.get(key) !== id) index.set(key, null);
    }
  }
  const destinations = Object.fromEntries(
    links.map(({ target }) => {
      const [name, heading] = target.split("#");
      const id = index.get(normalizeWikiReference(name));
      return [
        `#${encodeURIComponent(target)}`,
        id
          ? `/w/${w}/wiki/${id}${heading ? `#${encodeURIComponent(heading)}` : ""}`
          : `/w/${w}/wiki?q=${encodeURIComponent(name)}${scope.domainId ? `&domainId=${scope.domainId}` : ""}`,
      ];
    }),
  );
  for (const url of plainLinks) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(url);
    } catch {
      continue;
    }
    const [name, heading] = decoded.split("#");
    const id =
      index.get(normalizeWikiReference(name)) ??
      (currentPath
        ? index.get(
            normalizeWikiReference(
              posix.normalize(posix.join(posix.dirname(currentPath), name)),
            ),
          )
        : undefined);
    if (id)
      destinations[url] =
        `/w/${w}/wiki/${id}${heading ? `#${encodeURIComponent(heading)}` : ""}`;
  }
  return destinations;
}
