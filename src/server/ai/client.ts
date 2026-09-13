import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { normalizeModelEndpoint, sseRecords } from "@/lib/chat";
import {
  EMBEDDING_INPUT_VERSION,
  embedBoundedTexts,
} from "@/lib/embedding-inputs";
import type { ModelInputMessage } from "@/lib/model-transport";
import { getDb } from "@/server/db";
import { embeddingUsage } from "@/server/db/schema";
import { getServerEnv } from "@/server/env";
import { AccessError } from "@/server/errors";
import { streamCliModel } from "./cli";

export type { ModelMessage } from "@/lib/model-transport";
export type ModelPurpose = "chat" | "knowledge" | "vision";
export function modelProfile(purpose: ModelPurpose) {
  const e = getServerEnv();
  const prefix =
    purpose === "chat"
      ? "AI_CHAT"
      : purpose === "vision"
        ? "AI_VISION"
        : "AI_KNOWLEDGE";
  const model =
    purpose === "vision"
      ? e.AI_VISION_MODEL
      : (e[`${prefix}_MODEL`] ?? e.AI_MODEL);
  const transport = e[`${prefix}_TRANSPORT`] ?? e.AI_TRANSPORT;
  const baseUrl = e[`${prefix}_BASE_URL`] ?? e.AI_BASE_URL;
  const apiKey = e[`${prefix}_API_KEY`] ?? e.AI_API_KEY;
  const contextChars = e[`${prefix}_CONTEXT_CHARS`];
  return {
    model,
    transport,
    baseUrl,
    apiKey,
    contextChars,
    configured: !!(model && (transport !== "api" || (baseUrl && apiKey))),
    identity: createHash("sha256")
      .update(
        JSON.stringify({
          model,
          baseUrl: transport === "api" ? baseUrl : undefined,
          contextChars,
          ...(transport === "api" ? {} : { transport }),
        }),
      )
      .digest("hex"),
  };
}
export function modelStatus() {
  const e = getServerEnv();
  const chat = modelProfile("chat");
  const knowledge = modelProfile("knowledge");
  return {
    chatConfigured: chat.configured,
    visionConfigured: modelProfile("vision").configured,
    knowledgeConfigured: knowledge.configured,
    embeddingConfigured: !!(
      e.AI_EMBEDDING_MODEL &&
      (e.AI_EMBEDDING_BASE_URL || e.AI_BASE_URL)
    ),
    model: chat.model ?? null,
    knowledgeModel: knowledge.model ?? null,
    chatTransport: chat.transport,
    knowledgeTransport: knowledge.transport,
    visionTransport: modelProfile("vision").transport,
    chatContextChars: chat.contextChars,
    knowledgeContextChars: knowledge.contextChars,
    embeddingModel: e.AI_EMBEDDING_MODEL ?? null,
  };
}
export function embeddingIdentity() {
  const e = getServerEnv();
  return `${e.AI_EMBEDDING_MODEL ?? "none"}:${createHash("sha256")
    .update(e.AI_EMBEDDING_BASE_URL ?? e.AI_BASE_URL ?? "")
    .digest("hex")
    .slice(0, 16)}:${EMBEDDING_INPUT_VERSION}:full-body-v2`;
}
type EmbeddingUsageContext = {
  workspaceId: string;
  purpose: "index" | "query" | "connection";
};
export async function embedTexts(
  texts: string[],
  signal?: AbortSignal,
  usageContext?: EmbeddingUsageContext,
) {
  try {
    return await embedBoundedTexts(
      texts,
      (batch) => embedInputBatch(batch, signal, usageContext),
      signal,
    );
  } catch (error) {
    if (error instanceof AccessError || signal?.aborted) throw error;
    throw new AccessError(
      502,
      "임베딩 입력 구간 또는 합친 벡터를 확인하지 못했습니다. 키워드 검색을 사용합니다.",
    );
  }
}
async function embedInputBatch(
  texts: string[],
  signal?: AbortSignal,
  usageContext?: EmbeddingUsageContext,
) {
  const e = getServerEnv();
  const base = e.AI_EMBEDDING_BASE_URL ?? e.AI_BASE_URL;
  if (!base || !e.AI_EMBEDDING_MODEL)
    throw new AccessError(503, "임베딩 모델이 설정되지 않았습니다.");
  const [run] = usageContext
    ? await getDb()
        .insert(embeddingUsage)
        .values({
          ...usageContext,
          model: e.AI_EMBEDDING_MODEL,
          state: "running",
        })
        .returning({ id: embeddingUsage.id })
    : [];
  let inputTokens: number | null = null;
  let completed = false;
  try {
    const key = e.AI_EMBEDDING_API_KEY ?? e.AI_API_KEY;
    const response = await fetch(normalizeModelEndpoint(base, "embeddings"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model: e.AI_EMBEDDING_MODEL,
        input: texts,
        encoding_format: "float",
      }),
      signal: AbortSignal.any([
        AbortSignal.timeout(e.AI_TIMEOUT_SECONDS * 1000),
        ...(signal ? [signal] : []),
      ]),
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok)
      throw new AccessError(
        502,
        `임베딩 요청 실패 (${response.status}). 키워드 검색을 사용합니다.`,
      );
    const payload = z
      .object({
        usage: z
          .object({
            prompt_tokens: z.number().int().nonnegative().max(2147483647),
          })
          .optional(),
        data: z.array(
          z.object({
            index: z.number().int().nonnegative(),
            embedding: z.array(z.number().finite()).min(1).max(16000),
          }),
        ),
      })
      .parse(await response.json());
    inputTokens = payload.usage?.prompt_tokens ?? null;
    const rows = payload.data.sort((a, b) => a.index - b.index);
    if (
      rows.length !== texts.length ||
      rows.some(
        (r, i) =>
          r.index !== i ||
          r.embedding.length !== rows[0].embedding.length ||
          !r.embedding.some((v) => v !== 0),
      )
    )
      throw new AccessError(502, "임베딩 응답 개수·차원·벡터를 확인하세요.");
    completed = true;
    return rows.map((r) => r.embedding);
  } finally {
    if (run)
      await getDb()
        .update(embeddingUsage)
        .set({ inputTokens, state: completed ? "completed" : "failed" })
        .where(eq(embeddingUsage.id, run.id));
  }
}
export async function streamModel(
  messages: ModelInputMessage[],
  onToken: (text: string) => Promise<void>,
  signal: AbortSignal,
  purpose: ModelPurpose = "chat",
  options: { temperature?: number } = {},
) {
  const e = getServerEnv();
  const profile = modelProfile(purpose);
  if (!profile.configured || !profile.model)
    throw new AccessError(
      503,
      "AI 모델이 설정되지 않았습니다. 관리자에게 연결 설정을 요청하세요.",
    );
  if (
    messages.reduce(
      (n, m) =>
        n +
        (typeof m.content === "string"
          ? m.content.length
          : m.content.reduce(
              (size, part) =>
                size + (part.type === "text" ? part.text.length : 4096),
              0,
            )) +
        16,
      0,
    ) > profile.contextChars
  )
    throw new AccessError(
      413,
      "설정한 모델 입력 한도를 넘었습니다. 자료 범위를 줄이거나 문서를 나누어 분석하세요.",
    );
  signal = AbortSignal.any([
    signal,
    AbortSignal.timeout(e.AI_TIMEOUT_SECONDS * 1000),
  ]);
  signal.throwIfAborted();
  if (profile.transport !== "api")
    return streamCliModel({
      transport: profile.transport,
      binary:
        profile.transport === "claude-code"
          ? (e.AI_CLAUDE_CLI_BIN ?? "claude")
          : (e.AI_CODEX_CLI_BIN ?? "codex"),
      model: profile.model,
      messages,
      onToken,
      signal,
      maxConcurrent: e.AI_CLI_MAX_CONCURRENT,
    });
  if (!profile.baseUrl)
    throw new AccessError(503, "모델 API 주소가 설정되지 않았습니다.");
  const response = await fetch(
    normalizeModelEndpoint(profile.baseUrl, "chat/completions"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${profile.apiKey}`,
      },
      body: JSON.stringify({
        model: profile.model,
        ...(options.temperature === undefined
          ? {}
          : { temperature: options.temperature }),
        messages,
        stream: true,
        ...(e.AI_INCLUDE_USAGE
          ? { stream_options: { include_usage: true } }
          : {}),
      }),
      signal,
      redirect: "error",
      cache: "no-store",
    },
  );
  if (!response.ok || !response.body)
    throw new AccessError(
      502,
      `모델 연결 실패 (${response.status}). 관리자에게 연결 상태를 문의하세요.`,
    );
  let finished = false;
  let text = "";
  let usage: { inputTokens: number | null; outputTokens: number | null } = {
    inputTokens: null,
    outputTokens: null,
  };
  for await (const record of sseRecords(response.body)) {
    if (record === "[DONE]") {
      finished = true;
      break;
    }
    const data = JSON.parse(record);
    if (data.error) throw new AccessError(502, "모델이 오류를 반환했습니다.");
    const token = data.choices?.[0]?.delta?.content;
    if (typeof token === "string" && token) {
      text += token;
      if (text.length > 30000)
        throw new AccessError(502, "답변 길이 제한을 넘었습니다.");
      await onToken(token);
    }
    if (data.choices?.[0]?.finish_reason) {
      if (data.choices[0].finish_reason !== "stop")
        throw new AccessError(502, "모델 답변이 완성되기 전에 종료되었습니다.");
      finished = true;
    }
    if (data.usage) {
      usage = {
        inputTokens:
          Number.isSafeInteger(data.usage.prompt_tokens) &&
          data.usage.prompt_tokens >= 0
            ? data.usage.prompt_tokens
            : null,
        outputTokens:
          Number.isSafeInteger(data.usage.completion_tokens) &&
          data.usage.completion_tokens >= 0
            ? data.usage.completion_tokens
            : null,
      };
    }
  }
  if (!finished || !text.trim())
    throw new AccessError(
      502,
      "완성된 답변을 받지 못했습니다. 다시 시도하세요.",
    );
  return { text, ...usage };
}
