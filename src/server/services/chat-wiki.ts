import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { chatWebAppendix } from "@/lib/chat-web";
import {
  cleanAssistantContentForWikiSave,
  titleFromCleanAssistantContent,
} from "@/lib/reference/chat-save-to-wiki";
import { makeQueryFileName } from "@/lib/reference/wiki-filename";
import { metadataFromMarkdown } from "@/lib/wiki-links";
import { emptyWikiMetadata } from "@/lib/wiki-metadata";
import { AccessError, requireWorkspace } from "@/server/access";
import { getDb } from "@/server/db";
import {
  chatCitation,
  chatMessage,
  chatRun,
  conversation,
  source,
  sourceChunk,
  sourceVersion,
  wikiEvidence,
  wikiPage,
  wikiVersion,
} from "@/server/db/schema";
import { checkScope, requireWriter } from "./content-access";
import { citationsAvailable } from "./retrieval";
import { checkEvidence } from "./wiki";
import { publishedWikiReferences } from "./wiki-references";

// Stable per answer: retrying a request or reloading the page must not create another wiki.
function answerPageId(workspaceId: string, runId: string) {
  const bytes = createHash("sha256")
    .update(`chat-wiki:${workspaceId}:${runId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function saveChatWiki(
  headers: Headers,
  w: string,
  conversationId: string,
  input: unknown,
) {
  const context = await requireWorkspace(headers, w);
  requireWriter(context);
  const data = z
    .object({ action: z.literal("save-wiki"), runId: z.uuid() })
    .strict()
    .parse(input);
  z.uuid().parse(conversationId);
  return getDb().transaction(async (tx) => {
    const [owned] = await tx
      .select()
      .from(conversation)
      .where(
        and(
          eq(conversation.id, conversationId),
          eq(conversation.workspaceId, w),
          eq(conversation.ownerId, context.user.id),
        ),
      )
      .for("update");
    if (!owned) throw new AccessError(404, "대화를 찾을 수 없습니다.");
    const [run] = await tx
      .select()
      .from(chatRun)
      .where(
        and(
          eq(chatRun.id, data.runId),
          eq(chatRun.conversationId, conversationId),
        ),
      )
      .for("share");
    if (!run || run.state !== "completed")
      throw new AccessError(
        409,
        "완료된 답변만 위키 초안으로 저장할 수 있습니다.",
      );
    const rows = await tx
      .select()
      .from(chatCitation)
      .where(eq(chatCitation.runId, run.id));
    const refs = rows.map((row) => row.snapshot);
    const pages = refs.flatMap((ref) => [
      ...(ref.kind === "wiki"
        ? [{ id: ref.id, versionId: ref.versionId }]
        : []),
      ...(ref.linkedPages ?? []),
      ...(ref.graph?.pages ?? []),
    ]);
    const pageIds = [...new Set(pages.map((page) => page.id))].sort();
    if (pageIds.length)
      await tx
        .select({ id: wikiPage.id })
        .from(wikiPage)
        .where(and(eq(wikiPage.workspaceId, w), inArray(wikiPage.id, pageIds)))
        .orderBy(wikiPage.id)
        .for("share");
    const versions = [...new Set(pages.map((page) => page.versionId))];
    const inherited = versions.length
      ? await tx
          .select({ id: wikiEvidence.chunkId })
          .from(wikiEvidence)
          .where(
            and(
              eq(wikiEvidence.workspaceId, w),
              inArray(wikiEvidence.versionId, versions),
            ),
          )
      : [];
    const chunkIds = [
      ...new Set([
        ...refs.flatMap((ref) => [
          ...(ref.chunkId ? [ref.chunkId] : []),
          ...(ref.graph?.sources ?? []).map((item) => item.chunkId),
        ]),
        ...inherited.map((row) => row.id),
      ]),
    ].sort();
    const evidence = chunkIds.length
      ? await tx
          .select({
            id: source.id,
            domainId: source.domainId,
            projectId: source.projectId,
          })
          .from(sourceChunk)
          .innerJoin(sourceVersion, eq(sourceVersion.id, sourceChunk.versionId))
          .innerJoin(source, eq(source.id, sourceVersion.sourceId))
          .where(
            and(eq(source.workspaceId, w), inArray(sourceChunk.id, chunkIds)),
          )
      : [];
    const sourceIds = [...new Set(evidence.map((row) => row.id))].sort();
    if (sourceIds.length)
      await tx
        .select({ id: source.id })
        .from(source)
        .where(and(eq(source.workspaceId, w), inArray(source.id, sourceIds)))
        .orderBy(source.id)
        .for("share");
    if (!(await citationsAvailable(w, run.scope, refs)))
      throw new AccessError(
        409,
        "답변의 근거가 개정되거나 철회되었습니다. 현재 자료로 다시 질문해 주세요.",
      );
    const domains = [...new Set(evidence.map((row) => row.domainId))];
    const projects = [
      ...new Set(
        evidence.flatMap((row) => (row.projectId ? [row.projectId] : [])),
      ),
    ];
    const domainId =
      run.scope.domainId ?? (domains.length === 1 ? domains[0] : null);
    const projectId =
      run.scope.projectId ?? (projects.length === 1 ? projects[0] : null);
    if (
      !domainId ||
      domains.some((id) => id !== domainId) ||
      projects.length > 1
    )
      throw new AccessError(
        409,
        "하나의 도메인·프로젝트로 범위를 좁힌 답변을 저장해 주세요.",
      );
    await checkScope(w, domainId, projectId);
    await checkEvidence(tx, w, domainId, projectId, chunkIds);
    const pageId = answerPageId(w, run.id);
    const [existing] = await tx
      .select()
      .from(wikiPage)
      .where(and(eq(wikiPage.id, pageId), eq(wikiPage.workspaceId, w)));
    if (existing) {
      if (existing.createdBy !== context.user.id)
        throw new AccessError(409, "저장된 위키를 확인하지 못했습니다.");
      return { pageId, versionId: existing.latestVersionId, replay: true };
    }
    const [message] = await tx
      .select()
      .from(chatMessage)
      .where(
        and(eq(chatMessage.runId, run.id), eq(chatMessage.role, "assistant")),
      );
    const clean = cleanAssistantContentForWikiSave(message?.body ?? "");
    if (!clean.trim())
      throw new AccessError(409, "저장할 답변 본문이 없습니다.");
    const title = titleFromCleanAssistantContent(clean);
    const named = makeQueryFileName(title);
    const used = rows
      .filter((row) => row.used)
      .sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)));
    // Reference definitions preserve [E1] markers, code blocks and the answer's exact prose.
    const definitions = used.map(({ snapshot: ref }) => {
      const href = `/w/${w}/${ref.kind === "source" ? "sources" : "wiki"}/${ref.id}?version=${ref.versionId}${ref.chunkId ? `&chunk=${ref.chunkId}` : ""}`;
      return `[${ref.key}]: ${href}`;
    });
    const body = `---\ntype: query\ntitle: ${JSON.stringify(title)}\ncreated: ${named.date}\ntags: []\n---\n\n${clean}${definitions.length ? `\n\n${definitions.join("\n")}` : ""}${chatWebAppendix(run.webReferences)}`;
    if (body.length > 40000 || chunkIds.length > 30)
      throw new AccessError(
        413,
        "위키 초안 저장 한도를 넘었습니다. 답변 범위를 좁혀 주세요.",
      );
    const referenceIndex = await publishedWikiReferences(w, {
      domainId,
      projectId,
    });
    const metadata = metadataFromMarkdown(
      body,
      w,
      pageId,
      {
        ...emptyWikiMetadata,
        type: "query",
        path: `wiki/queries/${named.fileName.replace(/\.md$/, "")}-${pageId.slice(0, 8)}.md`,
      },
      referenceIndex,
    );
    requireWriter(await requireWorkspace(headers, w));
    const versionId = randomUUID();
    await tx.insert(wikiPage).values({
      id: pageId,
      workspaceId: w,
      domainId,
      projectId,
      createdBy: context.user.id,
    });
    await tx.insert(wikiVersion).values({
      id: versionId,
      workspaceId: w,
      pageId,
      number: 1,
      title,
      body,
      metadata,
      authorId: context.user.id,
    });
    if (chunkIds.length)
      await tx
        .insert(wikiEvidence)
        .values(
          chunkIds.map((chunkId) => ({ workspaceId: w, versionId, chunkId })),
        );
    await tx
      .update(wikiPage)
      .set({ latestVersionId: versionId, versionCount: 1 })
      .where(eq(wikiPage.id, pageId));
    return { pageId, versionId, replay: false };
  });
}
