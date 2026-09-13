import {
  isZipOffice,
  SOURCE_FORMATS,
  safeRelativePath,
} from "@/lib/source-formats";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import { z } from "zod";
import { MAX_FILE_BYTES, reviewInput, sourceInput } from "@/lib/content";
import { pageInput, pageResult, searchPattern } from "@/lib/pagination";
import { effectiveRole } from "@/lib/permissions";
import { findLocalMarkdownImageRefs } from "@/lib/reference/extract-source-images";
import {
  type FolderMediaSnapshot,
  folderImagePath,
  folderMediaSignature,
  isPathAllowedForImport,
} from "@/lib/source-import-files";
import { AccessError, requireWorkspace } from "@/server/access";
import { getDb } from "@/server/db";
import {
  membership,
  reviewDecision,
  source,
  sourceAsset,
  sourceChunk,
  sourceImport,
  sourceImportFile,
  sourceVersion,
  type Testimony,
} from "@/server/db/schema";
import { readBody, requireSameOrigin } from "@/server/http";
import { EXTRACT_QUEUE, getBoss } from "@/server/jobs/queue";
import { originals } from "@/server/storage/originals";
import {
  type ContentContext,
  checkScope,
  isWriter,
  mayManage,
  parseId,
  requireReviewer,
  requireWriter,
} from "./content-access";

