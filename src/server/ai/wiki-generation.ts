import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { proposalItemInput } from "@/lib/proposals";
import {
  assertGenerationBudget,
  type GeneratedSections,
  type GenerationAnalysis,
  GenerationBudgetError,
  type GenerationPlan,
  generationMessages,
  groupWikiPlans,
  type PlannedWikiPage,
  validateGeneratedSections,
  validateWikiPlan,
  wikiPagePrompt,
  wikiPlanPrompt,
} from "@/lib/wiki-generation";
import { escapeMarkdownLabel, wikiLinksFromMarkdown } from "@/lib/wiki-links";
import { type WikiMetadata, wikiMetadataSchema } from "@/lib/wiki-metadata";
import { getDb } from "@/server/db";
import { aiStep, changeBatch, type ProposalItem } from "@/server/db/schema";
import { AccessError } from "@/server/errors";
import { checkTargets } from "@/server/services/proposals";
import { checkEvidence } from "@/server/services/wiki";
import {
  type GenerationKnowledge,
  loadGenerationKnowledge,
  planPayload,
  verifyGenerationKnowledge,
} from "./generation-knowledge";
import {
  candidateForModel,
  reusablePageSections,
  revisionPlanInstruction,
} from "./generation-revisions";
import { ingestKnowledgeStamp } from "./ingest-context";
import {
  generationAnalysis,
  type taskSource,
  verifyTask,
} from "./task-context";
import type { TaskExecution } from "./task-execution";
import { mergeGeneratedWiki } from "./wiki-merge";

