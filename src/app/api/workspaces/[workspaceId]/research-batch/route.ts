import { apiResult, readJson } from "@/server/http";
import { createResearchBatch } from "@/server/services/research-batch";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return apiResult(
    async () =>
      createResearchBatch(
        request.headers,
        (await params).workspaceId,
        await readJson(request, 16 * 1024),
      ),
    201,
  );
}
