import "server-only";
import { z } from "zod";
import { modelTransports } from "@/lib/model-transport";

const optionalText = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const optionalTransport = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.enum(modelTransports).optional(),
);
const schema = z
  .object({
    DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:/.test(value)),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    ORIGINALS_DIR: z.string().min(1).default(".local/originals"),
    JOB_LEASE_SECONDS: z.coerce.number().int().min(5).max(3600).default(120),
    AI_TRANSPORT: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.enum(modelTransports).default("api"),
    ),
    AI_CHAT_TRANSPORT: optionalTransport,
    AI_KNOWLEDGE_TRANSPORT: optionalTransport,
    AI_VISION_TRANSPORT: optionalTransport,
    AI_CLAUDE_CLI_BIN: optionalText.default("claude"),
    AI_CODEX_CLI_BIN: optionalText.default("codex"),
    AI_CLI_MAX_CONCURRENT: z.coerce.number().int().min(1).max(20).default(1),
    AI_BASE_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.url().optional(),
    ),
    AI_MODEL: optionalText,
    AI_VISION_MODEL: optionalText,
    AI_VISION_BASE_URL: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.url().optional(),
    ),
    AI_VISION_API_KEY: optionalText,
    AI_VISION_CONTEXT_CHARS: z.coerce
      .number()
      .int()
      .min(4000)
      .max(1000000)
      .default(48000),
    AI_CHAT_BASE_URL: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.url().optional(),
    ),
    AI_CHAT_MODEL: optionalText,
    AI_CHAT_API_KEY: optionalText,
    AI_KNOWLEDGE_BASE_URL: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.url().optional(),
    ),
    AI_KNOWLEDGE_MODEL: optionalText,
    AI_KNOWLEDGE_API_KEY: optionalText,
    AI_CHAT_CONTEXT_CHARS: z.coerce
      .number()
      .int()
      .min(4000)
      .max(1000000)
      .default(120000),
    AI_KNOWLEDGE_CONTEXT_CHARS: z.coerce
      .number()
      .int()
      .min(4000)
      .max(1000000)
      .default(48000),
    AI_TASK_LEASE_SECONDS: z.coerce.number().int().min(10).max(300).default(30),
    AI_EMBEDDING_MODEL: optionalText,
    AI_EMBEDDING_BASE_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.url().optional(),
    ),
    AI_EMBEDDING_API_KEY: optionalText,
    AI_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(300).default(90),
    AI_MAX_CONCURRENT: z.coerce.number().int().min(1).max(20).default(3),
    AI_API_KEY: optionalText,
    AI_INCLUDE_USAGE: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
  })
  .superRefine((value, ctx) => {
    const count = [value.AI_BASE_URL, value.AI_MODEL, value.AI_API_KEY].filter(
      Boolean,
    ).length;
    if (value.AI_TRANSPORT === "api" && count !== 0 && count !== 3)
      ctx.addIssue({
        code: "custom",
        path: ["AI_MODEL"],
        message: "모델 설정 세 항목을 함께 입력하세요.",
      });
    for (const purpose of ["CHAT", "KNOWLEDGE"] as const) {
      const transport = value[`AI_${purpose}_TRANSPORT`] ?? value.AI_TRANSPORT;
      const model = value[`AI_${purpose}_MODEL`] ?? value.AI_MODEL;
      const base = value[`AI_${purpose}_BASE_URL`] ?? value.AI_BASE_URL;
      const key = value[`AI_${purpose}_API_KEY`] ?? value.AI_API_KEY;
      const configured = [model, base, key].filter(Boolean).length;
      if (transport === "api" ? configured !== 0 && configured !== 3 : !model)
        ctx.addIssue({
          code: "custom",
          path: [`AI_${purpose}_MODEL`],
          message:
            transport === "api"
              ? "용도별 모델·주소·키를 공통 설정과 함께 확인하세요."
              : "CLI로 사용할 모델을 입력하세요.",
        });
    }
    const visionTransport = value.AI_VISION_TRANSPORT ?? value.AI_TRANSPORT;
    if (
      [
        value.AI_VISION_TRANSPORT,
        value.AI_VISION_MODEL,
        value.AI_VISION_BASE_URL,
        value.AI_VISION_API_KEY,
      ].some(Boolean) &&
      !(
        value.AI_VISION_MODEL &&
        (visionTransport !== "api" ||
          ((value.AI_VISION_BASE_URL ?? value.AI_BASE_URL) &&
            (value.AI_VISION_API_KEY ?? value.AI_API_KEY)))
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["AI_VISION_MODEL"],
        message: "이미지 모델·주소·키를 공통 설정과 함께 확인하세요.",
      });
    if (
      process.env.NODE_ENV === "production" &&
      !value.BETTER_AUTH_URL.startsWith("https://") &&
      !["localhost", "127.0.0.1"].includes(
        new URL(value.BETTER_AUTH_URL).hostname,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_URL"],
        message: "운영 주소에는 HTTPS가 필요합니다.",
      });
    }
  });

export function getServerEnv() {
  const openAIKey = process.env.OPENAI_API_KEY?.trim();
  const hasGenericModel = [
    process.env.AI_BASE_URL,
    process.env.AI_MODEL,
    process.env.AI_API_KEY,
  ].some(Boolean);
  // 기존 AI_* 설정을 우선하며, OpenAI 키를 입력한 경우에만 기본 연결을 활성화한다.
  const input =
    openAIKey &&
    !hasGenericModel &&
    (!process.env.AI_TRANSPORT || process.env.AI_TRANSPORT === "api")
      ? {
          ...process.env,
          AI_BASE_URL:
            process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
          AI_MODEL: process.env.OPENAI_MODEL || "gpt-5.6-terra",
          AI_API_KEY: openAIKey,
          AI_EMBEDDING_MODEL:
            process.env.AI_EMBEDDING_MODEL ||
            process.env.OPENAI_EMBEDDING_MODEL,
        }
      : process.env;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ];
    throw new Error(`서버 환경 변수를 확인하세요: ${fields.join(", ")}`);
  }
  return parsed.data;
}
