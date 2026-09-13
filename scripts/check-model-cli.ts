import { parseArgs } from "node:util";
import { loadEnvConfig } from "@next/env";
import { streamCliModel } from "../src/server/ai/cli";
import { AccessError } from "../src/server/errors";

async function main() {
  const { values } = parseArgs({
    options: {
      transport: { type: "string" },
      model: { type: "string" },
    },
  });
  const transport = values.transport;
  if (
    (transport !== "claude-code" && transport !== "codex-cli") ||
    !values.model
  )
    throw new AccessError(
      400,
      "--transport claude-code|codex-cli --model 모델명을 지정하세요.",
    );
  loadEnvConfig(process.cwd());
  const timeout = Math.min(
    300,
    Math.max(5, Number(process.env.AI_TIMEOUT_SECONDS) || 90),
  );
  const result = await streamCliModel({
    transport,
    binary:
      transport === "claude-code"
        ? process.env.AI_CLAUDE_CLI_BIN || "claude"
        : process.env.AI_CODEX_CLI_BIN || "codex",
    model: values.model,
    messages: [
      {
        role: "user",
        content: "연결 점검입니다. 한국어로 연결 확인이라고만 답하세요.",
      },
    ],
    onToken: async () => {},
    signal: AbortSignal.timeout(timeout * 1000),
    maxConcurrent: 1,
  });
  console.log(
    JSON.stringify({
      transport,
      model: values.model,
      completed: true,
      textCharacters: result.text.length,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof AccessError
      ? error.message
      : error instanceof Error && error.name === "TimeoutError"
        ? "CLI 연결 확인 시간이 초과되었습니다."
        : "CLI 연결 확인에 실패했습니다.",
  );
  process.exitCode = 1;
});
