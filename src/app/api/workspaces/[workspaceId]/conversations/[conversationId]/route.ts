import { z } from "zod";
import { apiResult, readJson, requireSameOrigin } from "@/server/http";
import {
  cancelRun,
  conversationDetails,
  saveFeedback,
  updateConversation,
} from "@/server/services/chat";
import { saveChatWiki } from "@/server/services/chat-wiki";
import { deleteOwnConversation } from "@/server/services/operations";

type Context = {
  params: Promise<{ workspaceId: string; conversationId: string }>;
};
export async function GET(request: Request, { params }: Context) {
  return apiResult(async () => {
    const p = await params;
    return conversationDetails(
      request.headers,
      p.workspaceId,
      p.conversationId,
    );
  });
}
export async function PATCH(request: Request, { params }: Context) {
  return apiResult(async () => {
    const p = await params;
    return updateConversation(
      request.headers,
      p.workspaceId,
      p.conversationId,
      await readJson(request),
    );
  });
}
export async function POST(request: Request, { params }: Context) {
  return apiResult(async () => {
    const p = await params;
    const input = await readJson(request);
    if (input.action === "save-wiki")
      return saveChatWiki(
        request.headers,
        p.workspaceId,
        p.conversationId,
        input,
      );
    if (input.action === "cancel") {
      const data = z
        .object({ action: z.literal("cancel"), runId: z.uuid() })
        .strict()
        .parse(input);
      return cancelRun(
        request.headers,
        p.workspaceId,
        p.conversationId,
        data.runId,
      );
    }
    return saveFeedback(
      request.headers,
      p.workspaceId,
      p.conversationId,
      input,
    );
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return apiResult(async () => {
    requireSameOrigin(request);
    const p = await params;
    return deleteOwnConversation(
      request.headers,
      p.workspaceId,
      p.conversationId,
    );
  });
}
