import "server-only";
import { and, desc, eq, getTableColumns, or, sql } from "drizzle-orm";
import { nativePagePath, rebuildNativeIndex } from "@/lib/project-archive";
import {
  buildDeterministicIngestLog,
  updateBoundedRecentIndexSection,
} from "@/lib/reference/aggregate-pages";
import { AccessError, requireWorkspace } from "@/server/access";
import { getDb } from "@/server/db";
import {
  domain,
  ingestRun,
  source,
  sourceVersion,
  wikiPage,
  wikiVersion,
} from "@/server/db/schema";
import {
  type ContentContext,
  checkScope,
  isWriter,
  validEvidenceSql,
} from "./content-access";

export async function projectContent(
  context: ContentContext,
  domainId: string,
  drafts = false,
) {
  const w = context.workspaceId;
  await checkScope(w, domainId, null);
  const [parent] = await getDb()
    .select()
    .from(domain)
    .where(and(eq(domain.id, domainId), eq(domain.workspaceId, w)));
  const manage = drafts && isWriter(context);
  const { body: _body, ...versionColumns } = getTableColumns(wikiVersion);
  const publicWiki = and(
    eq(wikiPage.publishedVersionId, wikiVersion.id),
    eq(wikiVersion.state, "approved"),
    validEvidenceSql(wikiVersion.id),
  );
  const publicSource = and(
    eq(source.publishedVersionId, sourceVersion.id),
    eq(sourceVersion.publication, "published"),
    eq(sourceVersion.processing, "completed"),
    sql`source_is_current(${sourceVersion.id})`,
  );
  const [pages, sources] = await Promise.all([
    getDb()
      .selectDistinctOn([wikiPage.id], {
        page: wikiPage,
        version: versionColumns,
      })
      .from(wikiPage)
      .innerJoin(wikiVersion, eq(wikiVersion.pageId, wikiPage.id))
      .where(
        and(
          eq(wikiPage.workspaceId, w),
          eq(wikiPage.domainId, domainId),
          manage
            ? context.role === "reviewer"
              ? undefined
              : or(eq(wikiVersion.authorId, context.user.id), publicWiki)
            : publicWiki,
        ),
      )
      .orderBy(wikiPage.id, desc(wikiVersion.number)),
    getDb()
      .selectDistinctOn([source.id], { source, version: sourceVersion })
      .from(source)
      .innerJoin(sourceVersion, eq(sourceVersion.sourceId, source.id))
      .where(
        and(
          eq(source.workspaceId, w),
          eq(source.domainId, domainId),
          manage
            ? context.role === "reviewer"
              ? undefined
              : or(eq(source.createdBy, context.user.id), publicSource)
            : publicSource,
        ),
      )
      .orderBy(source.id, desc(sourceVersion.number)),
  ]);
  const taken = new Set<string>();
  const ingests = sources.length
    ? await getDb()
        .select({
          versionId: ingestRun.sourceVersionId,
          date: ingestRun.updatedAt,
        })
        .from(ingestRun)
        .where(
          and(
            eq(ingestRun.workspaceId, w),
            eq(ingestRun.domainId, domainId),
            eq(ingestRun.state, "completed"),
            sql`${ingestRun.sourceVersionId}=ANY(${sql.param(sources.map((s) => s.version.id))}::uuid[])`,
          ),
        )
        .orderBy(ingestRun.updatedAt)
    : [];
  return {
    parent,
    sources,
    ingests,
    pages: pages.map((item) => {
      let path = nativePagePath(item.page.id, item.version.metadata.path);
      if (taken.has(path)) path = `wiki/pages/${item.page.id}.md`;
      // A user path can itself match the collision fallback.
      while (taken.has(path))
        path = path.replace(/\.md$/, `-${item.page.id}.md`);
      taken.add(path);
      return { ...item, path };
    }),
  };
}

export function catalogDocuments(
  data: Awaited<ReturnType<typeof projectContent>>,
) {
  const ordered = [...data.pages].sort(
    (a, b) => b.version.updatedAt.getTime() - a.version.updatedAt.getTime(),
  );
  const rebuilt = rebuildNativeIndex(
    data.pages.map((p) => ({
      path: p.path,
      title: p.version.title,
      type: p.version.metadata.type,
    })),
  );
  const index = ordered.length
    ? updateBoundedRecentIndexSection(
        rebuilt,
        ordered.map(
          (p) =>
            `- [[${p.path.replace(/^wiki\//, "").replace(/\.md$/, "")}]] — ${p.version.title.replace(/[\r\n]/g, " ")}`,
        ),
      )
    : rebuilt;
  const overview =
    data.parent.overviewMarkdown ||
    `---\ntype: overview\ntitle: Project Overview\n---\n\n<!-- Write a high-level overview of this project here. -->\n`;
  // Source identities are included only while the same source version is visible now.
  const events = [
    ...data.sources.map((s) => ({
      date: s.version.createdAt,
      text: `source | raw/${s.version.relativePath || `${s.source.id}/${s.version.filename}`}`,
    })),
    ...data.pages.map((p) => ({
      date: p.version.updatedAt,
      text: `wiki | ${p.path} | ${p.version.state}`,
    })),
  ].sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() || a.text.localeCompare(b.text),
  );
  let log = `# Wiki Log\n\n${events.map((e) => `## [${e.date.toISOString()}] ${e.text.replace(/[\r\n]/g, " ")}\n`).join("\n")}`;
  const sourcesByVersion = new Map(data.sources.map((s) => [s.version.id, s]));
  for (const ingest of data.ingests) {
    const s = sourcesByVersion.get(ingest.versionId);
    if (s)
      log = buildDeterministicIngestLog(
        log,
        `raw/${s.version.relativePath || `${s.source.id}/${s.version.filename}`}`,
        ingest.date.toISOString().slice(0, 10),
      );
  }
  return { index, overview, log };
}

export async function projectCatalog(h: Headers, w: string, domainId: string) {
  const context = await requireWorkspace(h, w);
  const data = await projectContent(context, domainId);
  if (!data.parent) throw new AccessError(404, "도메인을 찾을 수 없습니다.");
  const documents = catalogDocuments(data);
  return {
    domain: data.parent,
    ...documents,
    count: data.pages.length,
    sourceCount: data.sources.length,
    destinations: Object.fromEntries(
      data.pages.flatMap((p) => [
        [
          `#${encodeURIComponent(p.path.replace(/^wiki\//, "").replace(/\.md$/, ""))}`,
          `/w/${w}/wiki/${p.page.id}`,
        ],
      ]),
    ),
  };
}
