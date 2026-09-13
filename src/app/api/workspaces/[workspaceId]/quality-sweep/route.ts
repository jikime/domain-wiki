import { apiResult, readJson } from "@/server/http";
import { sweepQuality } from "@/server/services/quality-sweep";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return apiResult(async () =>
    sweepQuality(
      request,
      (await params).workspaceId,
      await readJson(request, 32 * 1024),
    ),
  );
}
