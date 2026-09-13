import { AccessError } from "@/server/access";
import { apiResult, readJson } from "@/server/http";
import { reviewOfficial } from "@/server/services/official";
import { batchAction } from "@/server/services/proposals";
import { reviewRfp } from "@/server/services/rfp";
import { sourceImportAction } from "@/server/services/source-imports";
import { sourceAction } from "@/server/services/sources";
import { wikiAction } from "@/server/services/wiki";
export async function POST(
  request: Request,
  {
    params,
  }: { params: Promise<{ workspaceId: string; resource: string; id: string }> },
) {
  return apiResult(async () => {
    const { workspaceId, resource, id } = await params;
    const input = await readJson(request);
    if (resource === "source-imports")
      return sourceImportAction(request.headers, workspaceId, id, input);
    if (resource === "official")
      return reviewOfficial(request.headers, workspaceId, id, input);
    if (resource === "rfp-versions")
      return reviewRfp(request.headers, workspaceId, id, input);
    if (resource === "proposals")
      return batchAction(request.headers, workspaceId, id, input);
    if (resource === "source-versions")
      return sourceAction(request.headers, workspaceId, id, input);
    if (resource === "wiki-versions")
      return wikiAction(request.headers, workspaceId, id, input);
    throw new AccessError(404, "찾을 수 없는 경로입니다.");
  });
}
