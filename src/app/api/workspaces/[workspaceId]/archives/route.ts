import { apiResult } from "@/server/http";
import {
  exportProjectArchive,
  importProjectArchive,
} from "@/server/services/project-archives";

type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(request: Request, { params }: Context) {
  return apiResult(async () =>
    exportProjectArchive(request, (await params).workspaceId),
  );
}
export async function POST(request: Request, { params }: Context) {
  return apiResult(
    async () => importProjectArchive(request, (await params).workspaceId),
    201,
  );
}
