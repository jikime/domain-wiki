import { apiResult, readJson } from "@/server/http";
import { researchAction, researchDetails } from "@/server/services/research";
export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string; id: string }> };
export async function GET(request: Request, { params }: Context) {
  const { workspaceId, id } = await params;
  return apiResult(async () =>
    researchDetails(request.headers, workspaceId, id),
  );
}
export async function PATCH(request: Request, { params }: Context) {
  const { workspaceId, id } = await params;
  return apiResult(async () =>
    researchAction(request.headers, workspaceId, id, await readJson(request)),
  );
}
