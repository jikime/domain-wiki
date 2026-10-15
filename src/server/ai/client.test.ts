import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamCliModel } from "./cli";
import { modelProfile, modelStatus, streamModel } from "./client";

vi.mock("@/server/db", () => ({ getDb: vi.fn() }));
vi.mock("./cli", () => ({
  streamCliModel: vi.fn(async (input) => {
    await input.onToken("CLI 응답");
    return { text: "CLI 응답", inputTokens: 10, outputTokens: 2 };
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(process.env))
    if (/^(AI_|OPENAI_)/.test(key)) vi.stubEnv(key, undefined);
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "test-secret-012345678901234567890123456789",
  );
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3010");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("공통 모델 호출", () => {
  it("초기 설정에서 채팅·지식 생성을 CLI로 보내고 HTTP를 호출하지 않는다", async () => {
    vi.stubEnv("OPENAI_API_KEY", "existing-embedding-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const purpose of ["chat", "knowledge"] as const) {
      await streamModel(
        [{ role: "user", content: "기본 연결 확인" }],
        async () => {},
        AbortSignal.timeout(1000),
        purpose,
      );
      expect(streamCliModel).toHaveBeenLastCalledWith(
        expect.objectContaining({ transport: "claude-code", model: "sonnet" }),
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("기존 API 요청·스트리밍·사용량을 유지한다", async () => {
    vi.stubEnv("AI_TRANSPORT", "api");
    vi.stubEnv("AI_MODEL", "test-model");
    vi.stubEnv("AI_BASE_URL", "https://example.test/v1");
    vi.stubEnv("AI_API_KEY", "test-api-key");
    const fetchMock = vi.fn(
      async () =>
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"API 응답"}}]}',
            'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":3}}',
            "data: [DONE]",
            "",
          ].join("\n\n"),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const chunks: string[] = [];
    const result = await streamModel(
      [{ role: "user", content: "질문" }],
      async (text) => {
        chunks.push(text);
      },
      AbortSignal.timeout(1000),
      "chat",
      { temperature: 0.1 },
    );
    expect(result).toEqual({
      text: "API 응답",
      inputTokens: 12,
      outputTokens: 3,
    });
    expect(chunks).toEqual(["API 응답"]);
    expect(streamCliModel).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const options = (
      fetchMock.mock.calls as unknown as [string, RequestInit][]
    )[0][1];
    expect(JSON.parse(String(options.body))).toEqual({
      model: "test-model",
      messages: [{ role: "user", content: "질문" }],
      stream: true,
      temperature: 0.1,
      stream_options: { include_usage: true },
    });
  });

  it.each([
    "claude-code",
    "codex-cli",
  ])("%s는 HTTP 대신 CLI로 전달한다", async (transport) => {
    vi.stubEnv("AI_TRANSPORT", transport);
    vi.stubEnv("AI_MODEL", "cli-model");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(modelStatus().chatConfigured).toBe(true);
    expect(modelStatus().knowledgeConfigured).toBe(true);
    expect(modelStatus().visionConfigured).toBe(false);
    const result = await streamModel(
      [{ role: "user", content: "질문" }],
      async () => {},
      AbortSignal.timeout(1000),
    );
    expect(result.text).toBe("CLI 응답");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(streamCliModel).toHaveBeenCalledWith(
      expect.objectContaining({ transport, model: "cli-model" }),
    );
  });

  it("지식 생성·이미지 설명에도 용도별 연결을 적용한다", async () => {
    vi.stubEnv("AI_TRANSPORT", "api");
    vi.stubEnv("OPENAI_API_KEY", "test-api-key");
    vi.stubEnv("AI_KNOWLEDGE_TRANSPORT", "claude-code");
    vi.stubEnv("AI_KNOWLEDGE_MODEL", "sonnet");
    vi.stubEnv("AI_VISION_TRANSPORT", "codex-cli");
    vi.stubEnv("AI_VISION_MODEL", "vision-model");
    expect(modelProfile("chat").transport).toBe("api");
    expect(modelProfile("knowledge").transport).toBe("claude-code");
    expect(modelStatus().visionConfigured).toBe(true);
    await streamModel(
      [{ role: "user", content: "지식 생성" }],
      async () => {},
      AbortSignal.timeout(1000),
      "knowledge",
    );
    expect(streamCliModel).toHaveBeenLastCalledWith(
      expect.objectContaining({ transport: "claude-code", model: "sonnet" }),
    );
    await streamModel(
      [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,aW1hZ2U=" },
            },
          ],
        },
      ],
      async () => {},
      AbortSignal.timeout(1000),
      "vision",
    );
    expect(streamCliModel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        transport: "codex-cli",
        model: "vision-model",
      }),
    );
  });

  it.each([
    "claude-code",
    "codex-cli",
  ])("%s 실패 시 기존 키가 있어도 API를 자동 호출하지 않는다", async (transport) => {
    vi.stubEnv("OPENAI_API_KEY", "test-api-key");
    vi.stubEnv("AI_CHAT_TRANSPORT", transport);
    vi.stubEnv("AI_CHAT_MODEL", "cli-model");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(streamCliModel).mockRejectedValueOnce(new Error("CLI 한도 초과"));
    await expect(
      streamModel(
        [{ role: "user", content: "질문" }],
        async () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("CLI 한도 초과");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("호출자가 시간 제한을 주지 않아도 공통 시간 제한을 CLI에 전달한다", async () => {
    vi.stubEnv("AI_TRANSPORT", "claude-code");
    vi.stubEnv("AI_MODEL", "sonnet");
    vi.stubEnv("AI_TIMEOUT_SECONDS", "5");
    const deadline = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(deadline.signal);
    await streamModel(
      [{ role: "user", content: "질문" }],
      async () => {},
      new AbortController().signal,
    );
    expect(timeout).toHaveBeenCalledWith(5000);
    const signal = vi.mocked(streamCliModel).mock.calls[0][0].signal;
    expect(signal.aborted).toBe(false);
    const reason = new DOMException("시간 초과", "TimeoutError");
    deadline.abort(reason);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
  });

  it("CLI에서도 입력 한도·취소를 실행 전에 검사한다", async () => {
    vi.stubEnv("AI_TRANSPORT", "claude-code");
    vi.stubEnv("AI_MODEL", "sonnet");
    vi.stubEnv("AI_CHAT_CONTEXT_CHARS", "4000");
    await expect(
      streamModel(
        [{ role: "user", content: "x".repeat(4001) }],
        async () => {},
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow("입력 한도");
    const signal = AbortSignal.abort(new Error("중지"));
    await expect(
      streamModel([{ role: "user", content: "질문" }], async () => {}, signal),
    ).rejects.toThrow("중지");
    expect(streamCliModel).not.toHaveBeenCalled();
  });

  it("CLI 모델 식별에 HTTP 주소를 사용하지 않고 연결 방식 변경을 구별한다", () => {
    vi.stubEnv("AI_TRANSPORT", "api");
    vi.stubEnv("AI_BASE_URL", "https://example.test/v1");
    vi.stubEnv("AI_API_KEY", "test-api-key");
    vi.stubEnv("AI_MODEL", "same-model-name");
    const original = modelProfile("chat").identity;
    vi.stubEnv("AI_TRANSPORT", "codex-cli");
    const cli = modelProfile("chat").identity;
    expect(cli).not.toBe(original);
    vi.stubEnv("AI_BASE_URL", "https://different.test/v1");
    expect(modelProfile("chat").identity).toBe(cli);
  });
});
