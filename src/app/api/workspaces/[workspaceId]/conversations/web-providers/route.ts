import { requireWorkspace } from "@/server/access";
import { apiResult } from "@/server/http";
import { availableResearchProviders } from "@/server/research/search";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return apiResult(async () => {
    const { workspaceId } = await params;
    await requireWorkspace(request.headers, workspaceId);
    return { providers: availableResearchProviders(workspaceId) };
  });
}
