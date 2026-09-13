import { apiResult } from "@/server/http";
import { ownChatImage } from "@/server/services/chat-images";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      workspaceId: string;
      conversationId: string;
      imageId: string;
    }>;
  },
) {
  return apiResult(async () => {
    const p = await params;
    return ownChatImage(
      request.headers,
      p.workspaceId,
      p.conversationId,
      p.imageId,
    );
  });
}
