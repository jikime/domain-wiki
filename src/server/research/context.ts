import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { domainKnowledgeRules } from "@/lib/domain-purpose";
import { effectiveRole } from "@/lib/permissions";
import type { ResearchInput, ResearchReference } from "@/lib/research";
import { modelProfile } from "@/server/ai/client";
import { knowledgeSql } from "@/server/ai/knowledge-index";
import { getPool } from "@/server/db";
import type { ChatScope, CitationSnapshot } from "@/server/db/schema";
import { AccessError } from "@/server/errors";
import { citationsAvailable } from "@/server/services/retrieval";

export const researchHash = (input: unknown) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
export const researchScope = (
  input: Pick<ResearchInput, "domainId" | "projectId">,
): ChatScope => ({
  domainId: input.domainId,
  projectId: input.projectId,
  sourceId: null,
  wikiId: null,
  sourceOnly: false,
});
export type ResearchRecord = {
  id: string;
  workspace_id: string;
  domain_id: string;
  project_id: string | null;
  author_id: string;
  request_id: string;
  input_hash: string;
  input: ResearchInput;
  context_hash: string;
  state: string;
  lease_token: string | null;
  generation_id: string | null;
  references: ResearchReference[];
  dependencies: CitationSnapshot[];
  synthesis: string;
  source_errors: string[];
  error_message: string | null;
  page_id: string | null;
  version_id: string | null;
  created_at: Date;
  updated_at: Date;
};
export async function researchAuthor(
  db: Pick<PoolClient, "query">,
  w: string,
  authorId: string,
  review = false,
) {
  const result = await db.query(
    "SELECT role,is_admin FROM membership WHERE workspace_id=$1 AND user_id=$2 AND is_active",
    [w, authorId],
  );
  const member = result.rows[0];
  const role = member ? effectiveRole(member.role, member.is_admin) : "reader";
  if (role === "reader" || (review && role !== "reviewer"))
    throw new AccessError(
      403,
      "조사를 요청한 직원의 작성·검토 권한이 변경되었습니다.",
    );
  return role;
}
export async function researchContext(
  db: Pick<PoolClient, "query">,
  w: string,
  input: Pick<ResearchInput, "domainId" | "projectId" | "origin">,
) {
  const result = await db.query(
    'SELECT name,purpose,purpose_guide AS "purposeGuide",purpose_markdown AS "purposeMarkdown",schema_markdown AS "schemaMarkdown",overview_markdown AS "overview",terms,record_template AS "recordTemplate" FROM domain WHERE workspace_id=$1 AND id=$2',
    [w, input.domainId],
  );
  if (!result.rowCount)
    throw new AccessError(404, "조사할 도메인을 찾을 수 없습니다.");
  const row = result.rows[0];
  const rules = domainKnowledgeRules(row);
  let gap = {
    title: "",
    description: input.origin.description,
    type: input.origin.gapType,
    updatedAt: "",
  };
  if (input.origin.kind === "review") {
    const issue = await db.query(
      "SELECT title,note,kind,updated_at FROM quality_finding WHERE workspace_id=$1 AND domain_id=$2 AND project_id IS NOT DISTINCT FROM $3::uuid AND id=$4 AND kind IN ('suggestion','missing-page') AND state<>'resolved'",
      [w, input.domainId, input.projectId, input.origin.reviewId ?? null],
    );
    if (!issue.rowCount)
      throw new AccessError(
        409,
        "현재 범위에서 조사할 검토 항목을 찾을 수 없습니다.",
      );
    const f = issue.rows[0];
    gap = {
      title: f.title,
      description: f.note,
      type: f.kind,
      updatedAt: f.updated_at.toISOString(),
    };
  }
  const ids = [...new Set(input.origin.pageIds)];
  const originPages = ids.length
    ? await db.query<{ id: string; version_id: string }>(
        `WITH allowed AS (${knowledgeSql}) SELECT id,version_id FROM allowed WHERE kind='wiki' AND id=ANY($6::uuid[]) ORDER BY id`,
        [w, input.domainId, input.projectId, null, null, ids],
      )
    : { rows: [] };
  if (originPages.rows.length !== ids.length)
    throw new AccessError(
      409,
      "선택한 그래프 문서가 현재 공개 범위에 없습니다.",
    );
  const hash = researchHash([
    w,
    input.domainId,
    input.projectId,
    rules,
    row.overview,
    gap,
    originPages.rows,
    modelProfile("knowledge").identity,
  ]);
  return {
    hash,
    rules,
    overview: row.overview as string,
    gap,
    originPages: originPages.rows,
  };
}
export async function researchWikiIndex(
  w: string,
  input: Pick<ResearchInput, "domainId" | "projectId">,
) {
  const result = await getPool().query<{
    id: string;
    version_id: string;
    title: string;
    path: string | null;
  }>(
    `WITH allowed AS (${knowledgeSql}) SELECT a.id,a.version_id,a.title,v.metadata->>'path' AS path FROM allowed a JOIN wiki_version v ON v.id=a.version_id WHERE a.kind='wiki' ORDER BY v.created_at DESC,a.id LIMIT 200`,
    [w, input.domainId, input.projectId, null, null],
  );
  return result.rows.map((row) => ({
    line: `- [[${row.path?.replace(/^wiki\//, "").replace(/\.md$/, "") ?? row.id}|${row.title}]]`,
    dependency: {
      key: "",
      kind: "wiki" as const,
      id: row.id,
      versionId: row.version_id,
      title: "",
      text: "",
      category: "wiki",
      href: "",
    },
  }));
}
export async function checkResearchCurrent(run: ResearchRecord) {
  await researchAuthor(
    getPool(),
    run.workspace_id,
    run.author_id,
    run.input.origin.kind === "review",
  );
  if (
    (await researchContext(getPool(), run.workspace_id, run.input)).hash !==
    run.context_hash
  )
    throw new AccessError(
      409,
      "도메인 목적이나 조사를 요청한 자료가 변경되었습니다.",
    );
  if (
    !(await citationsAvailable(
      run.workspace_id,
      researchScope(run.input),
      run.dependencies,
    ))
  )
    throw new AccessError(
      409,
      "조사에 사용한 원문·위키 근거가 변경되었습니다.",
    );
}
