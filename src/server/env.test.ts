import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerEnv } from "./env";

beforeEach(() => {
  for (const key of Object.keys(process.env))
    if (/^(AI_|OPENAI_)/.test(key)) vi.stubEnv(key, "");
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "test-secret-012345678901234567890123456789",
  );
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3010");
  vi.stubEnv("AI_CLI_MAX_CONCURRENT", "1");
  vi.stubEnv("AI_TIMEOUT_SECONDS", "90");
  vi.stubEnv("AI_MAX_CONCURRENT", "3");
  vi.stubEnv("AI_INCLUDE_USAGE", "true");
  vi.stubEnv("AI_CHAT_CONTEXT_CHARS", "120000");
  vi.stubEnv("AI_KNOWLEDGE_CONTEXT_CHARS", "48000");
  vi.stubEnv("AI_VISION_CONTEXT_CHARS", "48000");
  vi.stubEnv("AI_TASK_LEASE_SECONDS", "30");
});
afterEach(() => vi.unstubAllEnvs());

describe("API/CLI 환경 설정", () => {
  it("기존 OpenAI 키 기본 연결을 보존한다", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-api-key");
    const env = getServerEnv();
    expect(env.AI_TRANSPORT).toBe("api");
    expect(env.AI_BASE_URL).toBe("https://api.openai.com/v1");
    expect(env.AI_API_KEY).toBe("test-api-key");
  });

  it.each([
    "claude-code",
    "codex-cli",
  ])("%s는 주소·API 키 없이 모델만으로 설정한다", (transport) => {
    vi.stubEnv("AI_TRANSPORT", transport);
    vi.stubEnv("AI_MODEL", "test-model");
    const env = getServerEnv();
    expect(env.AI_TRANSPORT).toBe(transport);
    expect(env.AI_API_KEY).toBeUndefined();
    expect(env.AI_BASE_URL).toBeUndefined();
  });

  it("공통 API와 용도별 CLI를 혼용한다", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-api-key");
    vi.stubEnv("AI_CHAT_TRANSPORT", "codex-cli");
    vi.stubEnv("AI_CHAT_MODEL", "test-codex");
    vi.stubEnv("AI_KNOWLEDGE_TRANSPORT", "claude-code");
    vi.stubEnv("AI_KNOWLEDGE_MODEL", "sonnet");
    const env = getServerEnv();
    expect(env.AI_TRANSPORT).toBe("api");
    expect(env.AI_CHAT_TRANSPORT).toBe("codex-cli");
    expect(env.AI_KNOWLEDGE_TRANSPORT).toBe("claude-code");
  });

  it("CLI 공통 설정에서는 OpenAI 키로 모델을 임의 선택하지 않는다", () => {
    vi.stubEnv("AI_TRANSPORT", "claude-code");
    vi.stubEnv("OPENAI_API_KEY", "test-api-key");
    expect(() => getServerEnv()).toThrow("AI_CHAT_MODEL");
  });

  it("공통 CLI와 별도 이미지 API 연결을 혼용한다", () => {
    vi.stubEnv("AI_TRANSPORT", "claude-code");
    vi.stubEnv("AI_MODEL", "sonnet");
    vi.stubEnv("AI_VISION_TRANSPORT", "api");
    vi.stubEnv("AI_VISION_MODEL", "vision-model");
    vi.stubEnv("AI_VISION_BASE_URL", "https://example.test/v1");
    vi.stubEnv("AI_VISION_API_KEY", "test-vision-key");
    expect(getServerEnv().AI_VISION_TRANSPORT).toBe("api");
  });

  it("API로 전환할 때 누락된 주소·키와 잘못된 연결 방식을 거부한다", () => {
    vi.stubEnv("AI_MODEL", "model-only");
    expect(() => getServerEnv()).toThrow("AI_MODEL");
    vi.stubEnv("AI_TRANSPORT", "shell-command");
    expect(() => getServerEnv()).toThrow("AI_TRANSPORT");
  });
});
