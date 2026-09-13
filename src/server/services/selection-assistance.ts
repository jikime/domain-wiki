import "server-only";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { normalizeEditableMarkdown } from "@/lib/reference/selection-edit";
import { buildSelectionPrompt } from "@/lib/reference/selection-prompt";
import {
  type SelectionInput,
  selectionInputSchema,
} from "@/lib/selection-assistance";
import { AccessError, requireWorkspace } from "@/server/access";
import {
  type ModelMessage,
  modelProfile,
  streamModel,
} from "@/server/ai/client";
import { getDb } from "@/server/db";
import {
  type ChatScope,
  type CitationSnapshot,
  generation,
  wikiPage,
  wikiVersion,
} from "@/server/db/schema";
import { getServerEnv } from "@/server/env";
import {
  checkScope,
  isWriter,
  requireWriter,
  validEvidenceSql,
} from "./content-access";
import { checkAiCapacity } from "./operations";
import { citationsAvailable, retrieveKnowledge } from "./retrieval";
import { wikiLinkDestinations } from "./wiki-references";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function selectionBasis(
  headers: Headers,
  w: string,
  data: SelectionInput,
  includeBody = false,
) {
  const context = await requireWorkspace(headers, w);
  if (data.intent === "edit" || data.body !== undefined) requireWriter(context);
  await checkScope(w, data.scope.domainId, data.scope.projectId);
  if (!data.scope.pageId) {
    requireWriter(context);
    if (
      data.body === undefined ||
      data.scope.versionId ||
      data.scope.latestVersionId
    )
      throw new AccessError(400, "편집할 새 문서의 본문을 확인하세요.");
    return { context, body: data.body, path: "wiki/new.md" };
  }
  const [row] = await getDb()
    .select({
      domainId: wikiPage.domainId,
      projectId: wikiPage.projectId,
      latestId: wikiPage.latestVersionId,
      publishedId: wikiPage.publishedVersionId,
      versionId: wikiVersion.id,
      authorId: wikiVersion.authorId,
      state: wikiVersion.state,
      body: includeBody ? wikiVersion.body : sql<string>`''`,
      metadata: wikiVersion.metadata,
      valid: validEvidenceSql(wikiVersion.id),
    })
    .from(wikiPage)
    .innerJoin(wikiVersion, eq(wikiPage.id, wikiVersion.pageId))
    .where(
      and(
        eq(wikiPage.workspaceId, w),
        eq(wikiPage.id, data.scope.pageId),
        eq(wikiVersion.id, data.scope.versionId ?? data.requestId),
      ),
    );
  if (
    !row ||
    row.domainId !== data.scope.domainId ||
    row.projectId !== data.scope.projectId ||
    !(
      context.role === "reviewer" ||
      (isWriter(context) && row.authorId === context.user.id) ||
      (row.publishedId === row.versionId &&
        row.state === "approved" &&
        row.valid)
    )
  )
    throw new AccessError(404, "선택한 문서에 현재 접근할 수 없습니다.");
  if (
    (data.intent === "edit" || data.body !== undefined) &&
    row.latestId !== data.scope.latestVersionId
  )
    throw new AccessError(
      409,
      "문서의 새 버전이 저장되었습니다. 최신 문서를 연 뒤 다시 선택해 주세요.",
    );
  return {
    context,
    body: data.body ?? row.body,
    path: row.metadata.path ?? `wiki/${data.scope.pageId}.md`,
  };
}
export async function assistSelection(
  request: Request,
  w: string,
  input: unknown,
) {
  const data = selectionInputSchema.parse(input);
  if (
    data.intent === "edit" &&
    (!data.selection.sourceMapped || data.body === undefined)
  )
    throw new AccessError(400, "수정할 원문 범위를 정확히 선택해 주세요.");
  const basis = await selectionBasis(request.headers, w, data, true);
  const body = normalizeEditableMarkdown(basis.body);
  const selected = data.selection;
  if (
    selected.sourceMapped &&
    (selected.end <= selected.start ||
      selected.end > body.length ||
      body.slice(selected.start, selected.end) !== selected.selectedText)
  )
    throw new AccessError(
      409,
      "선택한 원문이 변경되었습니다. 다시 선택해 주세요.",
    );
  const identity = hash({
    scope: data.scope,
    body: data.body,
    selection: selected,
  });
  const scope: ChatScope = {
    domainId: data.scope.domainId,
    projectId: data.scope.projectId,
    sourceId: null,
    wikiId: null,
  };
  const dependencies: CitationSnapshot[] = [];
  for (const turn of data.history) {
    const [previous] = await getDb()
      .select()
      .from(generation)
      .where(
        and(
          eq(generation.id, turn.id),
          eq(generation.workspaceId, w),
          eq(generation.authorId, basis.context.user.id),
        ),
      );
    if (
      previous?.kind !== "selection-ask" ||
      previous.state !== "completed" ||
      previous.result?.identity !== identity ||
      previous.result?.questionHash !== hash(turn.question) ||
      previous.result?.answerHash !== hash(turn.answer)
    )
      throw new AccessError(
        409,
        "이어질 질문의 대화를 확인하지 못했습니다. 새 선택으로 시작해 주세요.",
      );
    dependencies.push(...(previous.result.references as CitationSnapshot[]));
  }
  if (!(await citationsAvailable(w, scope, dependencies)))
    throw new AccessError(
      409,
      "이전 답변의 근거가 변경되었습니다. 새 선택으로 다시 질문해 주세요.",
    );
  if (data.action === "validate") return { valid: true };
  const profile = modelProfile("chat");
  if (!profile.configured)
    throw new AccessError(
      503,
      "AI 모델이 설정되지 않았습니다. 관리자에게 연결 설정을 요청하세요.",
    );
  const run = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${w}, 3))`,
    );
    const [existing] = await tx
      .select({ id: generation.id })
      .from(generation)
      .where(
        and(
          eq(generation.workspaceId, w),
          eq(generation.authorId, basis.context.user.id),
          eq(generation.requestId, data.requestId),
        ),
      );
    if (existing)
      throw new AccessError(
        409,
        "이미 사용한 요청 번호입니다. 새 요청으로 다시 시도해 주세요.",
      );
    await checkAiCapacity(tx, w);
    const [row] = await tx
      .insert(generation)
      .values({
        workspaceId: w,
        authorId: basis.context.user.id,
        requestId: data.requestId,
        inputHash: hash(data),
        kind: `selection-${data.intent}`,
        state: "running",
        model: profile.model,
      })
      .returning({ id: generation.id });
    return row;
  });
  const abort = new AbortController();
  const signal = AbortSignal.any([
    request.signal,
    abort.signal,
    AbortSignal.timeout(
      Math.min(getServerEnv().AI_TIMEOUT_SECONDS, 120) * 1000,
    ),
  ]);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => {
        if (!signal.aborted)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
      };
      let checking = false;
      const guard = async () => {
        signal.throwIfAborted();
        await selectionBasis(request.headers, w, data);
        if (!(await citationsAvailable(w, scope, dependencies)))
          throw new AccessError(
            409,
            "답변에 사용한 근거가 변경되어 중지했습니다. 다시 선택해 주세요.",
          );
      };
      const timer = setInterval(async () => {
        if (checking || signal.aborted) return;
        checking = true;
        try {
          await guard();
        } catch (error) {
          abort.abort(error);
        } finally {
          checking = false;
        }
      }, 1000);
      let usage = {
        inputTokens: null as number | null,
        outputTokens: null as number | null,
      };
      try {
        const refs =
          data.intent === "ask"
            ? (
                await retrieveKnowledge(
                  request.headers,
                  w,
                  scope,
                  `${data.instruction} ${selected.selectedText.slice(0, 500)}`,
                  signal,
                  { kind: "wiki", graph: false, limit: 5 },
                )
              ).refs
            : [];
        dependencies.push(...refs);
        await guard();
        const references = refs.map((ref, index) => ({
          key: String(index + 1),
          title: ref.title,
          href: ref.href,
          text: ref.text.slice(0, 230),
        }));
        send({ type: "references", references });
        const prompt = buildSelectionPrompt(
          data.intent,
          basis.path,
          data.instruction,
          {
            prefix: body.slice(0, selected.start),
            selectedText: selected.selectedText,
            suffix: body.slice(selected.end),
            sourceMapped: selected.sourceMapped,
          },
          refs.map((ref) => ({
            title: ref.title,
            path: `wiki/${ref.id}.md`,
            snippet: ref.text.slice(0, 230),
          })),
        );
        const history: ModelMessage[] = data.history.flatMap((turn) => [
          { role: "user" as const, content: turn.question },
          { role: "assistant" as const, content: turn.answer },
        ]);
        // Preserve the selected text. Fit older turns by removing complete pairs only.
        while (
          history.length &&
          history.reduce(
            (n, m) => n + m.content.length + 16,
            prompt.length + 16,
          ) > profile.contextChars
        )
          history.splice(0, 2);
        const result = await streamModel(
          [...history, { role: "user", content: prompt }],
          async (text) => {
            await guard();
            send({ type: "token", text });
          },
          signal,
          "chat",
          { temperature: data.intent === "edit" ? 0.2 : 0.4 },
        );
        usage = {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        };
        const linkDestinations =
          data.intent === "ask"
            ? await wikiLinkDestinations(w, result.text, scope, basis.path)
            : {};
        await guard();
        // Persist only hashes and reference identities; selection text and answers stay in this view.
        const safeReferences = [
          ...new Map(
            dependencies.map((ref) => [
              JSON.stringify([
                ref.kind,
                ref.id,
                ref.versionId,
                ref.linkedPages,
              ]),
              ref,
            ]),
          ).values(),
        ].map((ref) => ({
          ...ref,
          title: "",
          text: "",
          href: "",
        }));
        await getDb()
          .update(generation)
          .set({
            state: "completed",
            ...usage,
            result: {
              identity,
              questionHash: hash(data.instruction),
              answerHash: hash(result.text.slice(-6000)),
              references: safeReferences,
            },
            updatedAt: new Date(),
          })
          .where(eq(generation.id, run.id));
        send({ type: "done", id: run.id, linkDestinations });
      } catch (error) {
        const reason = signal.aborted ? signal.reason : error;
        const message =
          reason instanceof AccessError
            ? reason.message
            : signal.aborted
              ? "답변 생성을 중지했습니다."
              : "답변을 완성하지 못했습니다. 다시 시도해 주세요.";
        await getDb()
          .update(generation)
          .set({
            state: "failed",
            ...usage,
            errorMessage: message,
            updatedAt: new Date(),
          })
          .where(eq(generation.id, run.id));
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: message })}\n\n`,
            ),
          );
        } catch {
          /* Browser already disconnected. */
        }
      } finally {
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* Browser already disconnected. */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
