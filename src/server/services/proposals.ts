import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { batchInput } from "@/lib/proposals";
import { metadataFromMarkdown } from "@/lib/wiki-links";
import { emptyWikiMetadata } from "@/lib/wiki-metadata";
import { AccessError, requireWorkspace } from "@/server/access";
import { readDomainContext } from "@/server/ai/domain-context";
import { getDb } from "@/server/db";
import {
  aiTask,
  batchDecision,
  changeBatch,
  generation,
  type ProposalItem,
  reviewDecision,
  source,
  sourceChunk,
  sourceVersion,
  wikiEvidence,
  wikiPage,
  wikiVersion,
} from "@/server/db/schema";
import {
  type ContentContext,
  checkScope,
  parseId,
  requireReviewer,
  requireWriter,
  validEvidenceSql,
} from "./content-access";
import {
  assertLatestGroup,
  type ChangeBatch,
  checkGeneratedLinks,
  checkGenerationContext,
  generationGroupSummary,
  groupDependencies,
  hasGeneratedFields,
  latestBatchSql,
  latestGenerationGroups,
  lockGenerationTask,
  revisionItems,
} from "./generation-batches";
import { checkEvidence, type QueryDb, wikiDetails } from "./wiki";

async function batchRecord(context: ContentContext, id: string) {
  parseId(id);
  requireWriter(context);
  const [batch] = await getDb()
    .select()
    .from(changeBatch)
    .where(
      and(
        eq(changeBatch.id, id),
        eq(changeBatch.workspaceId, context.workspaceId),
      ),
    );
  if (
    !batch ||
    (context.role !== "reviewer" && batch.authorId !== context.user.id)
  )
    throw new AccessError(404, "변경 묶음을 찾을 수 없습니다.");
  return batch;
}
export async function checkTargets(
  db: QueryDb,
  w: string,
  domainId: string,
  projectId: string | null,
  items: ProposalItem[],
) {
  const ids = items.flatMap((item) => [
    ...(item.pageId ? [item.pageId] : []),
    ...item.mergedPages.map((p) => p.pageId),
  ]);
  if (new Set(ids).size !== ids.length)
    throw new AccessError(
      400,
      "같은 위키를 한 묶음에서 두 번 변경할 수 없습니다.",
    );
  for (const item of items) {
    const targets = [
      ...(item.pageId
        ? [
            {
              pageId: item.pageId,
              latestVersionId: item.parentVersionId,
              publishedVersionId: item.basePublishedVersionId,
            },
          ]
        : []),
      ...item.mergedPages,
    ];
    for (const target of targets) {
      const [page] = await db
        .select()
        .from(wikiPage)
        .where(
          and(eq(wikiPage.id, target.pageId), eq(wikiPage.workspaceId, w)),
        );
      if (!page || page.domainId !== domainId || page.projectId !== projectId)
        throw new AccessError(404, "같은 범위의 대상 위키를 찾을 수 없습니다.");
      if (
        page.latestVersionId !== target.latestVersionId ||
        page.publishedVersionId !== target.publishedVersionId
      )
        throw new AccessError(
          409,
          "대상 위키가 변경되었습니다. 최신 버전을 반영해 새 변경 묶음으로 저장하세요.",
        );
    }
    for (const merged of item.mergedPages) {
      const refs = await db
        .select({ id: wikiEvidence.chunkId })
        .from(wikiEvidence)
        .where(eq(wikiEvidence.versionId, merged.publishedVersionId));
      if (!refs.length || refs.some((r) => !item.chunkIds.includes(r.id)))
        throw new AccessError(
          409,
          "병합하는 위키의 근거를 모두 연결해 주세요.",
        );
    }
  }
}
export async function listBatches(headers: Headers, w: string) {
  const context = await requireWorkspace(headers, w);
  requireWriter(context);
  return getDb()
    .select({
      id: changeBatch.id,
      title: changeBatch.title,
      state: changeBatch.state,
      origin: changeBatch.origin,
      authorId: changeBatch.authorId,
      createdAt: changeBatch.createdAt,
    })
    .from(changeBatch)
    .where(
      and(
        eq(changeBatch.workspaceId, w),
        latestBatchSql,
        context.role === "reviewer"
          ? undefined
          : eq(changeBatch.authorId, context.user.id),
      ),
    )
    .orderBy(desc(changeBatch.createdAt))
    .limit(100);
}
export async function batchDetails(headers: Headers, w: string, id: string) {
  const context = await requireWorkspace(headers, w);
  const batch = await batchRecord(context, id);
  let available = true,
    unavailableReason = "";
  let groups: ChangeBatch[] = [];
  let analysisTaskId: string | null = null;
  if (batch.taskId) {
    groups = await latestGenerationGroups(getDb(), batch.taskId);
    const [task] = await getDb()
      .select()
      .from(aiTask)
      .where(eq(aiTask.id, batch.taskId));
    analysisTaskId = task?.analysisTaskId ?? null;
    try {
      if (!task) throw new AccessError(409, "생성 작업을 찾을 수 없습니다.");
      await checkGenerationContext(getDb(), task);
    } catch (error) {
      if (!(error instanceof AccessError)) throw error;
      available = false;
      unavailableReason = error.message;
    }
  }
  const latestGroup = groups.find((g) => g.groupOrdinal === batch.groupOrdinal);
  const isLatest = !batch.taskId || latestGroup?.id === batch.id;
  const ids = [...new Set(batch.items.flatMap((item) => item.chunkIds))];
  const refs = await getDb()
    .select({
      id: sourceChunk.id,
      text: sourceChunk.text,
      locator: sourceChunk.locator,
      sourceId: source.id,
      title: source.title,
      versionId: sourceVersion.id,
      currentId: source.publishedVersionId,
      publication: sourceVersion.publication,
      current: sql<boolean>`source_is_current(${sourceVersion.id})`,
    })
    .from(sourceChunk)
    .innerJoin(sourceVersion, eq(sourceVersion.id, sourceChunk.versionId))
    .innerJoin(source, eq(source.id, sourceVersion.sourceId))
    .where(and(eq(source.workspaceId, w), inArray(sourceChunk.id, ids)));
  const evidence = refs.map((r) => ({
    ...r,
    available:
      r.currentId === r.versionId && r.publication === "published" && r.current,
    text:
      r.currentId === r.versionId && r.publication === "published" && r.current
        ? r.text
        : "현재 접근할 수 없는 원문입니다.",
  }));
  const decisions = await getDb()
    .select()
    .from(batchDecision)
    .where(eq(batchDecision.batchId, id))
    .orderBy(desc(batchDecision.createdAt));
  const bases = await Promise.all(
    batch.items.map(async (item) => {
      if (!item.pageId) return null;
      try {
        return (
          await wikiDetails(
            headers,
            w,
            item.pageId,
            item.basePublishedVersionId ?? item.parentVersionId ?? undefined,
          )
        ).version;
      } catch (error) {
        if (error instanceof AccessError && error.status === 404) return null;
        throw error;
      }
    }),
  );
  return {
    batch: available
      ? batch
      : { ...batch, items: [], warnings: [], results: [] },
    evidence: available ? evidence : [],
    decisions,
    bases: available ? bases : [],
    available,
    unavailableReason,
    isLatest,
    latestBatchId: latestGroup?.id ?? null,
    analysisTaskId,
    groups: generationGroupSummary(groups).map((g) =>
      available ? g : { ...g, pages: [], results: [] },
    ),
    canSubmit: available && isLatest && batch.authorId === context.user.id,
    canReview: available && isLatest && context.role === "reviewer",
    canApprove:
      available &&
      isLatest &&
      context.role === "reviewer" &&
      batch.authorId !== context.user.id,
  };
}
export async function createBatch(
  headers: Headers,
  w: string,
  input: unknown,
  origin: "manual" | "source" | "answer" = "manual",
  job?: {
    id: string;
    usage: { inputTokens: number | null; outputTokens: number | null };
    domainRulesHash?: string;
  },
) {
  const context = await requireWorkspace(headers, w);
  requireWriter(context);
  const data = batchInput.parse(input);
  await checkScope(w, data.domainId, data.projectId);
  const predecessor = data.predecessorId
    ? await batchRecord(context, data.predecessorId)
    : null;
  if (!predecessor?.taskId && hasGeneratedFields(data.items))
    throw new AccessError(
      400,
      "자동 생성 필드는 해당 생성 묶음을 수정할 때만 사용할 수 있습니다.",
    );
  if (
    predecessor?.taskId &&
    (predecessor.authorId !== context.user.id ||
      predecessor.domainId !== data.domainId ||
      predecessor.projectId !== data.projectId)
  )
    throw new AccessError(
      403,
      "본인이 생성한 묶음의 도메인·프로젝트 범위를 유지해 주세요.",
    );
  for (const item of data.items) {
    if (item.pageId) await wikiDetails(headers, w, item.pageId);
    for (const merged of item.mergedPages)
      await wikiDetails(headers, w, merged.pageId, merged.publishedVersionId);
  }
  const ids = [...new Set(data.items.flatMap((item) => item.chunkIds))];
  return getDb().transaction(async (tx) => {
    let generated: Partial<
      Pick<
        ChangeBatch,
        "taskId" | "groupOrdinal" | "groupRevision" | "dependencies"
      >
    > = {};
    if (predecessor?.taskId) {
      await lockGenerationTask(tx, w, predecessor.taskId);
      const groups = await latestGenerationGroups(tx, predecessor.taskId);
      assertLatestGroup(predecessor, groups);
      const current = groups.find((g) => g.id === predecessor.id);
      if (!current || current.state === "approved")
        throw new AccessError(
          409,
          "이미 승인한 묶음은 게시 위키에서 수정해 주세요.",
        );
      data.items = revisionItems(current, data.items, groups);
      const dependencies = groupDependencies(
        current.groupOrdinal as number,
        data.items,
        groups,
      );
      await checkGeneratedLinks(
        tx,
        { ...current, items: data.items, dependencies },
        groups,
      );
      generated = {
        taskId: current.taskId,
        groupOrdinal: current.groupOrdinal,
        groupRevision: current.groupRevision + 1,
        dependencies,
      };
    }
    if (
      job?.domainRulesHash &&
      (await readDomainContext(tx, w, data.domainId, true)).rulesHash !==
        job.domainRulesHash
    )
      throw new AccessError(
        409,
        "도메인 기준이 바뀌어 변경안을 저장하지 않았습니다. 현재 기준으로 다시 생성해 주세요.",
      );
    await checkEvidence(tx, w, data.domainId, data.projectId, ids, true);
    await checkTargets(tx, w, data.domainId, data.projectId, data.items);
    const warnings: string[] = [];
    const published = await tx
      .select({
        id: wikiPage.id,
        title: wikiVersion.title,
        body: wikiVersion.body,
      })
      .from(wikiPage)
      .innerJoin(wikiVersion, eq(wikiVersion.id, wikiPage.publishedVersionId))
      .where(
        and(
          eq(wikiPage.workspaceId, w),
          eq(wikiPage.domainId, data.domainId),
          data.projectId
            ? eq(wikiPage.projectId, data.projectId)
            : isNull(wikiPage.projectId),
          validEvidenceSql(wikiVersion.id),
        ),
      )
      .limit(200);
    for (const item of data.items) {
      if (
        published.some(
          (p) =>
            p.id !== item.pageId &&
            p.title.replace(/\s/g, "") === item.title.replace(/\s/g, ""),
        )
      )
        warnings.push(
          `‘${item.title}’: 같은 제목의 게시 위키가 있습니다. 중복·병합 여부를 확인하세요.`,
        );
      if (item.kind === "conflict")
        warnings.push(
          `‘${item.title}’: 모순 확인 제안은 바로 게시할 수 없습니다. 근거를 확인하고 새 변경 묶음으로 수정해 주세요.`,
        );
      if (/반드시|금지|이상|이하|않|예외/.test(item.body))
        warnings.push(
          `‘${item.title}’: 의무·부정·수치·예외 표현을 원문과 대조하세요. 자동 검사는 의미 일치를 보증하지 않습니다.`,
        );
    }
    const [batch] = await tx
      .insert(changeBatch)
      .values({
        ...data,
        workspaceId: w,
        authorId: context.user.id,
        origin: predecessor?.taskId ? "analysis" : origin,
        ...generated,
        warnings,
      })
      .returning();
    if (job) {
      const completed = await tx
        .update(generation)
        .set({ state: "completed", batchId: batch.id, ...job.usage })
        .where(and(eq(generation.id, job.id), eq(generation.state, "running")))
        .returning({ id: generation.id });
      if (!completed.length)
        throw new AccessError(
          409,
          "생성 작업이 종료되어 제안을 저장하지 않았습니다. 다시 시도하세요.",
        );
    }
    return { id: batch.id };
  });
}
export async function batchAction(
  headers: Headers,
  w: string,
  id: string,
  input: unknown,
) {
  const { z } = await import("zod");
  const command = z
    .object({
      action: z.enum(["submit", "approve", "reject"]),
      note: z.string().trim().max(2000).default(""),
    })
    .strict()
    .parse(input);
  const context = await requireWorkspace(headers, w);
  const initial = await batchRecord(context, id);
  if (command.action === "submit") {
    if (initial.authorId !== context.user.id)
      throw new AccessError(403, "본인의 변경 묶음만 제출할 수 있습니다.");
  } else requireReviewer(context);
  return getDb().transaction(async (tx) => {
    let groups: ChangeBatch[] = [];
    if (initial.taskId) {
      await lockGenerationTask(tx, w, initial.taskId);
      groups = await latestGenerationGroups(tx, initial.taskId);
      assertLatestGroup(initial, groups);
    }
    const [batch] = await tx
      .select()
      .from(changeBatch)
      .where(eq(changeBatch.id, id))
      .for("update");
    if (
      command.action === "submit"
        ? batch.state !== "draft"
        : batch.state !== "submitted"
    )
      throw new AccessError(
        409,
        "현재 상태에서 처리할 수 없습니다. 화면을 새로 열어 주세요.",
      );
    if (command.action === "reject" && !command.note)
      throw new AccessError(400, "수정 요청 이유를 입력해 주세요.");
    if (command.action === "approve" && batch.authorId === context.user.id)
      throw new AccessError(
        409,
        "본인의 변경 묶음은 다른 검토 직원이 승인해야 합니다.",
      );
    const results: { pageId: string; versionId: string }[] = [];
    if (command.action !== "reject") {
      const targets = batch.items
        .flatMap((item) => [
          ...(item.pageId ? [item.pageId] : []),
          ...item.mergedPages.map((p) => p.pageId),
        ])
        .sort();
      for (const target of targets)
        await tx.execute(
          sql`SELECT id FROM ${wikiPage} WHERE id=${target} FOR UPDATE`,
        );
      if (batch.taskId)
        await checkGeneratedLinks(
          tx,
          batch,
          groups,
          command.action === "approve",
        );
      await checkTargets(tx, w, batch.domainId, batch.projectId, batch.items);
      await checkEvidence(
        tx,
        w,
        batch.domainId,
        batch.projectId,
        [...new Set(batch.items.flatMap((item) => item.chunkIds))],
        true,
      );
    }
    if (command.action === "approve") {
      if (
        batch.items.some(
          (item) => item.kind === "conflict" || item.requiresResolution,
        )
      )
        throw new AccessError(
          409,
          "모순 확인 제안이 남아 있습니다. 확인 후 새 변경 묶음으로 작성하세요.",
        );
      for (const item of batch.items) {
        const pageId = item.pageId ?? item.plannedPageId ?? randomUUID();
        const versionId = randomUUID();
        if (!item.pageId)
          await tx.insert(wikiPage).values({
            id: pageId,
            workspaceId: w,
            domainId: batch.domainId,
            projectId: batch.projectId,
            createdBy: batch.authorId,
          });
        const [page] = await tx
          .select()
          .from(wikiPage)
          .where(eq(wikiPage.id, pageId));
        const [prior] =
          !item.metadata && page.latestVersionId
            ? await tx
                .select({ metadata: wikiVersion.metadata })
                .from(wikiVersion)
                .where(eq(wikiVersion.id, page.latestVersionId))
            : [];
        const metadata = metadataFromMarkdown(
          item.body,
          w,
          pageId,
          item.metadata ?? prior?.metadata ?? emptyWikiMetadata,
        );
        await tx.insert(wikiVersion).values({
          id: versionId,
          workspaceId: w,
          pageId,
          number: page.versionCount + 1,
          title: item.title,
          body: item.body,
          metadata,
          authorId: batch.authorId,
          basePublishedVersionId: item.basePublishedVersionId,
          state: "approved",
        });
        await tx.insert(wikiEvidence).values(
          item.chunkIds.map((chunkId) => ({
            workspaceId: w,
            versionId,
            chunkId,
          })),
        );
        if (page.publishedVersionId)
          await tx
            .update(wikiVersion)
            .set({ state: "superseded" })
            .where(eq(wikiVersion.id, page.publishedVersionId));
        await tx
          .update(wikiPage)
          .set({
            latestVersionId: versionId,
            publishedVersionId: versionId,
            versionCount: page.versionCount + 1,
          })
          .where(eq(wikiPage.id, pageId));
        await tx.insert(reviewDecision).values({
          workspaceId: w,
          wikiVersionId: versionId,
          actorId: context.user.id,
          action: "approve",
          note: `변경 묶음 ${id} 승인. ${command.note}`,
        });
        for (const merged of item.mergedPages) {
          await tx
            .update(wikiVersion)
            .set({ state: "withdrawn" })
            .where(eq(wikiVersion.id, merged.publishedVersionId));
          await tx
            .update(wikiPage)
            .set({ publishedVersionId: null })
            .where(eq(wikiPage.id, merged.pageId));
          await tx.insert(reviewDecision).values({
            workspaceId: w,
            wikiVersionId: merged.publishedVersionId,
            actorId: context.user.id,
            action: "withdraw",
            note: `변경 묶음 ${id}에서 ${pageId}에 병합`,
          });
        }
        results.push({ pageId, versionId });
      }
    }
    await tx
      .update(changeBatch)
      .set({
        state:
          command.action === "submit"
            ? "submitted"
            : command.action === "approve"
              ? "approved"
              : "rejected",
        ...(command.action === "approve" ? { results } : {}),
      })
      .where(eq(changeBatch.id, id));
    await tx.insert(batchDecision).values({
      batchId: id,
      actorId: context.user.id,
      action: command.action,
      note: command.note,
    });
    return { id, action: command.action, results };
  });
}
