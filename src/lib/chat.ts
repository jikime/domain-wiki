import { z } from "zod";
import { imageInput, MAX_IMAGES_PER_MESSAGE } from "./chat-images";
import { researchProviders } from "./research";
export const chatScopeInput = z
  .object({
    domainId: z.uuid().nullable().default(null),
    projectId: z.uuid().nullable().default(null),
    sourceId: z.uuid().nullable().default(null),
    wikiId: z.uuid().nullable().default(null),
    sourceOnly: z.boolean().optional(),
    agentMode: z.enum(["fast", "standard", "deep"]).optional(),
    webProvider: z.enum(researchProviders).optional(),
  })
  .strict();
export function chatScopeKey(scope: z.infer<typeof chatScopeInput>) {
  return JSON.stringify([
    scope.domainId,
    scope.projectId,
    scope.sourceId,
    scope.wikiId,
    !!scope.sourceOnly,
    scope.webProvider ?? null,
  ]);
}
export const conversationInput = z
  .object({
    title: z.string().trim().min(1).max(160).default("새 대화"),
    scope: chatScopeInput,
  })
  .strict();
export const questionInput = z
  .object({
    requestId: z.uuid(),
    prompt: z.string().trim().max(4000),
    images: z.array(imageInput).max(MAX_IMAGES_PER_MESSAGE).default([]),
  })
  .strict()
  .refine(
    (input) => !!input.prompt || input.images.length > 0,
    "질문이나 이미지를 입력하세요.",
  );
export const runLabels: Record<string, string> = {
  running: "답변 작성 중",
  completed: "답변 완료",
  failed: "실패",
  canceled: "중지됨",
  interrupted: "연결 중단",
  restricted: "근거 확인 필요",
};
// Adapted from llm_wiki's parseLines and endpoint normalization; no Tauri/browser credentials.
export function normalizeModelEndpoint(
  raw: string,
  path: "chat/completions" | "embeddings",
) {
  const url = new URL(raw.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("모델 API 주소 형식을 확인하세요.");
  url.pathname = `${url.pathname.replace(/\/+$/, "").replace(/\/(chat\/completions|embeddings)$/i, "")}/${path}`;
  return url.toString();
}
export async function* sseRecords(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      if (buffer.length > 1_000_000)
        throw new Error("스트림 응답이 너무 큽니다.");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      if (done && buffer) {
        lines.push(buffer);
        buffer = "";
      }
      for (const line of lines)
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data) yield data;
        }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function retrievalTokens(query: string) {
  const stop = new Set([
    "관련",
    "대해",
    "알려줘",
    "알려주세요",
    "무엇인가요",
    "어떻게",
    "그럼",
    "무엇",
    "먼저",
    "내용은",
  ]);
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map((t) =>
          t.replace(/(에서는|에서|으로|에는|은|는|을|를|이|가|와|과|의)$/, ""),
        )
        .filter((t) => t.length > 1 && !stop.has(t)),
    ),
  ].slice(0, 24);
}
export function reciprocalRanks(lists: string[][]) {
  const scores = new Map<string, number>();
  for (const list of lists)
    for (const [index, id] of [...new Set(list)].entries())
      scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + index + 1));
  return [...scores].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