// RFC 9562 UUIDv5, with the task UUID as namespace. Retries and revisions use
// the same page identifiers before any wiki_page row becomes public.
export function plannedPageId(taskId: string, key: string) {
  const bytes = createHash("sha1")
    .update(Buffer.from(taskId.replaceAll("-", ""), "hex"))
    .update(key)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x50;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function pagePayload(
  source: Awaited<ReturnType<typeof taskSource>>,
  analysis: GenerationAnalysis,
  knowledge: GenerationKnowledge,
  page: PlannedWikiPage,
) {
  const target = knowledge.candidates.find((c) => c.pageId === page.pageId);
  return {
    sourceTitle: source.title,
    sourceId: source.sourceId,
    category: source.category,
    domain: source.rules,
    page,
    claims: analysis.claims.filter((c) => page.claimIds.includes(c.id)),
    existingWiki: target ? candidateForModel(target) : null,
    mergedWikis: knowledge.candidates
      .filter((c) => page.mergedPageIds.includes(c.pageId))
      .map(candidateForModel),
  };
}
function makeItem(
  run: TaskExecution,
  plan: GenerationPlan,
  page: PlannedWikiPage,
  result: GeneratedSections,
  analysis: GenerationAnalysis,
  knowledge: GenerationKnowledge,
  reuseContent = false,
  merge?: { mergedBody: string; fallback: boolean; replaced: boolean },
): ProposalItem {
  const target = knowledge.candidates.find((c) => c.pageId === page.pageId);
  const merged = knowledge.candidates.filter((c) =>
    page.mergedPageIds.includes(c.pageId),
  );
  const links = page.links.map((link) => {
    const planned = plan.pages.find((p) => p.key === link.key);
    const existing = knowledge.candidates.find(
      (c) => `wiki:${c.pageId}` === link.key,
    );
    const id = planned?.plannedPageId ?? existing?.pageId;
    if (!id || id === page.plannedPageId)
      throw new AccessError(
        502,
        "존재하지 않거나 자기 자신인 위키 링크입니다.",
      );
    return {
      pageId: id,
      title: planned?.title ?? existing?.title ?? "",
      reason: link.reason,
    };
  });
  const parts =
    reuseContent && target
      ? [target.body]
      : merge
        ? [merge.mergedBody]
        : [
            ...result.sections.map(
              (s) => `## ${escapeMarkdownLabel(s.heading)}\n\n${s.content}`,
            ),
            ...(links.length
              ? [
                  `## 관련 위키\n\n${links.map((link) => `- [${escapeMarkdownLabel(link.title)}](/w/${run.task.workspaceId}/wiki/${link.pageId})`).join("\n")}`,
                ]
              : []),
          ];
  const body = parts.join("\n\n");
  const reasons = new Map(
    [
      ...(target?.metadata.links ?? []),
      ...merged.flatMap((c) => c.metadata.links),
      ...links,
    ].map((l) => [l.pageId, l.reason]),
  );
  const metadata: WikiMetadata = wikiMetadataSchema.parse({
    type: target?.metadata.type ?? page.type,
    aliases: [
      ...new Set([...(target?.metadata.aliases ?? []), ...page.aliases]),
    ],
    links: wikiLinksFromMarkdown(body, run.task.workspaceId)
      .filter((id) => id !== page.plannedPageId)
      .map((pageId) => ({
        pageId,
        reason: reasons.get(pageId) ?? "기존 본문에서 연결한 위키",
      })),
  });
  if (body.length > 20000)
    throw new AccessError(
      413,
      "기존 본문을 보존한 변경안이 20,000자를 넘었습니다. 내용을 나누어 새 계획으로 생성해 주세요. 본문을 잘라 저장하지 않았습니다.",
    );
  const chunkIds = [
    ...new Set([
      ...analysis.claims
        .filter((c) => page.claimIds.includes(c.id))
        .flatMap((c) => c.evidence.map((e) => e.chunkId)),
      ...(target?.chunkIds ?? []),
      ...merged.flatMap((c) => c.chunkIds),
    ]),
  ];
  if (chunkIds.length > 30)
    throw new AccessError(
      413,
      "한 위키에 연결할 원문 근거가 30문단을 넘었습니다. 지식을 더 작은 페이지로 나누어 다시 계획해 주세요.",
    );
  return proposalItemInput.parse({
    kind: result.conflict && page.kind === "update" ? "conflict" : page.kind,
    pageId: page.pageId,
    parentVersionId: target?.latestVersionId ?? null,
    basePublishedVersionId: target?.publishedVersionId ?? null,
    title: target?.title ?? page.title,
    body,
    reason: page.reason,
    chunkIds,
    plannedPageId: page.plannedPageId,
    metadata,
    claimIds: page.claimIds,
    requiresResolution:
      result.conflict ||
      !!merge?.fallback ||
      (!!target?.revision && !reuseContent) ||
      page.kind === "conflict" ||
      metadata.links.some((l) =>
        plan.pages.some((p) => p.mergedPageIds.includes(l.pageId)),
      ),
    questions: [
      ...new Set([
        ...page.questions,
        ...result.questions,
        ...(merge?.fallback
          ? [
              "자동 병합 결과를 검증하지 못해 새 원문으로 생성한 본문을 제안했습니다. 변경 전 버전과 비교해 빠진 내용을 확인하세요.",
            ]
          : []),
        ...(target?.revision && !reuseContent
          ? [
              "개정 전 본문과 새 원문의 조건을 대조하고, 바뀌거나 사라진 내용을 수정해 주세요.",
            ]
          : []),
      ]),
    ],
    mergedPages: merged.map((c) => ({
      pageId: c.pageId,
      latestVersionId: c.latestVersionId,
      publishedVersionId: c.publishedVersionId,
    })),
  });
}
export async function executeWikiGeneration(
  run: TaskExecution,
): Promise<Record<string, unknown>> {
  const task = run.task;
  const source = await verifyTask(getDb(), task);
  const analysis = await generationAnalysis(getDb(), task);
  if (!task.profile)
    throw new AccessError(409, "지식 생성 모델 설정이 필요합니다.");
  const [prepared] = await getDb()
    .select()
    .from(aiStep)
    .where(and(eq(aiStep.taskId, task.id), eq(aiStep.ordinal, 0)));
  let knowledge = prepared?.result?.knowledge as
    | GenerationKnowledge
    | undefined;
  if (!knowledge) {
    try {
      knowledge = await loadGenerationKnowledge(
        getDb(),
        task,
        source,
        analysis,
      );
    } catch (error) {
      if (error instanceof GenerationBudgetError)
        throw new AccessError(413, error.message);
      throw error;
    }
  }
  await verifyGenerationKnowledge(getDb(), task, knowledge);
  const planMessages = generationMessages(
    wikiPlanPrompt + (task.ingestRunId ? `\n${revisionPlanInstruction}` : ""),
    planPayload(source, analysis, knowledge, task.projectId),
  );
  assertGenerationBudget(planMessages, task.profile.contextChars);
  await run.prepare([
    {
      ordinal: 0,
      kind: "generation-prepare",
      state: "completed",
      input: {
        analysisTaskId: task.analysisTaskId,
        sourceVersionId: task.sourceVersionId,
      },
      result: {
        knowledge,
        knowledgeStamp: task.ingestRunId
          ? await ingestKnowledgeStamp(getDb(), {
              ...task,
              sourceId: source.sourceId,
            })
          : null,
        coverage: analysis.coverage,
        analysisQuestions: analysis.questions,
      },
    },
    {
      ordinal: 1,
      kind: "plan-wiki",
      input: { analysisTaskId: task.analysisTaskId },
    },
  ]);
  const rawPlan = await run.model(1, planMessages, (value) =>
    validateWikiPlan(value, analysis, knowledge.candidates, task.projectId),
  );
  const pages = rawPlan.pages.map((p) => ({
    ...p,
    plannedPageId: p.pageId ?? plannedPageId(task.id, p.key),
  }));
  for (const page of pages) {
    const preserved = knowledge.candidates.filter(
      (c) => c.pageId === page.pageId || page.mergedPageIds.includes(c.pageId),
    );
    for (const id of preserved.flatMap((c) =>
      wikiLinksFromMarkdown(c.body, task.workspaceId),
    )) {
      const target = pages.find((p) => p.plannedPageId === id);
      if (
        target &&
        target.key !== page.key &&
        !page.links.some((l) => l.key === target.key)
      )
        page.links.push({
          key: target.key,
          reason: "기존 본문에서 연결한 위키",
        });
    }
  }
  const plan: GenerationPlan = {
    ...rawPlan,
    pages,
    groups: groupWikiPlans(pages),
  };
  const mergePages = pages.filter((page) => page.pageId);
  const mergeOrdinal = new Map(
    mergePages.map((page, index) => [page.key, pages.length + index + 2]),
  );
  const finalOrdinal = pages.length + mergePages.length + 2;
  await run.prepare([
    ...pages.map((page, index) => ({
      ordinal: index + 2,
      kind: "generate-wiki",
      input: { page },
    })),
    ...mergePages.map((page) => ({
      ordinal: mergeOrdinal.get(page.key) as number,
      kind: "merge-wiki",
      input: { page },
    })),
    { ordinal: finalOrdinal, kind: "assemble-wiki", input: { plan } },
  ]);
  const items: ProposalItem[] = [];
  let reusedPages = 0;
  for (const [index, page] of pages.entries()) {
    const messages = generationMessages(
      wikiPagePrompt,
      pagePayload(source, analysis, knowledge, page),
    );
    try {
      assertGenerationBudget(messages, task.profile.contextChars);
    } catch (error) {
      throw new AccessError(
        413,
        error instanceof Error
          ? error.message
          : "페이지 생성 입력 공간이 부족합니다.",
      );
    }
    const destinations = page.links.flatMap((link) => {
      const id =
        plan.pages.find((p) => p.key === link.key)?.plannedPageId ??
        knowledge.candidates.find((c) => `wiki:${c.pageId}` === link.key)
          ?.pageId;
      return id ? [id] : [];
    });
    const reuse = reusablePageSections(
      knowledge.candidates.find((c) => c.pageId === page.pageId),
      page,
      analysis,
      destinations,
    );
    if (reuse) {
      makeItem(run, plan, page, reuse.result, analysis, knowledge, true);
      await run.save(index + 2, reuse.result, reuse.stepId);
      reusedPages++;
    }
    const result = await run.model(index + 2, messages, (value) => {
      const parsed = validateGeneratedSections(value, page, analysis.claims);
      // Validate the fully assembled item before marking a model step complete.
      makeItem(run, plan, page, parsed, analysis, knowledge, !!reuse);
      return parsed;
    });
    const incoming = makeItem(
      run,
      plan,
      page,
      result,
      analysis,
      knowledge,
      !!reuse,
    );
    const oldPages = knowledge.candidates
      .filter(
        (candidate) =>
          candidate.pageId === page.pageId ||
          page.mergedPageIds.includes(candidate.pageId),
      )
      .sort(
        (a, b) =>
          Number(b.pageId === page.pageId) - Number(a.pageId === page.pageId),
      );
    const mergedResult = page.pageId
      ? await mergeGeneratedWiki({
          run,
          ordinal: mergeOrdinal.get(page.key) as number,
          incoming: incoming.body,
          title: incoming.title,
          type: incoming.metadata?.type ?? page.type,
          sourceId: source.sourceId,
          existing: oldPages,
          reuse: !!reuse,
        })
      : undefined;
    items.push(
      makeItem(
        run,
        plan,
        page,
        result,
        analysis,
        knowledge,
        !!reuse,
        mergedResult,
      ),
    );
  }
  return getDb().transaction(async (tx) => {
    await run.guard(tx);
    await checkTargets(
      tx,
      task.workspaceId,
      task.domainId,
      task.projectId,
      items,
    );
    await checkEvidence(tx, task.workspaceId, task.domainId, task.projectId, [
      ...new Set(items.flatMap((i) => i.chunkIds)),
    ]);
    const batchIds: string[] = [];
    for (const group of plan.groups) {
      const grouped = group.pageKeys.map(
        (key) => items[pages.findIndex((p) => p.key === key)],
      );
      const [existing] = await tx
        .select()
        .from(changeBatch)
        .where(
          and(
            eq(changeBatch.taskId, task.id),
            eq(changeBatch.groupOrdinal, group.ordinal),
            eq(changeBatch.groupRevision, 1),
          ),
        );
      if (existing) {
        if (
          !isDeepStrictEqual(existing.items, grouped) ||
          !isDeepStrictEqual(existing.dependencies, group.dependencies)
        )
          throw new AccessError(
            409,
            "저장된 검토 묶음과 생성 계획이 다릅니다. 새 작업을 시작해 주세요.",
          );
        batchIds.push(existing.id);
        continue;
      }
      const id = randomUUID();
      await tx.insert(changeBatch).values({
        id,
        workspaceId: task.workspaceId,
        domainId: task.domainId,
        projectId: task.projectId,
        authorId: task.authorId,
        taskId: task.id,
        groupOrdinal: group.ordinal,
        groupRevision: 1,
        dependencies: group.dependencies,
        title: `${source.title.slice(0, 130)} · 변경 ${group.ordinal}/${plan.groups.length}`,
        origin: "analysis",
        items: grouped,
        warnings: [
          "전체 분석과 원본 병합 규칙으로 생성한 변경안입니다. 변경 전후 본문·적용 조건과 원문을 대조한 뒤 검토를 요청하세요.",
          ...knowledge.excluded.map((e) => `${e.title}: ${e.reason}`),
          ...grouped
            .filter((i) => i.requiresResolution)
            .map(
              (i) =>
                `‘${i.title}’: 모순 또는 기존 내용 교체가 필요합니다. 새 묶음에서 내용을 수정하고 확인 완료를 표시하세요.`,
            ),
          ...grouped.flatMap((i) =>
            (i.questions ?? []).map((q) => `‘${i.title}’ 확인 질문: ${q}`),
          ),
        ],
      });
      batchIds.push(id);
    }
    const result = {
      summary: plan.summary,
      cache: { reusedPages, generatedPages: pages.length - reusedPages },
      pages: plan.pages,
      groups: plan.groups,
      batchIds,
      analysisTaskId: task.analysisTaskId,
      coverage: analysis.coverage,
      questions: [...new Set([...analysis.questions, ...plan.questions])],
      excluded: knowledge.excluded,
    };
    await tx
      .update(aiStep)
      .set({ state: "completed", result, errorMessage: null })
      .where(and(eq(aiStep.taskId, task.id), eq(aiStep.ordinal, finalOrdinal)));
    return result;
  });
}
