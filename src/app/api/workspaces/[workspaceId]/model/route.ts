import { z } from "zod";
import { modelTransportLabels } from "@/lib/model-transport";
import { requireWorkspace } from "@/server/access";
import { embedTexts, modelStatus, streamModel } from "@/server/ai/client";
import { getServerEnv } from "@/server/env";
import { apiResult, readJson } from "@/server/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return apiResult(async () => {
    const { workspaceId } = await params;
    await requireWorkspace(request.headers, workspaceId, true);
    z.object({ action: z.literal("test") })
      .strict()
      .parse(await readJson(request));
    const status = modelStatus();
    let chat = "설정 없음";
    let knowledge = "설정 없음";
    let embedding = "설정 없음";
    for (const purpose of ["chat", "knowledge"] as const) {
      if (
        !(purpose === "chat"
          ? status.chatConfigured
          : status.knowledgeConfigured)
      )
        continue;
      const transport =
        purpose === "chat" ? status.chatTransport : status.knowledgeTransport;
      await streamModel(
        [
          {
            role: "user",
            content: "연결 점검입니다. 한국어로 연결 확인이라고만 답하세요.",
          },
        ],
        async () => {},
        AbortSignal.any([
          request.signal,
          AbortSignal.timeout(
            transport === "api"
              ? 30000
              : getServerEnv().AI_TIMEOUT_SECONDS * 1000,
          ),
        ]),
        purpose,
      );
      const confirmed = `${modelTransportLabels[transport]} 응답 수신 확인`;
      if (purpose === "chat") chat = confirmed;
      else knowledge = confirmed;
    }
    if (status.embeddingConfigured) {
      const [vector] = await embedTexts(["모델 연결 점검"], request.signal, {
        workspaceId,
        purpose: "connection",
      });
      embedding = `벡터 수신 확인 · ${vector.length}차원`;
    }
    return {
      chat,
      knowledge,
      embedding,
      testedAt: new Date().toISOString(),
      notice: "연결 형식 확인입니다. 업무 답변 품질 검증은 별도로 진행하세요.",
    };
  });
}
