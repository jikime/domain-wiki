import "server-only";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import { z } from "zod";
import {
  resolveArchiveReference,
  rewriteMarkdownUrls,
} from "@/lib/archive-markdown";
import { MAX_FILE_BYTES } from "@/lib/content";
import { effectiveRole } from "@/lib/permissions";
import {
  ARCHIVE_MANIFEST,
  type ArchiveManifest,
  aggregatePaths,
  archiveManifestSchema,
  archivePath,
} from "@/lib/project-archive";
import { parseFrontmatter } from "@/lib/reference/frontmatter";
import { SOURCE_FORMATS } from "@/lib/source-formats";
import { metadataFromMarkdown } from "@/lib/wiki-links";
import { emptyWikiMetadata } from "@/lib/wiki-metadata";
import { buildWikiReferenceIndex } from "@/lib/wiki-reference-index";
import { AccessError, requireWorkspace } from "@/server/access";
import { getDb } from "@/server/db";
import {
  archiveFile,
  domain,
  membership,
  project,
  source,
  sourceAsset,
  sourceVersion,
  wikiPage,
  wikiVersion,
} from "@/server/db/schema";
import { requireSameOrigin } from "@/server/http";
import { EXTRACT_QUEUE, getBoss } from "@/server/jobs/queue";
import { originals } from "@/server/storage/originals";
import {
  type ExportFile,
  projectZipResponse,
  receiveProjectZip,
  unpackedStream,
} from "@/server/storage/project-zip";
import { isWriter, parseId } from "./content-access";
import { catalogDocuments, projectContent } from "./project-catalog";

