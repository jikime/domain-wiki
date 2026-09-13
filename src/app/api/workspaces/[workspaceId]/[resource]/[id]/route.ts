import { AccessError } from "@/server/access";
import { apiResult, readJson } from "@/server/http";
import { aiTaskAction, aiTaskDetails } from "@/server/services/ai-tasks";
import { archiveImageFile } from "@/server/services/archive-media";
import {
  domainDiscovery,
  projectDiscovery,
  saveGuide,
  wikiRelations,
} from "@/server/services/discovery";
import { generationDetails } from "@/server/services/generation";
import { ingestAction } from "@/server/services/ingest";
import { officialDetails, saveOfficialSite } from "@/server/services/official";
import { projectCatalog } from "@/server/services/project-catalog";
import { batchDetails } from "@/server/services/proposals";
import { qualityRunAction } from "@/server/services/quality";
import { saveRecord } from "@/server/services/records";
import { rfpContext, rfpDetails, saveRfp } from "@/server/services/rfp";
import { sourceImpact } from "@/server/services/source-impact";
import { sourceImportDetails } from "@/server/services/source-imports";
import {
  sourceAssetFile,
  sourceDetails,
  uploadSource,
} from "@/server/services/sources";
import { saveWiki, wikiDetails } from "@/server/services/wiki";
import {
  saveDomain,
  saveProject,
  updateMember,
} from "@/server/services/workspace";

type Context = {
  params: Promise<{ workspaceId: string; resource: string; id: string }>;
};
export async function PATCH(request: Request, { params }: Context) {
  return apiResult(async () => {
    const { workspaceId, resource, id } = await params;
    const input = await readJson(
      request,
      resource === "domains" ? 1024 * 1024 : 64 * 1024,
    );
    if (resource === "quality")
      return qualityRunAction(request.headers, workspaceId, id, input);
    if (resource === "ingest-runs")
      return ingestAction(request.headers, workspaceId, id, input);
    if (resource === "official-sites")
      return saveOfficialSite(request.headers, workspaceId, input, id);
    if (resource === "domain-guides")
      return saveGuide(request.headers, workspaceId, id, input);
    if (resource === "ai-tasks")
      return aiTaskAction(request.headers, workspaceId, id, input);
    if (resource === "domains")
      return saveDomain(request.headers, workspaceId, input, id);
    if (resource === "projects")
      return saveProject(request.headers, workspaceId, input, id);
    if (resource === "members")
      return updateMember(request.headers, workspaceId, id, input);
    throw new AccessError(404, "찾을 수 없는 경로입니다.");
  });
}

export async function GET(request: Request, { params }: Context) {
  return apiResult(async () => {
    const { workspaceId, resource, id } = await params;
    if (resource === "archive-files")
      return archiveImageFile(
        request.headers,
        workspaceId,
        id,
        new URL(request.url).searchParams.get("version") ?? "",
      );
    if (resource === "project-catalog")
      return projectCatalog(request.headers, workspaceId, id);
    if (resource === "source-imports")
      return sourceImportDetails(request.headers, workspaceId, id);
    const version =
      new URL(request.url).searchParams.get("version") ?? undefined;
    if (resource === "official")
      return officialDetails(request.headers, workspaceId, id);
    if (resource === "rfp-context")
      return rfpContext(
        request.headers,
        workspaceId,
        id,
        new URL(request.url).searchParams.get("q") ?? undefined,
      );
    if (resource === "rfp")
      return rfpDetails(request.headers, workspaceId, id, version);
    if (resource === "source-impact")
      return sourceImpact(request.headers, workspaceId, id);
    if (resource === "domain-guides")
      return domainDiscovery(request.headers, workspaceId, id);
    if (resource === "projects")
      return projectDiscovery(request.headers, workspaceId, id);
    if (resource === "wiki-relations")
      return wikiRelations(request.headers, workspaceId, id);
    if (resource === "proposals")
      return batchDetails(request.headers, workspaceId, id);
    if (resource === "ai-tasks")
      return aiTaskDetails(request.headers, workspaceId, id);
    if (resource === "generations")
      return generationDetails(request.headers, workspaceId, id);
    if (resource === "source-assets")
      return sourceAssetFile(request.headers, workspaceId, id);
    if (resource === "sources")
      return sourceDetails(request.headers, workspaceId, id, version);
    if (resource === "wiki")
      return wikiDetails(request.headers, workspaceId, id, version);
    throw new AccessError(404, "찾을 수 없는 경로입니다.");
  });
}
export async function POST(request: Request, { params }: Context) {
  return apiResult(async () => {
    const { workspaceId, resource, id } = await params;
    if (resource === "rfp")
      return saveRfp(
        request.headers,
        workspaceId,
        await readJson(request, 384 * 1024),
        id,
      );
    if (resource === "sources") return uploadSource(request, workspaceId, id);
    if (resource === "records")
      return saveRecord(request, workspaceId, await readJson(request), id);
    if (resource === "wiki")
      return saveWiki(
        request.headers,
        workspaceId,
        await readJson(request, 256 * 1024),
        id,
      );
    throw new AccessError(404, "찾을 수 없는 경로입니다.");
  }, 201);
}
