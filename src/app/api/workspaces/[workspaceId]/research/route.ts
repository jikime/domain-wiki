import { apiResult, readJson } from "@/server/http";
import { createResearch, researchOverview } from "@/server/services/research";
export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(request: Request, { params }: Context) {
  const url = new URL(request.url);
  return apiResult(async () =>
    researchOverview(request.headers, (await params).workspaceId, {
      domainId: url.searchParams.get("domainId"),
      projectId: url.searchParams.get("projectId"),
    }),
  );
}
export async function POST(request: Request, { params }: Context) {
  return apiResult(
    async () =>
      createResearch(
        request.headers,
        (await params).workspaceId,
        await readJson(request, 64 * 1024),
      ),
    201,
  );
}
