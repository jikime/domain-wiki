import "server-only";
import { and, count, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { chatScopeKey, conversationInput, questionInput } from "@/lib/chat";
import type { AgentToolEvent } from "@/lib/chat-agent";
import { MAX_IMAGES_PER_MESSAGE } from "@/lib/chat-images";
import { pageInput, pageResult, searchPattern } from "@/lib/pagination";
import { AccessError, requireWorkspace } from "@/server/access";
import { answerWithAgent } from "@/server/ai/chat-agent";
import { modelStatus } from "@/server/ai/client";
import { getDb } from "@/server/db";
import {
  chatCitation,
  chatFeedback,
  chatImage,
  chatMessage,
  chatRun,
  conversation,
} from "@/server/db/schema";
import { getServerEnv } from "@/server/env";
import {
  chatImageColumns,
  historyChatImages,
  validateChatImages,
} from "./chat-images";
import { validateChatWeb } from "./chat-web";
import { parseId } from "./content-access";
import { checkAiCapacity } from "./operations";
import { citationsAvailable, validateChatScope } from "./retrieval";
import { wikiLinkDestinations } from "./wiki-references";

async function owned(headers: Headers, w: string, id: string) {
  const context = await requireWorkspace(headers, w);
  parseId(id);
  const [item] = await getDb()
    .select()
    .from(conversation)
    .where(
      and(
        eq(conversation.id, id),
        eq(conversation.workspaceId, w),
        eq(conversation.ownerId, context.user.id),
      ),
    );
  if (!item) throw new AccessError(404, "대화를 찾을 수 없습니다.");
  return item;
}
async function expireRuns(id: string) {
  await getDb()
    .update(chatRun)
    .set({
      state: "interrupted",
      errorMessage: "연결이 종료되어 답변이 중단되었습니다.",
    })
    .where(
      and(
        eq(chatRun.conversationId, id),
        eq(chatRun.state, "running"),
        sql`${chatRun.updatedAt} < now() - interval '30 seconds'`,
      ),
    );
}
export async function listConversations(headers: Headers, w: string) {
  return (await listConversationPage(headers, w, { pageSize: 100 })).items;
}
export async function listConversationPage(
  headers: Headers,
  w: string,
  input: unknown = {},
) {
  const c = await requireWorkspace(headers, w);
  const filter = pageInput.parse(input);
  const condition = and(
    eq(conversation.workspaceId, w),
    eq(conversation.ownerId, c.user.id),
    filter.q ? ilike(conversation.title, searchPattern(filter.q)) : undefined,
  );
  const [items, [summary]] = await Promise.all([
    getDb()
      .select()
      .from(conversation)
      .where(condition)
      .orderBy(desc(conversation.updatedAt), desc(conversation.id))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize),
    getDb().select({ total: count() }).from(conversation).where(condition),
  ]);
  return pageResult(items, summary.total, {
    page: filter.page,
    pageSize: filter.pageSize,
  });
}
export async function createConversation(
  headers: Headers,
  w: string,
  input: unknown,
) {
  const c = await requireWorkspace(headers, w);
  const data = conversationInput.parse(input);
  await validateChatScope(w, data.scope);
  const [saved] = await getDb()
    .insert(conversation)
    .values({ ...data, workspaceId: w, ownerId: c.user.id })
    .returning();
  return saved;
}
export async function updateConversation(
  headers: Headers,
  w: string,
  id: string,
  input: unknown,
) {
  await owned(headers, w, id);
  const data = conversationInput.parse(input);
  await validateChatScope(w, data.scope);
  return getDb().transaction(async (tx) => {
    await tx
      .select()
      .from(conversation)
      .where(eq(conversation.id, id))
      .for("update");
    const [run] = await tx
      .select()
      .from(chatRun)
      .where(and(eq(chatRun.conversationId, id), eq(chatRun.state, "running")));
    if (run) throw new AccessError(409, "답변을 중지한 뒤 범위를 바꿔주세요.");
    const [saved] = await tx
      .update(conversation)
      .set(data)
      .where(eq(conversation.id, id))
      .returning();
    return saved;
  });
}
export async function conversationDetails(
  headers: Headers,
  w: string,
  id: string,
) {
  const item = await owned(headers, w, id);
  await expireRuns(id);
  const runs = await getDb()
    .select()
    .from(chatRun)
    .where(eq(chatRun.conversationId, id))
    .orderBy(chatRun.createdAt, chatRun.id);
  const ids = runs.map((r) => r.id);
  const [messages, refs, feedback, images] = ids.length
    ? await Promise.all([
        getDb()
          .select()
          .from(chatMessage)
          .where(inArray(chatMessage.runId, ids)),
        getDb()
          .select()
          .from(chatCitation)
          .where(inArray(chatCitation.runId, ids)),
        getDb()
          .select()
          .from(chatFeedback)
          .where(inArray(chatFeedback.runId, ids)),
        getDb()
          .select(chatImageColumns)
          .from(chatImage)
          .where(inArray(chatImage.runId, ids))
          .orderBy(chatImage.ordinal),
      ])
    : [[], [], [], []];
  const views = await Promise.all(
    runs.map(async (r) => {
      const citations = refs
        .filter((c) => c.runId === r.id)
        .sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)));
      const available = await citationsAvailable(
        w,
        r.scope,
        citations.map((c) => c.snapshot),
      );
      return {
        ...r,
        webReferences: available ? r.webReferences : [],
        images: images
          .filter((image) => image.runId === r.id)
          .map((image) => ({
            id: image.id,
            name: image.name,
            mediaType: image.mediaType,
            href: `/api/workspaces/${w}/conversations/${id}/images/${image.id}`,
          })),
        state: available ? r.state : "restricted",
        errorMessage: available
          ? r.errorMessage
          : "근거가 개정되거나 철회되어 답변을 숨겼습니다. 현재 자료로 다시 질문하세요.",
        messages: messages
          .filter((m) => m.runId === r.id)
          .map((m) => ({
            ...m,
            body:
              available || m.role === "user"
                ? m.body
                : "현재 확인할 수 없는 근거를 포함한 답변입니다.",
          })),
        citations: available ? citations : [],
        toolEvents: available ? r.toolEvents : [],
        linkDestinations:
          available && !r.scope.sourceOnly
            ? await wikiLinkDestinations(
                w,
                messages
                  .filter((m) => m.runId === r.id && m.role === "assistant")
                  .map((m) => m.body)
                  .join("\n\n"),
                r.scope,
              )
            : {},
        feedback: feedback.find((f) => f.runId === r.id) ?? null,
      };
    }),
  );
  return { conversation: item, runs: views, model: modelStatus() };
}
export async function cancelRun(
  headers: Headers,
  w: string,
  id: string,
  runId: string,
) {
  await owned(headers, w, id);
  parseId(runId);
  const [run] = await getDb()
    .update(chatRun)
    .set({ state: "canceled", errorMessage: "직원이 답변을 중지했습니다." })
    .where(
      and(
        eq(chatRun.id, runId),
        eq(chatRun.conversationId, id),
        eq(chatRun.state, "running"),
      ),
    )
    .returning();
  return { canceled: !!run };
}
export async function saveFeedback(
  headers: Headers,
  w: string,
  id: string,
  input: unknown,
) {
  const item = await owned(headers, w, id);
  const data = z
    .object({
      runId: z.uuid(),
      rating: z.enum(["helpful", "incorrect"]),
      note: z.string().trim().max(2000).default(""),
    })
    .strict()
    .parse(input);
  const [run] = await getDb()
    .select()
    .from(chatRun)
    .where(and(eq(chatRun.id, data.runId), eq(chatRun.conversationId, id)));
  if (!run || run.state !== "completed")
    throw new AccessError(404, "완료된 답변을 찾을 수 없습니다.");
  const [saved] = await getDb()
    .insert(chatFeedback)
    .values({ ...data, workspaceId: w, authorId: item.ownerId })
    .onConflictDoUpdate({
      target: [chatFeedback.authorId, chatFeedback.runId],
      set: {
        rating: data.rating,
        note: data.note,
        state: "open",
        updatedAt: new Date(),
      },
    })
    .returning();
  return saved;
}
export async function chatStream(
  request: Request,
  w: string,
  id: string,
  input: unknown,
) {
  const item = await owned(request.headers, w, id);
  const data = questionInput.parse(input);
  const prompt = data.prompt || "첨부한 이미지를 살펴보고 설명해 주세요.";
  const images = await validateChatImages(data.images);
  await expireRuns(id);
  await validateChatScope(w, item.scope);
  const env = getServerEnv();
  const prepared = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${w}, 3))`,
    );
    const [current] = await tx
      .select()
      .from(conversation)
      .where(eq(conversation.id, id))
      .for("update");
    const [existing] = await tx
      .select()
      .from(chatRun)
      .where(
        and(
          eq(chatRun.conversationId, id),
          eq(chatRun.requestId, data.requestId),
        ),
      );
    if (existing) {
      const stored = await tx
        .select({
          sha256: chatImage.sha256,
          mediaType: chatImage.mediaType,
          name: chatImage.name,
        })
        .from(chatImage)
        .where(eq(chatImage.runId, existing.id))
        .orderBy(chatImage.ordinal);
      if (
        existing.prompt !== prompt ||
        stored.length !== images.length ||
        stored.some(
          (image, i) =>
            image.sha256 !== images[i].sha256 ||
            image.mediaType !== images[i].mediaType ||
            image.name !== images[i].name,
        )
      )
        throw new AccessError(409, "이미 사용한 요청 번호입니다.");
      return { run: existing, replay: true };
    }
    const active = await tx
      .select()
      .from(chatRun)
      .where(
        and(
          eq(chatRun.workspaceId, w),
          eq(chatRun.state, "running"),
          sql`${chatRun.updatedAt} >= now() - interval '30 seconds'`,
        ),
      );
    if (active.some((r) => r.conversationId === id))
      throw new AccessError(409, "이 대화에서 답변을 작성 중입니다.");
    await checkAiCapacity(tx, w);
    const [run] = await tx
      .insert(chatRun)
      .values({
        workspaceId: w,
        conversationId: id,
        requestId: data.requestId,
        prompt,
        scope: current.scope,
        model: modelStatus().model,
      })
      .returning();
    await tx.insert(chatMessage).values({
      workspaceId: w,
      runId: run.id,
      role: "user",
      body: prompt,
    });
    if (images.length)
      await tx.insert(chatImage).values(
        images.map((image, ordinal) => ({
          ...image,
          workspaceId: w,
          runId: run.id,
          ordinal,
        })),
      );
    await tx
      .update(conversation)
      .set({
        title:
          current.title === "새 대화" ? prompt.slice(0, 60) : current.title,
        updatedAt: new Date(),
      })
      .where(eq(conversation.id, id));
    return { run, replay: false };
  });
  const { run } = prepared;
  const abort = new AbortController();
  const signal = AbortSignal.any([
    abort.signal,
    request.signal,
    AbortSignal.timeout(env.AI_TIMEOUT_SECONDS * 1000),
  ]);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, payload: unknown) => {
        if (!closed) {
          try {
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify({ type: event, ...(payload as Record<string, unknown>) })}\n\n`,
              ),
            );
          } catch {
            closed = true;
            abort.abort();
          }
        }
      };
      const finish = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      send("run", { runId: run.id, replay: prepared.replay });
      if (prepared.replay) {
        try {
          send("done", await conversationDetails(request.headers, w, id));
        } catch {
          send("error", { error: "대화를 불러오지 못했습니다." });
        }
        finish();
        return;
      }
      let refs: Parameters<typeof citationsAvailable>[2] = [];
      let text = "";
      let restricted = false;
      let checking = false;
      const guard = async () => {
        await requireWorkspace(request.headers, w);
        validateChatWeb(w, run.scope);
        const [current] = await getDb()
          .select({ state: chatRun.state })
          .from(chatRun)
          .where(eq(chatRun.id, run.id));
        if (current?.state !== "running")
          throw new AccessError(409, "답변이 중지되었습니다.");
        if (!(await citationsAvailable(w, run.scope, refs))) {
          restricted = true;
          throw new AccessError(409, "답변의 근거가 변경되어 중지했습니다.");
        }
      };
      const timer = setInterval(async () => {
        if (checking) return;
        checking = true;
        try {
          await guard();
          await getDb()
            .update(chatRun)
            .set({ updatedAt: new Date() })
            .where(and(eq(chatRun.id, run.id), eq(chatRun.state, "running")));
          send("heartbeat", {});
        } catch {
          abort.abort();
        } finally {
          checking = false;
        }
      }, 1000);
      try {
        const history = await conversationDetails(request.headers, w, id);
        const previous = history.runs
          .filter(
            (r) =>
              r.id !== run.id &&
              r.state === "completed" &&
              chatScopeKey(r.scope) === chatScopeKey(run.scope),
          )
          .slice(-4);
        const query = [previous.at(-1)?.prompt, prompt]
          .filter(Boolean)
          .join(" ");
        const toolEvents: AgentToolEvent[] = [];
        const priorImages = await historyChatImages(
          w,
          [...previous]
            .reverse()
            .flatMap((r) => r.images.map((image) => image.id))
            .slice(0, MAX_IMAGES_PER_MESSAGE - images.length),
        );
        const result = await answerWithAgent({
          headers: request.headers,
          workspaceId: w,
          scope: run.scope,
          prompt,
          images: data.images,
          priorImages,
          query,
          previous,
          signal,
          guard,
          onEvidence: async (found, mode, notice, webReferences) => {
            refs = [...found];
            await guard();
            if (refs.length)
              await getDb()
                .insert(chatCitation)
                .values(
                  refs.map((snapshot) => ({
                    workspaceId: w,
                    runId: run.id,
                    key: snapshot.key,
                    snapshot,
                  })),
                )
                .onConflictDoNothing();
            await getDb()
              .update(chatRun)
              .set({ webReferences })
              .where(and(eq(chatRun.id, run.id), eq(chatRun.state, "running")));
            send("sources", { citations: refs, webReferences, mode, notice });
          },
          onTool: async (event) => {
            toolEvents.push(event);
            await getDb()
              .update(chatRun)
              .set({ toolEvents: [...toolEvents] })
              .where(and(eq(chatRun.id, run.id), eq(chatRun.state, "running")));
            send("tool", { event });
          },
          onToken: async (token) => {
            text += token;
            send("token", { text: token });
          },
        });
        const usage = result;
        await guard();
        // Persist every document consulted, so later revocation also protects
        // tool history and conclusions informed by an earlier observation.
        for (const snapshot of result.refs)
          await getDb()
            .update(chatCitation)
            .set({ snapshot })
            .where(
              and(
                eq(chatCitation.runId, run.id),
                eq(chatCitation.key, snapshot.key),
              ),
            );
        await getDb()
          .update(chatRun)
          .set({
            retrievalMode: result.mode,
            webReferences: result.webReferences,
          })
          .where(eq(chatRun.id, run.id));
        send("sources", {
          citations: result.refs,
          webReferences: result.webReferences,
          mode: result.mode,
          notice: result.notice,
        });
        if (!text) {
          text = result.text;
          send("token", { text });
        }
        const keys = [...result.text.matchAll(/\[([EW]\d+)\]/g)].map(
          (m) => m[1],
        );
        if (
          ((refs.length || result.webReferences.length) && !keys.length) ||
          keys.some(
            (key) =>
              ![...result.refs, ...result.webReferences].some(
                (r) => r.key === key,
              ),
          )
        )
          throw new AccessError(
            502,
            "답변의 근거 표시를 검증하지 못했습니다. 다시 시도하세요.",
          );
        if (keys.length)
          await getDb()
            .update(chatCitation)
            .set({ used: true })
            .where(
              and(
                eq(chatCitation.runId, run.id),
                inArray(chatCitation.key, keys),
              ),
            );
        await guard();
        signal.throwIfAborted();
        await getDb().transaction(async (tx) => {
          const [current] = await tx
            .select()
            .from(chatRun)
            .where(eq(chatRun.id, run.id))
            .for("update");
          if (current.state !== "running")
            throw new AccessError(409, "답변이 중지되었습니다.");
          await tx.insert(chatMessage).values({
            workspaceId: w,
            runId: run.id,
            role: "assistant",
            body: text,
          });
          await tx
            .update(chatRun)
            .set({
              state: "completed",
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              errorMessage: null,
              webReferences: result.webReferences.map((ref) => ({
                ...ref,
                used: keys.includes(ref.key),
              })),
            })
            .where(eq(chatRun.id, run.id));
        });
        send("done", await conversationDetails(request.headers, w, id));
      } catch (error) {
        const state = restricted
          ? "restricted"
          : request.signal.aborted || closed
            ? "interrupted"
            : signal.aborted
              ? "interrupted"
              : "failed";
        const message = restricted
          ? "근거가 변경되어 답변을 중지했습니다."
          : error instanceof AccessError
            ? error.message
            : signal.aborted
              ? "연결 또는 응답 시간이 초과되어 중단했습니다."
              : "답변을 만들지 못했습니다. 다시 시도하세요.";
        await getDb()
          .transaction(async (tx) => {
            await tx
              .update(chatRun)
              .set({ state, errorMessage: message })
              .where(and(eq(chatRun.id, run.id), eq(chatRun.state, "running")));
            await tx
              .insert(chatMessage)
              .values({
                workspaceId: w,
                runId: run.id,
                role: "assistant",
                body: "완성되지 않은 답변입니다. 다시 질문해주세요.",
              })
              .onConflictDoNothing();
          })
          .catch(() => {});
        send("error", { error: message });
      } finally {
        clearInterval(timer);
        finish();
      }
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
