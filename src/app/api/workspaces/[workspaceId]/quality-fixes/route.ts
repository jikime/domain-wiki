import { apiResult, readJson } from "@/server/http";
import { fixQuality } from "@/server/services/quality-fixes";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return apiResult(async () =>
    fixQuality(
      request.headers,
      (await params).workspaceId,
      await readJson(request, 16 * 1024),
    ),
  );
}
