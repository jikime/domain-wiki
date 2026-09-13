import { apiResult, readJson } from "@/server/http";
import { assistSelection } from "@/server/services/selection-assistance";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return apiResult(async () =>
    assistSelection(
      request,
      (await params).workspaceId,
      await readJson(request, 512 * 1024),
    ),
  );
}
