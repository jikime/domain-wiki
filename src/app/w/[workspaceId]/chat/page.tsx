import { headers } from "next/headers";
import { ChatWorkspace } from "@/components/chat-workspace";
import { chatScopeInput } from "@/lib/chat";
import { modelStatus } from "@/server/ai/client";
import { contentPage, pageContext } from "@/server/page-access";
import {
  conversationDetails,
  listConversationPage,
} from "@/server/services/chat";
import { isWriter } from "@/server/services/content-access";
import {
  chatScopeDocument,
  validateChatScope,
} from "@/server/services/retrieval";
import { workspaceData } from "@/server/services/workspace";
export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{
    conversation?: string;
    domain?: string;
    domainId?: string;
    projectId?: string;
    sourceId?: string;
    wikiId?: string;
  }>;
}) {
  const { workspaceId } = await params;
  const q = await searchParams;
  const data = await contentPage(async () => {
    const h = await headers();
    const [workspace, conversations, detail] = await Promise.all([
      workspaceData(h, workspaceId),
      listConversationPage(h, workspaceId),
      q.conversation
        ? conversationDetails(h, workspaceId, q.conversation)
        : null,
    ]);
    const scope =
      detail?.conversation.scope ??
      chatScopeInput.parse({
        domainId: q.domainId ?? q.domain ?? null,
        projectId: q.projectId ?? null,
        sourceId: q.sourceId ?? null,
        wikiId: q.wikiId ?? null,
      });
    if (!detail) await validateChatScope(workspaceId, scope);
    const scopeDocument = await chatScopeDocument(workspaceId, scope);
    return {
      workspace,
      conversations: conversations.items,
      conversationTotal: conversations.total,
      detail,
      scope,
      scopeDocument,
    };
  });
  return (
    <ChatWorkspace
      key={q.conversation ?? JSON.stringify(data.scope)}
      workspaceId={workspaceId}
      canWrite={isWriter(await pageContext(workspaceId))}
      {...data}
      model={modelStatus()}
    />
  );
}
