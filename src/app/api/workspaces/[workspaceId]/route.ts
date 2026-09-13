import { apiResult } from "@/server/http";
import { workspaceData } from "@/server/services/workspace";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return apiResult(async () =>
    workspaceData(request.headers, (await params).workspaceId),
  );
}
