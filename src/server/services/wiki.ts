import "server-only";
import { randomUUID } from "node:crypto";
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { reviewInput, wikiInput } from "@/lib/content";
import { pageInput, pageResult, searchPattern } from "@/lib/pagination";
import { parseFrontmatter } from "@/lib/reference/frontmatter";
import { metadataFromMarkdown } from "@/lib/wiki-links";
import { emptyWikiMetadata } from "@/lib/wiki-metadata";
import { AccessError, requireWorkspace } from "@/server/access";
import { getDb } from "@/server/db";
import {
  reviewDecision,
  source,
  sourceChunk,
  sourceVersion,
  wikiEvidence,
  wikiPage,
  wikiVersion,
} from "@/server/db/schema";
import { archiveMediaDestinations } from "./archive-media";
import {
  type ContentContext,
  checkScope,
  isWriter,
  parseId,
  requireReviewer,
  requireWriter,
  validEvidenceSql,
} from "./content-access";
import {
  publishedWikiReferences,
  wikiLinkDestinations,
} from "./wiki-references";

export type QueryDb = Pick<ReturnType<typeof getDb>, "select" | "execute">;
export async function checkEvidence(
  db: QueryDb,
  workspaceId: string,
  domainId: string,
  projectId: string | null,
  chunkIds: string[],
  lock = false,
) {
  if (!chunkIds.length) return;
  const references = await db
    .select({
      chunk: sourceChunk.id,
      sourceId: source.id,
      domainId: source.domainId,
      projectId: source.projectId,
      versionId: sourceVersion.id,
      currentId: source.publishedVersionId,
      publication: sourceVersion.publication,
      processing: sourceVersion.processing,
      current: sql<boolean>`source_is_current(${sourceVersion.id})`,
    })
    .from(sourceChunk)
    .innerJoin(sourceVersion, eq(sourceVersion.id, sourceChunk.versionId))
    .innerJoin(source, eq(source.id, sourceVersion.sourceId))
    .where(
      and(
        eq(sourceChunk.workspaceId, workspaceId),
        inArray(sourceChunk.id, chunkIds),
      ),
    );
  if (references.length !== chunkIds.length)
    throw new AccessError(404, "선택한 근거를 찾을 수 없습니다.");
  if (lock) {
    const ids = [...new Set(references.map((item) => item.sourceId))].sort();
    for (const id of ids)
      await db.execute(sql`SELECT id FROM ${source} WHERE id=${id} FOR UPDATE`);
    return checkEvidence(db, workspaceId, domainId, projectId, chunkIds, false);
  }
  if (
    references.some(
      (item) =>
        item.domainId !== domainId ||
        (item.projectId !== null && item.projectId !== projectId) ||
        item.currentId !== item.versionId ||
        item.publication !== "published" ||
        item.processing !== "completed" ||
        !item.current,
    )
  )
    throw new AccessError(
      409,
      "근거는 같은 도메인·프로젝트 범위의 현재 공개 자료에서 선택해 주세요.",
    );
}
async function versionRecord(context: ContentContext, id: string) {
  parseId(id);
  const [record] = await getDb()
    .select({
      page: wikiPage,
      version: wikiVersion,
      evidenceValid: validEvidenceSql(wikiVersion.id).as("evidence_valid"),
    })
    .from(wikiVersion)
    .innerJoin(wikiPage, eq(wikiPage.id, wikiVersion.pageId))
    .where(
      and(
        eq(wikiVersion.id, id),
        eq(wikiVersion.workspaceId, context.workspaceId),
      ),
    );
  if (!record) throw new AccessError(404, "위키를 찾을 수 없습니다.");
  const privateAccess =
    context.role === "reviewer" ||
    (isWriter(context) && record.version.authorId === context.user.id);
  const publicAccess =
    record.page.publishedVersionId === id &&
    record.version.state === "approved" &&
    record.evidenceValid;
  if (!privateAccess && !publicAccess)
    throw new AccessError(404, "위키를 찾을 수 없습니다.");
  return { ...record, privateAccess };
}
export async function listWiki(
  requestHeaders: Headers,
  workspaceId: string,
  domainId?: string,
) {
  return (
    await listWikiPage(requestHeaders, workspaceId, { domainId, pageSize: 200 })
  ).items;
}
const wikiListInput = pageInput.extend({
  status: z
    .enum([
      "draft",
      "submitted",
      "approved",
      "rejected",
      "withdrawn",
      "superseded",
    ])
    .optional(),
  mine: z.enum(["true", "false"]).optional(),
});
export async function listWikiPage(
  requestHeaders: Headers,
  workspaceId: string,
  input: unknown = {},
) {
  const context = await requireWorkspace(requestHeaders, workspaceId);
  const filter = wikiListInput.parse(input);
  if (filter.domainId)
    await checkScope(workspaceId, filter.domainId, filter.projectId ?? null);
  else if (filter.projectId)
    throw new AccessError(400, "프로젝트 검색에는 도메인이 필요합니다.");
  const visibility = and(
    eq(wikiPage.publishedVersionId, wikiVersion.id),
    eq(wikiVersion.state, "approved"),
    validEvidenceSql(wikiVersion.id),
  );
  const candidates = getDb()
    .selectDistinctOn([wikiPage.id], {
      pageId: sql<string>`${wikiPage.id}`.as("list_page_id"),
      domainId: wikiPage.domainId,
      projectId: wikiPage.projectId,
      publishedVersionId: wikiPage.publishedVersionId,
      version: getTableColumns(wikiVersion),
      evidenceValid: validEvidenceSql(wikiVersion.id).as("evidence_valid"),
    })
    .from(wikiVersion)
    .innerJoin(wikiPage, eq(wikiPage.id, wikiVersion.pageId))
    .where(
      and(
        eq(wikiPage.workspaceId, workspaceId),
        filter.domainId ? eq(wikiPage.domainId, filter.domainId) : undefined,
        filter.projectId
          ? or(
              eq(wikiPage.projectId, filter.projectId),
              isNull(wikiPage.projectId),
            )
          : undefined,
        context.role === "reviewer"
          ? undefined
          : isWriter(context)
            ? or(eq(wikiVersion.authorId, context.user.id), visibility)
            : visibility,
      ),
    )
    .orderBy(
      wikiPage.id,
      desc(wikiVersion.createdAt),
      desc(wikiVersion.number),
      desc(wikiVersion.id),
    )
    .as("page_candidates");
  const condition = and(
    filter.q
      ? or(
          ilike(candidates.version.title, searchPattern(filter.q)),
          ilike(candidates.version.body, searchPattern(filter.q)),
        )
      : undefined,
    filter.status ? eq(candidates.version.state, filter.status) : undefined,
    filter.mine === "true"
      ? eq(candidates.version.authorId, context.user.id)
      : undefined,
  );
  const [items, [summary]] = await Promise.all([
    getDb()
      .select()
      .from(candidates)
      .where(condition)
      .orderBy(desc(candidates.version.createdAt), desc(candidates.pageId))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize),
    getDb().select({ total: count() }).from(candidates).where(condition),
  ]);
  return pageResult(items, summary.total, {
    page: filter.page,
    pageSize: filter.pageSize,
  });
}
export async function wikiDetails(
  requestHeaders: Headers,
  workspaceId: string,
  pageId: string,
  selectedVersionId?: string,
) {
  const context = await requireWorkspace(requestHeaders, workspaceId);
  parseId(pageId);
  const [page] = await getDb()
    .select()
    .from(wikiPage)
    .where(and(eq(wikiPage.id, pageId), eq(wikiPage.workspaceId, workspaceId)));
  if (!page) throw new AccessError(404, "위키를 찾을 수 없습니다.");
  const visible = await getDb()
    .select()
    .from(wikiVersion)
    .where(
      and(
        eq(wikiVersion.pageId, pageId),
        context.role === "reviewer"
          ? undefined
          : isWriter(context)
            ? or(
                eq(wikiVersion.authorId, context.user.id),
                and(
                  eq(wikiVersion.id, page.publishedVersionId ?? randomUUID()),
                  validEvidenceSql(wikiVersion.id),
                ),
              )
            : and(
                eq(wikiVersion.id, page.publishedVersionId ?? randomUUID()),
                validEvidenceSql(wikiVersion.id),
              ),
      ),
    )
    .orderBy(desc(wikiVersion.number));
  const selected = selectedVersionId ?? visible[0]?.id;
  if (!selected) throw new AccessError(404, "위키를 찾을 수 없습니다.");
  const record = await versionRecord(context, selected);
  if (record.page.id !== pageId)
    throw new AccessError(404, "위키 버전을 찾을 수 없습니다.");
  const evidence = await getDb()
    .select({
      id: sourceChunk.id,
      text: sourceChunk.text,
      locator: sourceChunk.locator,
      sourceId: source.id,
      sourceTitle: source.title,
      sourceAuthor: source.createdBy,
      versionId: sourceVersion.id,
      versionNumber: sourceVersion.number,
      mimeType: sourceVersion.mimeType,
      publication: sourceVersion.publication,
      currentVersionId: source.publishedVersionId,
      current: sql<boolean>`source_is_current(${sourceVersion.id})`,
    })
    .from(wikiEvidence)
    .innerJoin(sourceChunk, eq(sourceChunk.id, wikiEvidence.chunkId))
    .innerJoin(sourceVersion, eq(sourceVersion.id, sourceChunk.versionId))
    .innerJoin(source, eq(source.id, sourceVersion.sourceId))
    .where(eq(wikiEvidence.versionId, selected));
  const safeEvidence = evidence.map((item) => ({
    ...item,
    text:
      (item.currentVersionId === item.versionId &&
        item.publication === "published" &&
        item.current) ||
      context.role === "reviewer" ||
      (isWriter(context) && item.sourceAuthor === context.user.id)
        ? item.text
        : "현재 접근할 수 없는 원문입니다.",
    available:
      item.currentVersionId === item.versionId &&
      item.publication === "published" &&
      item.current,
  }));
  let base: typeof wikiVersion.$inferSelect | undefined;
  if (record.privateAccess && record.version.basePublishedVersionId) {
    try {
      base = (
        await versionRecord(context, record.version.basePublishedVersionId)
      ).version;
    } catch (error) {
      if (!(error instanceof AccessError) || error.status !== 404) throw error;
    }
  }
  const decisions = await getDb()
    .select({
      action: reviewDecision.action,
      note: reviewDecision.note,
      createdAt: reviewDecision.createdAt,
    })
    .from(reviewDecision)
    .where(eq(reviewDecision.wikiVersionId, selected))
    .orderBy(desc(reviewDecision.createdAt));
  return {
    page: {
      ...page,
      latestVersionId: isWriter(context) ? page.latestVersionId : undefined,
      versionCount: isWriter(context) ? page.versionCount : undefined,
    },
    version: record.version,
    linkDestinations: {
      ...(await wikiLinkDestinations(
        workspaceId,
        record.version.body,
        {
          domainId: page.domainId,
          projectId: page.projectId,
        },
        record.version.metadata.path,
        record.privateAccess
          ? { userId: context.user.id, reviewer: context.role === "reviewer" }
          : undefined,
      )),
      ...(await archiveMediaDestinations(
        workspaceId,
        page.domainId,
        record.version.metadata.path,
        record.version.id,
        record.version.body,
      )),
    },
    evidenceValid: Boolean(record.evidenceValid),
    versions: visible,
    evidence: safeEvidence,
    base: record.privateAccess ? base : undefined,
    decisions,
    canWrite: isWriter(context),
    canSubmit: isWriter(context) && record.version.authorId === context.user.id,
    canReview: context.role === "reviewer",
    canApprove:
      context.role === "reviewer" &&
      record.version.authorId !== context.user.id,
  };
}
export async function saveWiki(
  requestHeaders: Headers,
  workspaceId: string,
  input: unknown,
  pageId?: string,
) {
  const context = await requireWorkspace(requestHeaders, workspaceId);
  requireWriter(context);
  const data = wikiInput.parse(input);
  await checkScope(workspaceId, data.domainId, data.projectId);
  const id = pageId ? parseId(pageId) : randomUUID();
  const versionId = randomUUID();
  if (pageId) await wikiDetails(requestHeaders, workspaceId, id);
  return getDb().transaction(async (tx) => {
    let page: typeof wikiPage.$inferSelect;
    if (pageId) {
      [page] = await tx
        .select()
        .from(wikiPage)
        .where(and(eq(wikiPage.id, id), eq(wikiPage.workspaceId, workspaceId)))
        .for("update");
      if (page.domainId !== data.domainId || page.projectId !== data.projectId)
        throw new AccessError(
          409,
          "기존 위키의 도메인·프로젝트 범위는 유지해 주세요.",
        );
    } else {
      [page] = await tx
        .insert(wikiPage)
        .values({
          id,
          workspaceId,
          domainId: data.domainId,
          projectId: data.projectId,
          createdBy: context.user.id,
        })
        .returning();
    }
    if (
      page.latestVersionId !== data.parentVersionId ||
      page.publishedVersionId !== data.basePublishedVersionId
    )
      throw new AccessError(
        409,
        "위키가 변경되었습니다. 최신 버전을 열어 차이를 확인한 뒤 다시 저장해 주세요.",
      );
    await checkEvidence(
      tx,
      workspaceId,
      page.domainId,
      page.projectId,
      data.chunkIds,
      true,
    );
    const [previous] = page.latestVersionId
      ? await tx
          .select({ metadata: wikiVersion.metadata })
          .from(wikiVersion)
          .where(eq(wikiVersion.id, page.latestVersionId))
      : [];
    const priorMetadata = previous?.metadata ?? emptyWikiMetadata;
    const referenceIndex = await publishedWikiReferences(workspaceId, {
      domainId: data.domainId,
      projectId: data.projectId,
    });
    const metadata = metadataFromMarkdown(
      data.body,
      workspaceId,
      id,
      {
        ...priorMetadata,
        ...data.classification,
      },
      referenceIndex,
    );
    await tx.insert(wikiVersion).values({
      metadata,
      id: versionId,
      workspaceId,
      pageId: id,
      number: page.versionCount + 1,
      title:
        typeof parseFrontmatter(data.body).frontmatter?.title === "string"
          ? z
              .string()
              .min(1)
              .max(160)
              .parse(parseFrontmatter(data.body).frontmatter?.title)
          : data.title,
      body: data.body,
      basePublishedVersionId: data.basePublishedVersionId,
      authorId: context.user.id,
    });
    if (data.chunkIds.length)
      await tx
        .insert(wikiEvidence)
        .values(
          data.chunkIds.map((chunkId) => ({ workspaceId, versionId, chunkId })),
        );
    await tx
      .update(wikiPage)
      .set({ latestVersionId: versionId, versionCount: page.versionCount + 1 })
      .where(eq(wikiPage.id, id));
    return { pageId: id, versionId };
  });
}
export async function wikiAction(
  requestHeaders: Headers,
  workspaceId: string,
  versionId: string,
  input: unknown,
) {
  const context = await requireWorkspace(requestHeaders, workspaceId);
  const command = reviewInput.parse(input);
  const record = await versionRecord(context, versionId);
  if (command.action === "submit") {
    requireWriter(context);
    if (record.version.authorId !== context.user.id)
      throw new AccessError(403, "본인이 작성한 변경안만 제출할 수 있습니다.");
  } else requireReviewer(context);
  return getDb().transaction(async (tx) => {
    const [page] = await tx
      .select()
      .from(wikiPage)
      .where(eq(wikiPage.id, record.page.id))
      .for("update");
    const [version] = await tx
      .select()
      .from(wikiVersion)
      .where(eq(wikiVersion.id, versionId))
      .for("update");
    const refs = await tx
      .select({ id: wikiEvidence.chunkId })
      .from(wikiEvidence)
      .where(eq(wikiEvidence.versionId, versionId));
    if (command.action === "submit" || command.action === "approve") {
      if (!version.body.trim() || !refs.length)
        throw new AccessError(
          409,
          "본문과 공개 원문의 근거를 한 개 이상 연결해 주세요.",
        );
      if (version.basePublishedVersionId !== page.publishedVersionId)
        throw new AccessError(
          409,
          "게시 기준 버전이 변경되었습니다. 새 변경안을 작성해 다시 검토해 주세요.",
        );
      await checkEvidence(
        tx,
        workspaceId,
        page.domainId,
        page.projectId,
        refs.map((ref) => ref.id),
        true,
      );
    }
    if (command.action === "submit") {
      if (version.state !== "draft")
        throw new AccessError(
          409,
          "초안만 제출할 수 있습니다. 반려된 내용은 새 버전으로 저장해 주세요.",
        );
      await tx
        .update(wikiVersion)
        .set({ state: "submitted" })
        .where(eq(wikiVersion.id, versionId));
    } else if (command.action === "approve") {
      if (version.authorId === context.user.id)
        throw new AccessError(
          409,
          "본인이 작성한 버전은 다른 검토 직원이 승인해야 합니다.",
        );
      if (version.state !== "submitted")
        throw new AccessError(409, "제출된 변경안만 승인할 수 있습니다.");
      if (page.publishedVersionId)
        await tx
          .update(wikiVersion)
          .set({ state: "superseded" })
          .where(eq(wikiVersion.id, page.publishedVersionId));
      await tx
        .update(wikiVersion)
        .set({ state: "approved" })
        .where(eq(wikiVersion.id, versionId));
      await tx
        .update(wikiPage)
        .set({ publishedVersionId: versionId })
        .where(eq(wikiPage.id, page.id));
    } else if (command.action === "reject") {
      if (version.state !== "submitted" || !command.note)
        throw new AccessError(
          409,
          "검토 대기 변경안에 반려 이유를 입력해 주세요.",
        );
      await tx
        .update(wikiVersion)
        .set({ state: "rejected" })
        .where(eq(wikiVersion.id, versionId));
    } else if (command.action === "withdraw") {
      if (page.publishedVersionId !== versionId)
        throw new AccessError(409, "현재 게시본만 철회할 수 있습니다.");
      await tx
        .update(wikiVersion)
        .set({ state: "withdrawn" })
        .where(eq(wikiVersion.id, versionId));
      await tx
        .update(wikiPage)
        .set({ publishedVersionId: null })
        .where(eq(wikiPage.id, page.id));
    } else throw new AccessError(400, "위키에 사용할 수 없는 동작입니다.");
    await tx.insert(reviewDecision).values({
      workspaceId,
      wikiVersionId: versionId,
      actorId: context.user.id,
      action: command.action,
      note: command.note,
    });
    return { id: versionId, action: command.action };
  });
}
