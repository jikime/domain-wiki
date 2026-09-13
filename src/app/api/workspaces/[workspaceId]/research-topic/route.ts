import { apiResult, readJson } from "@/server/http";
import { optimizeResearch } from "@/server/services/research";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return apiResult(async () =>
    optimizeResearch(
      request,
      (await params).workspaceId,
      await readJson(request, 32 * 1024),
    ),
  );
}
