import { AccessError } from "@/server/access";
import { apiResult } from "@/server/http";
import { exportRfp } from "@/server/services/rfp";
import { originalFile } from "@/server/services/sources";
export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ workspaceId: string; resource: string; id: string }> },
) {
  return apiResult(async () => {
    const { workspaceId, resource, id } = await params;
    if (resource === "rfp") return exportRfp(request.headers, workspaceId, id);
    if (resource !== "source-versions")
      throw new AccessError(404, "찾을 수 없는 경로입니다.");
    return originalFile(
      request.headers,
      workspaceId,
      id,
      new URL(request.url).searchParams.get("inline") === "1",
    );
  });
}
