import { MAX_CHAT_REQUEST_BYTES } from "@/lib/chat-images";
import { apiResult, readJson } from "@/server/http";
import { chatStream } from "@/server/services/chat";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ workspaceId: string; conversationId: string }> },
) {
  return apiResult(async () => {
    const p = await params;
    return chatStream(
      request,
      p.workspaceId,
      p.conversationId,
      await readJson(request, MAX_CHAT_REQUEST_BYTES),
    );
  });
}
