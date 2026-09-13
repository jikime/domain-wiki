import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  reviewResearchTopic,
  selectedResearchReviews,
} from "@/lib/reference/review-batch-research";
import { researchInput } from "@/lib/research";
import { requireWorkspace } from "@/server/access";
import { getPool } from "@/server/db";
import { AccessError } from "@/server/errors";
import { checkScope, requireReviewer } from "./content-access";
import { createResearch } from "./research";

const schema = researchInput
  .pick({
    domainId: true,
    projectId: true,
    requestId: true,
    sourceMode: true,
    provider: true,
    engine: true,
    categories: true,
  })
  .extend({ findingIds: z.array(z.uuid()).min(1).max(50) })
  .strict();
function requestForFinding(requestId: string, findingId: string) {
  const bytes = createHash("sha256")
    .update(`${requestId}:${findingId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function createResearchBatch(
  headers: Headers,
  w: string,
  input: unknown,
) {
  requireReviewer(await requireWorkspace(headers, w));
  const data = schema.parse(input);
  await checkScope(w, data.domainId, data.projectId);
  const ids = [...new Set(data.findingIds)];
  const { rows } = await getPool().query<{
    id: string;
    type: string;
    title: string;
    description: string;
    resolved: boolean;
  }>(
    "SELECT id,kind AS type,title,note AS description,state='resolved' AS resolved FROM quality_finding WHERE workspace_id=$1 AND domain_id=$2 AND project_id IS NOT DISTINCT FROM $3::uuid AND id=ANY($4::uuid[]) ORDER BY created_at,id",
    [w, data.domainId, data.projectId, ids],
  );
  if (rows.length !== ids.length)
    throw new AccessError(409, "현재 범위에 속한 검토 항목을 선택해 주세요.");
  const selected = selectedResearchReviews(rows, new Set(ids), []);
  const { findingIds: _findingIds, ...settings } = data;
  const results: {
    findingId: string;
    id?: string;
    replay?: boolean;
    error?: string;
  }[] = [];
  for (const item of selected) {
    try {
      const result = await createResearch(headers, w, {
        ...settings,
        requestId: requestForFinding(data.requestId, item.id),
        topic: reviewResearchTopic(item),
        queries: [reviewResearchTopic(item)],
        origin: {
          kind: "review",
          reviewId: item.id,
          pageIds: [],
          description: "",
          gapType: item.type,
        },
      });
      results.push({
        findingId: item.id,
        id: result.id,
        replay: result.replay,
      });
    } catch (error) {
      results.push({
        findingId: item.id,
        error:
          error instanceof AccessError
            ? error.message
            : "항목을 대기열에 추가하지 못했습니다. 개별 조사에서 주제를 확인해 주세요.",
      });
    }
  }
  return {
    results,
    skipped: ids.filter((id) => !selected.some((item) => item.id === id)),
  };
}