export async function exportProjectArchive(request: Request, w: string) {
  const context = await requireWorkspace(request.headers, w);
  const query = new URL(request.url).searchParams;
  const domainId = parseId(query.get("domainId") ?? "");
  const drafts = query.get("drafts") === "1";
  if (drafts && !isWriter(context))
    throw new AccessError(
      403,
      "변경안 내보내기는 작성 직원 권한이 필요합니다.",
    );
  const data = await projectContent(context, domainId, drafts);
  const { parent, pages, sources } = data;
  const [attached, assets, projects] = await Promise.all([
    drafts
      ? getDb()
          .select()
          .from(archiveFile)
          .where(
            and(
              eq(archiveFile.workspaceId, w),
              eq(archiveFile.domainId, domainId),
              context.role === "reviewer"
                ? undefined
                : eq(archiveFile.createdBy, context.user.id),
            ),
          )
      : Promise.resolve([]),
    sources.length
      ? getDb()
          .select()
          .from(sourceAsset)
          .where(
            and(
              eq(sourceAsset.workspaceId, w),
              sql`${sourceAsset.versionId}=ANY(${sql.param(sources.map((s) => s.version.id))}::uuid[])`,
            ),
          )
      : Promise.resolve([]),
    getDb()
      .select()
      .from(project)
      .where(and(eq(project.workspaceId, w), eq(project.domainId, domainId))),
  ]);
  const files = new Map<string, ExportFile>();
  const urls = new Map<string, string>();
  const sourceIds = new Set(sources.map((s) => s.source.id)),
    pageIds = new Set(pages.map((p) => p.page.id));
  const attachedSources = new Map(
    attached.filter((f) => f.sourceId).map((f) => [f.sourceId, f]),
  );
  for (const file of attached) {
    if (
      (file.sourceId && !sourceIds.has(file.sourceId)) ||
      (file.pageId && !pageIds.has(file.pageId))
    )
      continue;
    files.set(
      file.path,
      file.directory
        ? { path: file.path, directory: true }
        : {
            path: file.path,
            storageKey: file.storageKey,
            byteSize: file.byteSize,
          },
    );
  }
  const uniquePath = (desired: string, id: string) => {
    let path = archivePath(desired) ?? `raw/${id}/file`;
    if (files.has(path)) path = `raw/${id}/${path.split("/").at(-1)}`;
    while (files.has(path)) path = `raw/${id}/${path}`;
    return path;
  };
  const manifest: ArchiveManifest = {
    format: "my-domain-wiki",
    version: 1,
    domain: {
      name: parent.name,
      purpose: parent.purpose,
      recordTemplate: parent.recordTemplate,
    },
    projects: projects.map(({ id, name, clientName, description }) => ({
      id,
      name,
      clientName,
      description,
    })),
    sources: [],
    pages: [],
  };
  for (const s of sources) {
    const preserved = attachedSources.get(s.source.id);
    const path =
      preserved?.path ??
      uniquePath(
        `raw/${s.version.relativePath || `${s.source.id}/${s.version.filename}`}`,
        s.source.id,
      );
    files.set(path, {
      path,
      storageKey: s.version.storageKey,
      byteSize: s.version.byteSize,
    });
    urls.set(`/w/${w}/sources/${s.source.id}`, path);
    urls.set(`/api/workspaces/${w}/source-versions/${s.version.id}/file`, path);
    manifest.sources.push({
      path,
      title: s.source.title,
      projectId: s.source.projectId,
      category: ["guideline", "project", "reference"].includes(
        s.source.category,
      )
        ? (s.source.category as "reference")
        : "reference",
      originUrl: s.version.originUrl,
    });
  }
  for (const asset of assets) {
    const extension =
      asset.mimeType.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "bin";
    const path = `wiki/.assets/${asset.id}.${extension}`;
    files.set(path, {
      path,
      storageKey: asset.storageKey,
      byteSize: asset.byteSize,
    });
    urls.set(`/api/workspaces/${w}/source-assets/${asset.id}`, path);
  }
  for (const p of pages) urls.set(`/w/${w}/wiki/${p.page.id}`, p.path);
  const media = pages.length
    ? await getDb()
        .select()
        .from(archiveFile)
        .where(
          and(
            eq(archiveFile.workspaceId, w),
            eq(archiveFile.domainId, domainId),
          ),
        )
    : [];
  const mediaByPath = new Map(
    media
      .filter((f) => /\.(?:png|jpe?g|gif|webp|avif)$/i.test(f.path))
      .map((f) => [f.path, f]),
  );
  const mediaPaths = new Set(mediaByPath.keys());
  const usedMedia = new Set<string>();
  const readPage = async (id: string) => {
    const [row] = await getDb()
      .select({ body: wikiVersion.body })
      .from(wikiVersion)
      .where(and(eq(wikiVersion.workspaceId, w), eq(wikiVersion.id, id)));
    if (!row)
      throw new AccessError(409, "내보내기 중 위키 버전이 변경되었습니다.");
    return row.body;
  };
  const renderPage = (body: string, p: (typeof pages)[number]) => {
    const result = rewriteMarkdownUrls(body, (url) => {
      const [plain] = url.split(/[?#]/),
        mapped = urls.get(plain);
      return mapped
        ? `${mapped}${url.includes("#") ? `#${url.split("#").slice(1).join("#")}` : ""}`
        : undefined;
    });
    return parseFrontmatter(result).rawBlock
      ? result
      : `---\ntype: ${p.version.metadata.type}\ntitle: ${JSON.stringify(p.version.title)}\n---\n\n${result}`;
  };
  // Read one page at a time. ZIP emission loads each immutable version lazily.
  for (const p of pages) {
    const original = await readPage(p.version.id);
    const rendered = renderPage(original, p);
    files.set(p.path, {
      path: p.path,
      byteSize: Buffer.byteLength(rendered),
      loadText: async () => renderPage(await readPage(p.version.id), p),
    });
    manifest.pages.push({ path: p.path, projectId: p.page.projectId });
    rewriteMarkdownUrls(original, (url) => {
      const path = resolveArchiveReference(p.path, url, mediaPaths);
      if (path) usedMedia.add(path);
      return undefined;
    });
    for (const match of original.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
      const path = resolveArchiveReference(p.path, match[1], mediaPaths);
      if (path) usedMedia.add(path);
    }
  }
  for (const path of usedMedia) {
    const file = mediaByPath.get(path);
    if (file)
      files.set(path, {
        path,
        storageKey: file.storageKey,
        byteSize: file.byteSize,
      });
  }
  const docs = catalogDocuments(data);
  if (parent.purposeMarkdown)
    files.set("purpose.md", {
      path: "purpose.md",
      text: parent.purposeMarkdown,
    });
  else
    files.set("purpose.md", {
      path: "purpose.md",
      text: `# Purpose\n\n${parent.purpose}\n`,
    });
  files.set("schema.md", { path: "schema.md", text: parent.schemaMarkdown });
  for (const [key, text] of Object.entries(docs))
    files.set(`wiki/${key}.md`, { path: `wiki/${key}.md`, text });
  // Retain imported aggregate originals as opaque snapshots when they were replaced by the rebuilt catalog.
  for (const original of attached.filter(
    (f) =>
      aggregatePaths.has(f.path) ||
      ["purpose.md", "schema.md"].includes(f.path),
  )) {
    const path = `.domain-wiki/imported/${original.path}`;
    if (!files.has(path))
      files.set(path, {
        path,
        storageKey: original.storageKey,
        byteSize: original.byteSize,
      });
  }
  files.set(ARCHIVE_MANIFEST, {
    path: ARCHIVE_MANIFEST,
    text: JSON.stringify(manifest, null, 2),
  });
  const latestContext = await requireWorkspace(request.headers, w);
  if (drafts && latestContext.role !== context.role)
    throw new AccessError(403, "권한이 변경되어 내보내기를 중단했습니다.");
  const latest = await projectContent(latestContext, domainId, drafts);
  const allowedPages = new Set(latest.pages.map((p) => p.version.id)),
    allowedSources = new Set(latest.sources.map((s) => s.version.id));
  if (
    pages.some((p) => !allowedPages.has(p.version.id)) ||
    sources.some((s) => !allowedSources.has(s.version.id))
  )
    throw new AccessError(
      409,
      "내보내기 중 게시본이나 원문 공개 상태가 변경되었습니다. 다시 다운로드해 주세요.",
    );
  return projectZipResponse([...files.values()], parent.name);
}

export async function importProjectArchive(request: Request, w: string) {
  requireSameOrigin(request);
  // Import creates a fresh domain, as the native app requires an empty destination.
  const context = await requireWorkspace(request.headers, w, true);
  const name = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .parse(new URL(request.url).searchParams.get("name"));
  const unpacked = await receiveProjectZip(request);
  const copied: string[] = [];
  let committed = false;
  try {
    const map = new Map(unpacked.files.map((f) => [f.path, f]));
    const warnings: string[] = [],
      invalidText = new Set<string>();
    const readText = async (path: string, strict = false) => {
      const file = map.get(path);
      if (!file || file.directory || file.byteSize > MAX_FILE_BYTES) return "";
      try {
        return new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(await readFile(file.temporary));
      } catch {
        if (strict)
          throw new AccessError(
            400,
            "ZIP 메타데이터가 올바른 UTF-8 문서가 아닙니다.",
          );
        if (!invalidText.has(path))
          warnings.push(
            `${path}: UTF-8 문서가 아니므로 원본 파일로 보존했습니다.`,
          );
        invalidText.add(path);
        return "";
      }
    };
    const manifestText = await readText(ARCHIVE_MANIFEST, true);
    let manifest: ArchiveManifest | undefined;
    if (manifestText) {
      try {
        manifest = archiveManifestSchema.parse(JSON.parse(manifestText));
      } catch {
        throw new AccessError(
          400,
          "웹 위키 아카이브의 manifest.json 형식을 확인해 주세요.",
        );
      }
    }
    const projectKeys = new Map<string, string>();
    for (const p of manifest?.projects ?? []) {
      if (projectKeys.has(p.id))
        throw new AccessError(400, "ZIP 프로젝트 식별자가 겹칩니다.");
      projectKeys.set(p.id, randomUUID());
    }
    for (const records of [manifest?.sources ?? [], manifest?.pages ?? []]) {
      const paths = new Set<string>();
      for (const item of records) {
        if (
          !archivePath(item.path) ||
          !map.has(item.path) ||
          paths.has(item.path) ||
          (item.projectId && !projectKeys.has(item.projectId))
        )
          throw new AccessError(
            400,
            "ZIP 목록과 파일·프로젝트의 연결이 맞지 않습니다.",
          );
        paths.add(item.path);
      }
    }
    const [purpose, schema, overview] = await Promise.all([
      readText("purpose.md"),
      readText("schema.md"),
      readText("wiki/overview.md"),
    ]);
    const domainId = randomUUID();
    const fileRecords = unpacked.files.map((file) => ({
      ...file,
      id: randomUUID(),
      storageKey: `${w}/${randomUUID()}`,
    }));
    const pageFiles: {
      file: (typeof fileRecords)[number];
      id: string;
      versionId: string;
      title: string;
      projectId: string | null;
    }[] = [];
    const sourceFiles: {
      file: (typeof fileRecords)[number];
      id: string;
      versionId: string;
      jobId: string;
      mimeType: string;
      title: string;
      category: string;
      projectId: string | null;
      originUrl: string | null;
    }[] = [];
    const manifestPages = new Map(manifest?.pages.map((p) => [p.path, p]));
    const manifestSources = new Map(manifest?.sources.map((s) => [s.path, s]));
    for (const file of fileRecords) {
      if (file.directory) continue;
      if (
        file.path.startsWith("wiki/") &&
        file.path.endsWith(".md") &&
        !aggregatePaths.has(file.path)
      ) {
        if (file.byteSize > MAX_FILE_BYTES) {
          warnings.push(
            `${file.path}: 100 MiB를 넘는 문서는 파일로 보존했습니다.`,
          );
          continue;
        }
        const body = await readText(file.path),
          fm = parseFrontmatter(body).frontmatter;
        if (invalidText.has(file.path)) continue;
        const ref = manifestPages.get(file.path)?.projectId;
        pageFiles.push({
          file,
          id: randomUUID(),
          versionId: randomUUID(),
          title: (typeof fm?.title === "string" && fm.title.trim()
            ? fm.title
            : file.path.split("/").at(-1)?.replace(/\.md$/, "") || "위키"
          ).slice(0, 160),
          projectId: ref ? (projectKeys.get(ref) ?? null) : null,
        });
      } else if (file.path.startsWith("raw/")) {
        const mimeType =
          SOURCE_FORMATS[file.path.split(".").at(-1)?.toLowerCase() ?? ""];
        if (!mimeType || !file.byteSize || file.byteSize > MAX_FILE_BYTES) {
          warnings.push(
            `${file.path}: 원본 파일로 보존했으며 문서 분석 대상에서는 제외했습니다.`,
          );
          continue;
        }
        const meta = manifestSources.get(file.path);
        sourceFiles.push({
          file,
          id: randomUUID(),
          versionId: randomUUID(),
          jobId: randomUUID(),
          mimeType,
          title: (meta?.title || file.path.split("/").at(-1) || "자료").slice(
            0,
            160,
          ),
          category: meta?.category ?? "reference",
          projectId: meta?.projectId
            ? (projectKeys.get(meta.projectId) ?? null)
            : null,
          originUrl:
            meta?.originUrl && /^https?:\/\//i.test(meta.originUrl)
              ? meta.originUrl
              : null,
        });
      }
    }
    const referenceIndex = buildWikiReferenceIndex(
      pageFiles.map((p) => ({
        id: p.id,
        title: p.title,
        metadata: { path: p.file.path },
      })),
    );
    // Files remain private until their DB transaction is committed. Rollback removes only these UUID keys.
    for (const file of fileRecords) {
      await originals.putStream(file.storageKey, unpackedStream(file));
      copied.push(file.storageKey);
    }
    const boss = await getBoss();
    await getDb().transaction(async (tx) => {
      const [member] = await tx
        .select()
        .from(membership)
        .where(
          and(
            eq(membership.workspaceId, w),
            eq(membership.userId, context.user.id),
          ),
        )
        .for("share");
      if (
        !member?.isActive ||
        !member.isAdmin ||
        effectiveRole(member.role, member.isAdmin) !== "reviewer"
      )
        throw new AccessError(
          403,
          "관리자 권한이 변경되어 가져오기를 중단했습니다.",
        );
      await tx.insert(domain).values({
        id: domainId,
        workspaceId: w,
        name,
        purpose:
          manifest?.domain?.purpose ||
          "가져온 프로젝트의 목적 문서를 확인해 주세요.",
        purposeMarkdown: purpose,
        schemaMarkdown: schema,
        overviewMarkdown: overview,
        recordTemplate: manifest?.domain?.recordTemplate,
        autoIngest: false,
      });
      for (const p of manifest?.projects ?? [])
        await tx.insert(project).values({
          id: projectKeys.get(p.id),
          workspaceId: w,
          domainId,
          name: p.name,
          clientName: p.clientName || "미지정",
          description: p.description,
        });
      for (const s of sourceFiles) {
        await tx.insert(source).values({
          id: s.id,
          workspaceId: w,
          domainId,
          projectId: s.projectId,
          title: s.title,
          category: s.category,
          createdBy: context.user.id,
          latestVersionId: s.versionId,
          versionCount: 1,
        });
        await tx.insert(sourceVersion).values({
          id: s.versionId,
          workspaceId: w,
          sourceId: s.id,
          number: 1,
          filename: s.file.path.split("/").at(-1) || "file",
          relativePath: s.file.path.slice(4),
          originUrl: s.originUrl,
          mimeType: s.mimeType,
          storageKey: s.file.storageKey,
          sha256: s.file.sha256,
          byteSize: s.file.byteSize,
          uploadedBy: context.user.id,
          activeJobId: s.jobId,
        });
        await boss.send(
          EXTRACT_QUEUE,
          { workspaceId: w, versionId: s.versionId },
          { id: s.jobId, db: fromDrizzle(tx, sql) },
        );
      }
      for (const p of pageFiles) {
        const body = await readText(p.file.path);
        await tx.insert(wikiPage).values({
          id: p.id,
          workspaceId: w,
          domainId,
          projectId: p.projectId,
          createdBy: context.user.id,
          latestVersionId: p.versionId,
          versionCount: 1,
        });
        let metadata = { ...emptyWikiMetadata, path: p.file.path };
        try {
          metadata = metadataFromMarkdown(
            body,
            w,
            p.id,
            metadata,
            referenceIndex,
          ) as typeof metadata;
        } catch {
          warnings.push(
            `${p.file.path}: 본문은 보존했으며 문서 속성의 형식을 편집 화면에서 확인해 주세요.`,
          );
        }
        await tx.insert(wikiVersion).values({
          id: p.versionId,
          workspaceId: w,
          pageId: p.id,
          number: 1,
          title: p.title,
          body,
          metadata,
          authorId: context.user.id,
        });
      }
      const sourceByPath = new Map(sourceFiles.map((s) => [s.file.path, s.id])),
        pageByPath = new Map(pageFiles.map((p) => [p.file.path, p.id]));
      // Batch below PostgreSQL's parameter count ceiling, without truncating project files.
      for (let offset = 0; offset < fileRecords.length; offset += 1000)
        await tx.insert(archiveFile).values(
          fileRecords.slice(offset, offset + 1000).map((f) => ({
            id: f.id,
            workspaceId: w,
            domainId,
            path: f.path,
            directory: f.directory,
            storageKey: f.storageKey,
            byteSize: f.byteSize,
            sha256: f.sha256,
            createdBy: context.user.id,
            sourceId: sourceByPath.get(f.path),
            pageId: pageByPath.get(f.path),
          })),
        );
    });
    committed = true;
    return {
      domainId,
      name,
      files: fileRecords.filter((f) => !f.directory).length,
      directories: fileRecords.filter((f) => f.directory).length,
      wikiPages: pageFiles.length,
      sources: sourceFiles.length,
      warnings,
      message:
        "새 도메인으로 가져왔습니다. 원문 공개와 위키 근거 연결·검토 후 게시할 수 있습니다.",
    };
  } finally {
    if (!committed) for (const key of copied) await originals.remove(key);
    await unpacked.cleanup();
  }
}
