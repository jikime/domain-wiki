import { AccessError } from "@/server/access";
import { apiResult, readJson } from "@/server/http";
import { issuePasswordRecovery } from "@/server/services/account";
import {
  activitySummary,
  markActivityRead,
  myActivity,
} from "@/server/services/activity";
import { createAiTask, listAiTasks } from "@/server/services/ai-tasks";
import {
  createConversation,
  listConversationPage,
  listConversations,
} from "@/server/services/chat";
import { draftEvidence } from "@/server/services/draft-evidence";
import { generateKnowledge } from "@/server/services/generation";
import { graphView } from "@/server/services/graph-view";
import { createIngest, listIngest } from "@/server/services/ingest";
import {
  collectOfficial,
  listOfficial,
  officialSites,
  saveOfficialSite,
} from "@/server/services/official";
import {
  operationsOverview,
  retentionAction,
  saveOperationsPolicy,
} from "@/server/services/operations";
import { createBatch, listBatches } from "@/server/services/proposals";
import {
  createQuality,
  qualityOverview,
  saveQualityPolicy,
} from "@/server/services/quality";
import { saveRecord } from "@/server/services/records";
import { retirementOverview, retireSource } from "@/server/services/retirement";
import {
  myIssues,
  reportIssue,
  reviewDesk,
  reviewDeskAction,
} from "@/server/services/review-desk";
import { reviewQueue } from "@/server/services/reviews";
import { generateRfp, listRfp, saveRfp } from "@/server/services/rfp";
import { searchContent, searchPage } from "@/server/services/search";
import {
  listSourceImports,
  saveSourceImport,
} from "@/server/services/source-imports";
import {
  listSourcePage,
  listSources,
  uploadSource,
} from "@/server/services/sources";
import { importWebSource } from "@/server/services/web-imports";
import { listWiki, listWikiPage, saveWiki } from "@/server/services/wiki";
import {
  createMember,
  listMembers,
  saveDomain,
  saveProject,
} from "@/server/services/workspace";

type Context = { params: Promise<{ workspaceId: string; resource: string }> };
export async function GET(request: Request, { params }: Context) {
  return apiResult(async () => {
    const { workspaceId, resource } = await params;
    const query = new URL(request.url).searchParams;
    const filter = Object.fromEntries(query);
    if (resource === "source-imports")
      return listSourceImports(request.headers, workspaceId);
    if (resource === "graph")
      return graphView(request.headers, workspaceId, filter);
    if (resource === "quality")
      return qualityOverview(request.headers, workspaceId, filter);
    if (resource === "ingest-runs")
      return listIngest(request.headers, workspaceId, filter);
    if (resource === "ai-tasks")
      return listAiTasks(request.headers, workspaceId, filter);
    if (resource === "activity")
      return myActivity(request.headers, workspaceId, filter);
    if (resource === "activity-summary")
      return activitySummary(request.headers, workspaceId);
    if (resource === "draft-evidence")
      return draftEvidence(request.headers, workspaceId, filter);
    if (query.has("page")) {
      if (resource === "records")
        return listSourcePage(request.headers, workspaceId, {
          ...filter,
          category: "testimony",
        });
      if (resource === "sources")
        return listSourcePage(request.headers, workspaceId, filter);
      if (resource === "wiki")
        return listWikiPage(request.headers, workspaceId, filter);
      if (resource === "conversations")
        return listConversationPage(request.headers, workspaceId, filter);
      if (resource === "search")
        return searchPage(request.headers, workspaceId, filter);
    }
    if (resource === "official-sites")
      return officialSites(request.headers, workspaceId);
    if (resource === "official")
      return listOfficial(request.headers, workspaceId);
    if (resource === "rfp") return listRfp(request.headers, workspaceId);
    if (resource === "retirements")
      return retirementOverview(request.headers, workspaceId);
    if (resource === "operations")
      return operationsOverview(request.headers, workspaceId);
    if (resource === "review-desk")
      return reviewDesk(request.headers, workspaceId, filter);
    if (resource === "issues") return myIssues(request.headers, workspaceId);
    if (resource === "proposals")
      return listBatches(request.headers, workspaceId);
    if (resource === "records")
      return listSources(request.headers, workspaceId, undefined, "testimony");
    if (resource === "conversations")
      return listConversations(request.headers, workspaceId);
    if (resource === "members")
      return listMembers(request.headers, workspaceId);
    if (resource === "sources")
      return listSources(
        request.headers,
        workspaceId,
        query.get("domainId") ?? undefined,
      );
    if (resource === "wiki")
      return listWiki(
        request.headers,
        workspaceId,
        query.get("domainId") ?? undefined,
      );
    if (resource === "search")
      return searchContent(
        request.headers,
        workspaceId,
        Object.fromEntries(query),
      );
    if (resource === "reviews")
      return reviewQueue(request.headers, workspaceId);
    throw new AccessError(404, "찾을 수 없는 경로입니다.");
  });
}
export async function POST(request: Request, { params }: Context) {
  return apiResult(async () => {
    const { workspaceId, resource } = await params;
    if (resource === "sources") return uploadSource(request, workspaceId);
    const input = await readJson(
      request,
      resource === "proposals"
        ? 2 * 1024 * 1024
        : resource === "rfp"
          ? 384 * 1024
          : resource === "domains"
            ? 1024 * 1024
            : resource === "wiki"
              ? 256 * 1024
              : 64 * 1024,
    );
    if (resource === "web-imports")
      return importWebSource(request, workspaceId, input);
    if (resource === "source-imports")
      return saveSourceImport(request.headers, workspaceId, input);
    if (resource === "quality")
      return createQuality(request.headers, workspaceId, input);
    if (resource === "quality-policy")
      return saveQualityPolicy(request.headers, workspaceId, input);
    if (resource === "ai-tasks")
      return createAiTask(request.headers, workspaceId, input);
    if (resource === "ingest-runs")
      return createIngest(request.headers, workspaceId, input);
    if (resource === "password-recovery")
      return issuePasswordRecovery(request.headers, workspaceId, input);
    if (resource === "activity")
      return markActivityRead(request.headers, workspaceId, input);
    if (resource === "official-sites")
      return saveOfficialSite(request.headers, workspaceId, input);
    if (resource === "official")
      return collectOfficial(request, workspaceId, input);
    if (resource === "rfp") return saveRfp(request.headers, workspaceId, input);
    if (resource === "rfp-generations")
      return generateRfp(request, workspaceId, input);
    if (resource === "retirements")
      return retireSource(request.headers, workspaceId, input);
    if (resource === "operations")
      return saveOperationsPolicy(request.headers, workspaceId, input);
    if (resource === "retention")
      return retentionAction(request.headers, workspaceId, input);
    if (resource === "review-desk")
      return reviewDeskAction(request.headers, workspaceId, input);
    if (resource === "issues")
      return reportIssue(request.headers, workspaceId, input);
    if (resource === "records") return saveRecord(request, workspaceId, input);
    if (resource === "proposals")
      return createBatch(request.headers, workspaceId, input);
    if (resource === "generations")
      return generateKnowledge(request, workspaceId, input);
    if (resource === "conversations")
      return createConversation(request.headers, workspaceId, input);
    if (resource === "domains")
      return saveDomain(request.headers, workspaceId, input);
    if (resource === "projects")
      return saveProject(request.headers, workspaceId, input);
    if (resource === "members")
      return createMember(request.headers, workspaceId, input);
    if (resource === "wiki")
      return saveWiki(request.headers, workspaceId, input);
    throw new AccessError(404, "찾을 수 없는 경로입니다.");
  }, 201);
}