const versionFields = {
  id: sourceVersion.id,
  number: sourceVersion.number,
  filename: sourceVersion.filename,
  relativePath: sourceVersion.relativePath,
  originUrl: sourceVersion.originUrl,
  mimeType: sourceVersion.mimeType,
  sha256: sourceVersion.sha256,
  byteSize: sourceVersion.byteSize,
  uploadedBy: sourceVersion.uploadedBy,
  publication: sourceVersion.publication,
  processing: sourceVersion.processing,
  parserVersion: sourceVersion.parserVersion,
  testimony: sourceVersion.testimony,
  errorMessage: sourceVersion.errorMessage,
  warnings: sourceVersion.warnings,
  createdAt: sourceVersion.createdAt,
};
export async function sourceRecord(context: ContentContext, id: string) {
  parseId(id);
  const [item] = await getDb()
    .select()
    .from(source)
    .where(and(eq(source.id, id), eq(source.workspaceId, context.workspaceId)));
  if (
    !item ||
    (!item.publishedVersionId && !mayManage(context, item.createdBy))
  )
    throw new AccessError(404, "자료를 찾을 수 없습니다.");
  return item;
}
export async function versionRecord(context: ContentContext, id: string) {
  parseId(id);
  const [item] = await getDb()
    .select({
      version: sourceVersion,
      source,
      current: sql<boolean>`source_is_current(${sourceVersion.id})`,
    })
    .from(sourceVersion)
    .innerJoin(source, eq(source.id, sourceVersion.sourceId))
    .where(
      and(
        eq(sourceVersion.id, id),
        eq(sourceVersion.workspaceId, context.workspaceId),
      ),
    );
  if (
    !item ||
    (!mayManage(context, item.source.createdBy) &&
      (item.source.publishedVersionId !== id ||
        item.version.publication !== "published" ||
        item.version.processing !== "completed" ||
        !item.current))
  )
    throw new AccessError(404, "자료 버전을 찾을 수 없습니다.");
  return item;
}
export async function listSources(
  requestHeaders: Headers,
  workspaceId: string,
  domainId?: string,
  category?: "guideline" | "project" | "reference" | "testimony",
) {
  return (
    await listSourcePage(requestHeaders, workspaceId, {
      domainId,
      category,
      pageSize: 100,
    })
  ).items;
}
const sourceListInput = pageInput.extend({
  category: sourceInput.shape.category.optional(),
  status: z
    .enum(["pending", "published", "rejected", "withdrawn", "superseded"])
    .optional(),
  mine: z.enum(["true", "false"]).optional(),
});
export async function listSourcePage(
  requestHeaders: Headers,
  workspaceId: string,
  input: unknown = {},
) {
  const context = await requireWorkspace(requestHeaders, workspaceId);
  const filter = sourceListInput.parse(input);
  if (filter.domainId)
    await checkScope(workspaceId, filter.domainId, filter.projectId ?? null);
  else if (filter.projectId)
    throw new AccessError(400, "프로젝트 검색에는 도메인이 필요합니다.");
  const chosenId =
    context.role === "reviewer"
      ? source.latestVersionId
      : isWriter(context)
        ? sql`CASE WHEN ${source.createdBy} = ${context.user.id} THEN ${source.latestVersionId} ELSE ${source.publishedVersionId} END`
        : source.publishedVersionId;
  const condition = and(
    eq(source.workspaceId, workspaceId),
    filter.domainId ? eq(source.domainId, filter.domainId) : undefined,
    filter.projectId
      ? or(eq(source.projectId, filter.projectId), isNull(source.projectId))
      : undefined,
    filter.category ? eq(source.category, filter.category) : undefined,
    filter.q ? ilike(source.title, searchPattern(filter.q)) : undefined,
    filter.status ? eq(sourceVersion.publication, filter.status) : undefined,
    filter.mine === "true" ? eq(source.createdBy, context.user.id) : undefined,
    context.role === "reviewer"
      ? undefined
      : isWriter(context)
        ? or(
            eq(source.createdBy, context.user.id),
            sql`source_is_current(${source.publishedVersionId})`,
          )
        : sql`source_is_current(${source.publishedVersionId})`,
  );
  const [rows, [summary]] = await Promise.all([
    getDb()
      .select({ item: source, version: versionFields })
      .from(source)
      .leftJoin(sourceVersion, eq(sourceVersion.id, chosenId))
      .where(condition)
      .orderBy(desc(source.updatedAt), desc(source.id))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize),
    getDb()
      .select({ total: count() })
      .from(source)
      .leftJoin(sourceVersion, eq(sourceVersion.id, chosenId))
      .where(condition),
  ]);
  const items = rows.map(({ item, version }) => {
    return {
      ...item,
      latestVersionId: mayManage(context, item.createdBy)
        ? item.latestVersionId
        : undefined,
      versionCount: mayManage(context, item.createdBy)
        ? item.versionCount
        : undefined,
      version: version ?? undefined,
    };
  });
  const runRows =
    isWriter(context) && items.length
      ? await getDb().execute(sql`SELECT DISTINCT ON (r.source_version_id) r.source_version_id,r.state,r.reused_analysis FROM ingest_run r
    WHERE r.workspace_id=${workspaceId} AND r.source_version_id=ANY(${sql.param(items.flatMap((i) => (i.version ? [i.version.id] : [])))}::uuid[]) ORDER BY r.source_version_id,r.created_at DESC`)
      : { rows: [] };
  const withIngest = items.map((item) => {
    const run = runRows.rows.find(
      (r) => r.source_version_id === item.version?.id,
    );
    return {
      ...item,
      ingestState: run ? String(run.state) : null,
      ingestReusedAnalysis: !!run?.reused_analysis,
    };
  });
  return pageResult(withIngest, summary.total, {
    page: filter.page,
    pageSize: filter.pageSize,
  });
}
export async function sourceDetails(
  requestHeaders: Headers,
  workspaceId: string,
  id: string,
  selectedVersionId?: string,
) {
  const context = await requireWorkspace(requestHeaders, workspaceId);
  const item = await sourceRecord(context, id);
  const canManage = mayManage(context, item.createdBy);
  const selected =
    selectedVersionId ??
    (canManage ? item.latestVersionId : item.publishedVersionId);
  if (!selected) throw new AccessError(404, "자료 버전이 없습니다.");
  const record = await versionRecord(context, selected);
  if (record.source.id !== id)
    throw new AccessError(404, "자료 버전을 찾을 수 없습니다.");
  const versions = await getDb()
    .select(versionFields)
    .from(sourceVersion)
    .where(
      and(
        eq(sourceVersion.sourceId, id),
        canManage ? undefined : eq(sourceVersion.id, selected),
      ),
    )
    .orderBy(desc(sourceVersion.number));
  const chunks = await getDb()
    .select()
    .from(sourceChunk)
    .where(eq(sourceChunk.versionId, selected))
    .orderBy(sourceChunk.ordinal);
  const decisions = await getDb()
    .select({
      action: reviewDecision.action,
      note: reviewDecision.note,
      createdAt: reviewDecision.createdAt,
    })
    .from(reviewDecision)
    .where(eq(reviewDecision.sourceVersionId, selected))
    .orderBy(desc(reviewDecision.createdAt));
  return {
    source: {
      ...item,
      latestVersionId: canManage ? item.latestVersionId : undefined,
      versionCount: canManage ? item.versionCount : undefined,
    },
    version: versions.find((version) => version.id === selected),
    versions,
    chunks,
    decisions,
    canManage,
    canWrite: isWriter(context),
    canReview: context.role === "reviewer",
    canApprove:
      context.role === "reviewer" &&
      record.version.uploadedBy !== context.user.id,
  };
}
export async function uploadSource(
  request: Request,
  workspaceId: string,
  sourceId?: string,
  testimony?: Testimony,
) {
  const context = await requireWorkspace(request.headers, workspaceId);
  requireWriter(context);
  requireSameOrigin(request);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;"))
    throw new AccessError(415, "파일 전송 형식을 확인하세요.");
  const body = await readBody(request, MAX_FILE_BYTES + 64 * 1024);
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(body), {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    throw new AccessError(400, "파일 전송 내용을 읽을 수 없습니다.");
  }
  const file = form.get("file");
  if (!(file instanceof File))
    throw new AccessError(400, "파일을 선택해 주세요.");
  return registerSourceFile(
    context,
    file,
    {
      title: form.get("title"),
      domainId: form.get("domainId"),
      projectId: form.get("projectId") || null,
      category: form.get("category"),
    },
    {
      sourceId,
      testimony,
      relativePath: form.get("relativePath")
        ? String(form.get("relativePath"))
        : undefined,
      importId: form.get("importId")
        ? parseId(String(form.get("importId")))
        : undefined,
    },
  );
}
export async function registerSourceFile(
  context: ContentContext,
  file: File,
  input: unknown,
  options: {
    sourceId?: string;
    testimony?: Testimony;
    relativePath?: string;
    importId?: string;
    importLeaseId?: string;
    importObservedSince?: Date;
    originUrl?: string;
  } = {},
) {
  requireWriter(context);
  const { workspaceId } = context;
  let { sourceId } = options;
  const { testimony, importId } = options;
  if (!file.size)
    throw new AccessError(400, "비어 있지 않은 파일을 선택해 주세요.");
  if (file.size > MAX_FILE_BYTES)
    throw new AccessError(413, "파일 크기 제한을 초과했습니다.");
  let metadata = sourceInput.parse(input);
  await checkScope(workspaceId, metadata.domainId, metadata.projectId);
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (!extension || !SOURCE_FORMATS[extension])
    throw new AccessError(
      415,
      "지원하는 문서·스프레드시트·전자책·이미지 형식을 선택해 주세요.",
    );
  const bytes = Buffer.from(await file.arrayBuffer());
  if (extension === "pdf" && bytes.subarray(0, 5).toString() !== "%PDF-")
    throw new AccessError(400, "올바른 PDF 파일이 아닙니다.");
  if (
    isZipOffice(extension) &&
    bytes.subarray(0, 4).toString("hex") !== "504b0304"
  )
    throw new AccessError(400, "올바른 문서 파일이 아닙니다.");
  const mimeType = SOURCE_FORMATS[extension];
  const relativePath = options.relativePath
    ? safeRelativePath(options.relativePath)
    : null;
  if ((options.relativePath || importId) && !relativePath)
    throw new AccessError(400, "폴더 안의 상대 경로를 확인해 주세요.");
  const filename =
    file.name
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\p{Cc}/gu, "")
      .slice(0, 180) || `원본.${extension}`;
  let imageRefs: string[] = [];
  if (importId && relativePath && mimeType === "text/markdown") {
    try {
      imageRefs = findLocalMarkdownImageRefs(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      /* The parser reports invalid UTF-8 without losing the original. */
    }
    if (imageRefs.length > 500)
      throw new AccessError(
        413,
        "연결 이미지가 500개를 넘습니다. 문서를 나누어 주세요.",
      );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let id = sourceId ? parseId(sourceId) : randomUUID();
  const versionId = randomUUID();
  const jobId = randomUUID();
  const storageKey = `${workspaceId}/${versionId}`;
  const boss = await getBoss();
  await originals.put(storageKey, bytes);
  let keepFile = false;
  try {
    return await getDb()
      .transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${sha256}`}, 0))`,
        );
        // Recheck the writer while committing; a running folder scan must stop
        // producing versions after its owner loses access.
        const [active] = await tx
          .select()
          .from(membership)
          .where(
            and(
              eq(membership.workspaceId, workspaceId),
              eq(membership.userId, context.user.id),
              eq(membership.isActive, true),
            ),
          )
          .for("share");
        if (!active || effectiveRole(active.role, active.isAdmin) === "reader")
          throw new AccessError(403, "작성 권한이 변경되었습니다.");
        context = {
          ...context,
          role: effectiveRole(active.role, active.isAdmin),
          isAdmin: active.isAdmin,
        };
        if (importId) {
          const [collection] = await tx
            .select()
            .from(sourceImport)
            .where(
              and(
                eq(sourceImport.id, importId),
                eq(sourceImport.workspaceId, workspaceId),
              ),
            )
            .for("update");
          if (!collection || !mayManage(context, collection.createdBy))
            throw new AccessError(404, "가져오기 기록을 찾을 수 없습니다.");
          if (
            collection.mode === "watch" &&
            (!collection.enabled ||
              !options.importLeaseId ||
              collection.leaseId !== options.importLeaseId)
          )
            throw new AccessError(409, "폴더 감지를 중지했습니다.");
          if (
            !isPathAllowedForImport(relativePath ?? "", collection.config) ||
            file.size > collection.config.maxFileSizeMb * 1024 * 1024
          )
            throw new AccessError(
              400,
              "가져오기 포함·제외 규칙과 파일 크기 설정을 확인해 주세요.",
            );
          if (
            collection.domainId !== metadata.domainId ||
            collection.projectId !== metadata.projectId ||
            collection.category !== metadata.category
          )
            throw new AccessError(409, "가져오기 범위가 변경되었습니다.");
          const [mapping] = await tx
            .select()
            .from(sourceImportFile)
            .where(
              and(
                eq(sourceImportFile.importId, importId),
                eq(sourceImportFile.relativePath, relativePath ?? ""),
              ),
            );
          if (mapping) {
            sourceId = mapping.sourceId;
            id = sourceId;
            const [current] = await tx
              .select()
              .from(source)
              .where(eq(source.id, id));
            if (!current)
              throw new AccessError(409, "연결 자료를 확인해 주세요.");
            metadata = { ...metadata, title: current.title };
          }
        }
        const folderMedia: FolderMediaSnapshot[] = [];
        if (importId && relativePath && imageRefs.length) {
          const candidates = await tx
            .select({
              mapping: sourceImportFile,
              image: sourceVersion,
              parent: source,
            })
            .from(sourceImportFile)
            .innerJoin(
              sourceVersion,
              eq(sourceVersion.id, sourceImportFile.versionId),
            )
            .innerJoin(source, eq(source.id, sourceVersion.sourceId))
            .where(
              and(
                eq(sourceImportFile.importId, importId),
                eq(source.workspaceId, workspaceId),
                eq(source.domainId, metadata.domainId),
                metadata.projectId
                  ? eq(source.projectId, metadata.projectId)
                  : isNull(source.projectId),
                eq(source.category, metadata.category),
                eq(sourceImportFile.missing, false),
                sql`${sourceVersion.mimeType} LIKE 'image/%'`,
                options.importObservedSince
                  ? sql`${sourceImportFile.observedAt} >= ${options.importObservedSince}`
                  : undefined,
              ),
            );
          for (const ref of imageRefs) {
            const path = folderImagePath(relativePath, ref);
            const found = candidates.find(
              ({ mapping, image, parent }) =>
                mapping.relativePath === path &&
                ["pending", "published"].includes(image.publication) &&
                (mayManage(context, parent.createdBy) ||
                  parent.publishedVersionId === image.id),
            );
            folderMedia.push({
              ref,
              path,
              versionId: found?.image.id ?? null,
              sha256: found?.image.sha256 ?? null,
            });
          }
        }
        const remember = async (result: {
          sourceId: string;
          versionId: string;
          duplicate: boolean;
        }) => {
          if (importId)
            await tx
              .insert(sourceImportFile)
              .values({
                importId,
                relativePath: relativePath ?? "",
                sourceId: result.sourceId,
                versionId: result.versionId,
                sha256,
                observedAt: new Date(),
                missing: false,
              })
              .onConflictDoUpdate({
                target: [
                  sourceImportFile.importId,
                  sourceImportFile.relativePath,
                ],
                set: {
                  sourceId: result.sourceId,
                  versionId: result.versionId,
                  sha256,
                  observedAt: new Date(),
                  missing: false,
                },
              });
          return result;
        };
        let parent: typeof source.$inferSelect;
        if (sourceId) {
          const [existing] = await tx
            .select()
            .from(source)
            .where(and(eq(source.id, id), eq(source.workspaceId, workspaceId)))
            .for("update");
          if (!existing || !mayManage(context, existing.createdBy))
            throw new AccessError(404, "자료를 찾을 수 없습니다.");
          if (
            existing.domainId !== metadata.domainId ||
            existing.projectId !== metadata.projectId ||
            existing.title !== metadata.title ||
            existing.category !== metadata.category
          )
            throw new AccessError(
              409,
              "새 버전은 같은 자료 분류와 범위로 등록해 주세요.",
            );
          parent = existing;
        } else {
          const [duplicate] = await tx
            .select({ sourceId: source.id, versionId: sourceVersion.id })
            .from(sourceVersion)
            .innerJoin(source, eq(source.id, sourceVersion.sourceId))
            .where(
              and(
                eq(source.workspaceId, workspaceId),
                eq(source.domainId, metadata.domainId),
                metadata.projectId
                  ? eq(source.projectId, metadata.projectId)
                  : isNull(source.projectId),
                eq(source.category, metadata.category),
                eq(sourceVersion.sha256, sha256),
                sql`${sourceVersion.folderMedia} = '[]'::jsonb`,
                context.role === "reviewer"
                  ? undefined
                  : eq(source.createdBy, context.user.id),
              ),
            )
            .limit(1);
          if (duplicate && !importId)
            return remember({ ...duplicate, duplicate: true });
          [parent] = await tx
            .insert(source)
            .values({
              ...metadata,
              id,
              workspaceId,
              createdBy: context.user.id,
            })
            .returning();
        }
        const sameContent = await tx
          .select({
            id: sourceVersion.id,
            folderMedia: sourceVersion.folderMedia,
          })
          .from(sourceVersion)
          .where(
            and(
              eq(sourceVersion.sourceId, id),
              eq(sourceVersion.sha256, sha256),
              importId
                ? eq(sourceVersion.id, parent.latestVersionId ?? versionId)
                : undefined,
            ),
          );
        const same = sameContent.find(
          (candidate) =>
            folderMediaSignature(candidate.folderMedia) ===
            folderMediaSignature(folderMedia),
        );
        if (same)
          return remember({
            sourceId: id,
            versionId: same.id,
            duplicate: true,
          });
        await tx.insert(sourceVersion).values({
          id: versionId,
          workspaceId,
          sourceId: id,
          number: parent.versionCount + 1,
          filename,
          mimeType,
          relativePath,
          originUrl: options.originUrl,
          folderMedia,
          storageKey,
          sha256,
          byteSize: bytes.length,
          uploadedBy: context.user.id,
          activeJobId: jobId,
          testimony,
        });
        await boss.send(
          EXTRACT_QUEUE,
          { workspaceId, versionId },
          { id: jobId, db: fromDrizzle(tx, sql) },
        );
        await tx
          .update(source)
          .set({
            latestVersionId: versionId,
            versionCount: parent.versionCount + 1,
          })
          .where(eq(source.id, id));
        return remember({ sourceId: id, versionId, duplicate: false });
      })
      .then((result) => {
        keepFile = !result.duplicate;
        return result;
      });
  } finally {
    if (!keepFile) await originals.remove(storageKey);
  }
}
export async function sourceAction(
  requestHeaders: Headers,
  workspaceId: string,
  id: string,
  input: unknown,
) {
  const context = await requireWorkspace(requestHeaders, workspaceId);
  const command = reviewInput.parse(input);
  const record = await versionRecord(context, id);
  if (["retry", "cancel", "submit"].includes(command.action)) {
    if (!mayManage(context, record.source.createdBy))
      throw new AccessError(
        403,
        "자료 작성자 또는 검토 직원 권한이 필요합니다.",
      );
  } else requireReviewer(context);
  const boss = ["retry", "cancel"].includes(command.action)
    ? await getBoss()
    : undefined;
  return getDb().transaction(async (tx) => {
    const [parent] = await tx
      .select()
      .from(source)
      .where(eq(source.id, record.source.id))
      .for("update");
    const [version] = await tx
      .select()
      .from(sourceVersion)
      .where(eq(sourceVersion.id, id))
      .for("update");
    if (command.action === "submit") {
      if (
        version.publication !== "rejected" ||
        version.processing !== "completed" ||
        parent.latestVersionId !== id
      )
        throw new AccessError(
          409,
          "처리가 완료된 최신 반려 버전만 다시 검토 요청할 수 있습니다.",
        );
      await tx
        .update(sourceVersion)
        .set({ publication: "pending" })
        .where(eq(sourceVersion.id, id));
    } else if (command.action === "cancel") {
      if (!["queued", "processing"].includes(version.processing))
        throw new AccessError(409, "진행 중인 처리만 취소할 수 있습니다.");
      await tx
        .update(sourceVersion)
        .set({ processing: "canceled", errorMessage: null })
        .where(eq(sourceVersion.id, id));
      if (version.activeJobId && boss)
        await boss.cancel(EXTRACT_QUEUE, version.activeJobId, {
          db: fromDrizzle(tx, sql),
        });
    } else if (command.action === "retry") {
      if (!["failed", "canceled"].includes(version.processing))
        throw new AccessError(
          409,
          "실패하거나 취소한 처리만 재시도할 수 있습니다.",
        );
      const jobId = randomUUID();
      await tx
        .update(sourceVersion)
        .set({ processing: "queued", activeJobId: jobId, errorMessage: null })
        .where(eq(sourceVersion.id, id));
      await boss?.send(
        EXTRACT_QUEUE,
        { workspaceId, versionId: id },
        { id: jobId, db: fromDrizzle(tx, sql) },
      );
    } else if (command.action === "approve") {
      if (version.uploadedBy === context.user.id)
        throw new AccessError(
          409,
          "본인이 등록한 버전은 다른 검토 직원이 승인해야 합니다.",
        );
      if (
        version.publication !== "pending" ||
        version.processing !== "completed" ||
        parent.latestVersionId !== id
      )
        throw new AccessError(
          409,
          "처리가 완료된 최신 검토 대기 버전만 공개할 수 있습니다.",
        );
      if (version.testimony?.chunkIds.length) {
        const valid = await tx.execute(
          sql`SELECT bool_and(source_is_current(c.version_id)) AS valid, count(*)::int AS count FROM source_chunk c WHERE c.workspace_id=${workspaceId} AND c.id IN (${sql.join(
            version.testimony.chunkIds.map((id) => sql`${id}::uuid`),
            sql`,`,
          )})`,
        );
        if (
          !valid.rows[0]?.valid ||
          valid.rows[0]?.count !== version.testimony.chunkIds.length
        )
          throw new AccessError(
            409,
            "연결한 근거가 개정·철회되었습니다. 새 실무 기록 버전에서 근거를 확인해 주세요.",
          );
      }
      if (parent.publishedVersionId)
        await tx
          .update(sourceVersion)
          .set({ publication: "superseded" })
          .where(eq(sourceVersion.id, parent.publishedVersionId));
      await tx
        .update(sourceVersion)
        .set({ publication: "published" })
        .where(eq(sourceVersion.id, id));
      await tx
        .update(source)
        .set({ publishedVersionId: id })
        .where(eq(source.id, parent.id));
    } else if (command.action === "reject") {
      if (version.publication !== "pending" || !command.note)
        throw new AccessError(
          409,
          "검토 대기 자료에 반려 이유를 입력해 주세요.",
        );
      await tx
        .update(sourceVersion)
        .set({ publication: "rejected" })
        .where(eq(sourceVersion.id, id));
    } else if (command.action === "withdraw") {
      if (parent.publishedVersionId !== id)
        throw new AccessError(409, "현재 공개 버전만 철회할 수 있습니다.");
      await tx
        .update(sourceVersion)
        .set({ publication: "withdrawn" })
        .where(eq(sourceVersion.id, id));
      await tx
        .update(source)
        .set({ publishedVersionId: null })
        .where(eq(source.id, parent.id));
    } else throw new AccessError(400, "자료에 사용할 수 없는 동작입니다.");
    if (["approve", "withdraw"].includes(command.action)) {
      await tx.execute(
        sql`DELETE FROM content_embedding e WHERE e.workspace_id=${workspaceId} AND ((e.kind='source' AND NOT EXISTS(SELECT 1 FROM source_chunk c WHERE c.id=e.target_id AND source_is_current(c.version_id))) OR (e.kind='wiki' AND EXISTS(SELECT 1 FROM wiki_evidence x JOIN source_chunk c ON c.id=x.chunk_id WHERE x.version_id=e.target_id AND NOT source_is_current(c.version_id))))`,
      );
    }
    await tx.insert(reviewDecision).values({
      workspaceId,
      sourceVersionId: id,
      actorId: context.user.id,
      action: command.action,
      note: command.note,
    });
    return { id, action: command.action };
  });
}
export async function originalFile(
  requestHeaders: Headers,
  workspaceId: string,
  versionId: string,
  inline: boolean,
) {
  const context = await requireWorkspace(requestHeaders, workspaceId);
  const { version } = await versionRecord(context, versionId);
  const bytes = await originals.read(version.storageKey);
  if (createHash("sha256").update(bytes).digest("hex") !== version.sha256)
    throw new AccessError(409, "원본 파일 무결성 확인에 실패했습니다.");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": version.mimeType,
      "Content-Disposition": `${inline && version.mimeType === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(version.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "sandbox; default-src 'none'; frame-ancestors 'self'",
    },
  });
}

export async function sourceAssetFile(
  requestHeaders: Headers,
  workspaceId: string,
  assetId: string,
) {
  const context = await requireWorkspace(requestHeaders, workspaceId);
  parseId(assetId);
  const [asset] = await getDb()
    .select()
    .from(sourceAsset)
    .where(
      and(
        eq(sourceAsset.id, assetId),
        eq(sourceAsset.workspaceId, workspaceId),
      ),
    );
  if (!asset) throw new AccessError(404, "이미지를 찾을 수 없습니다.");
  await versionRecord(context, asset.versionId);
  const bytes = await originals.read(asset.storageKey);
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
    throw new AccessError(409, "이미지 무결성 확인에 실패했습니다.");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "sandbox; default-src 'none'; frame-ancestors 'self'",
    },
  });
}
