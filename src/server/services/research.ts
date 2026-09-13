import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  optimizeResearchPrompt,
  parseOptimizedResearchTopic,
} from "@/lib/reference/research-prompts";
import {
  activeResearchStates,
  researchInput,
  researchOriginInput,
  researchScopeInput,
} from "@/lib/research";
import { AccessError, requireWorkspace } from "@/server/access";
import { modelProfile, streamModel } from "@/server/ai/client";
import { getDb, getPool } from "@/server/db";
import { generation } from "@/server/db/schema";
import {
  type ResearchRecord,
  researchAuthor,
  researchContext,
  researchHash,
  researchScope,
} from "@/server/research/context";
import { availableResearchProviders } from "@/server/research/search";
import {
  checkScope,
  mayManage,
  parseId,
  requireReviewer,
  requireWriter,
} from "./content-access";
import { checkAiCapacity } from "./operations";
import { citationsAvailable } from "./retrieval";
import { wikiLinkDestinations } from "./wiki-references";

export async function createResearch(
  headers: Headers,
  w: string,
  input: unknown,
) {
  const context = await requireWorkspace(headers, w);
  requireWriter(context);
  const data = researchInput.parse(input);
  if (data.origin.kind === "review") requireReviewer(context);
  await checkScope(w, data.domainId, data.projectId);
  if (!modelProfile("knowledge").configured)
    throw new AccessError(503, "지식 정리 모델을 먼저 설정해 주세요.");
  if (
    data.sourceMode !== "local" &&
    !availableResearchProviders(w).some((c) => c.provider === data.provider)
  )
    throw new AccessError(
      503,
      "이 작업공간에 설정된 웹 검색 제공자를 선택해 주세요.",
    );
  const hash = researchHash(data);
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,28))", [
      w,
    ]);
    await db.query(
      "SELECT user_id FROM membership WHERE workspace_id=$1 AND user_id=$2 FOR SHARE",
      [w, context.user.id],
    );
    await researchAuthor(db, w, context.user.id, data.origin.kind === "review");
    const previous = await db.query<ResearchRecord>(
      "SELECT * FROM research_run WHERE workspace_id=$1 AND author_id=$2 AND request_id=$3",
      [w, context.user.id, data.requestId],
    );
    if (previous.rows[0]) {
      if (previous.rows[0].input_hash !== hash)
        throw new AccessError(409, "같은 요청 번호의 조사 내용이 다릅니다.");
      await db.query("COMMIT");
      return {
        id: previous.rows[0].id,
        state: previous.rows[0].state,
        replay: true,
      };
    }
    const basis = await researchContext(db, w, data);
    if (data.origin.reviewId) {
      const active = await db.query<{ id: string; state: string }>(
        "SELECT id,state FROM research_run WHERE workspace_id=$1 AND input->'origin'->>'reviewId'=$2 AND state=ANY($3::text[]) LIMIT 1",
        [w, data.origin.reviewId, activeResearchStates],
      );
      if (active.rows[0]) {
        await db.query("COMMIT");
        return { ...active.rows[0], replay: true };
      }
    }
    const result = await db.query<{ id: string; state: string }>(
      "INSERT INTO research_run(workspace_id,domain_id,project_id,author_id,request_id,input_hash,input,context_hash) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id,state",
      [
        w,
        data.domainId,
        data.projectId,
        context.user.id,
        data.requestId,
        hash,
        JSON.stringify(data),
        basis.hash,
      ],
    );
    await db.query("COMMIT");
    return { ...result.rows[0], replay: false };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
export async function researchOverview(
  headers: Headers,
  w: string,
  input: unknown,
) {
  const context = await requireWorkspace(headers, w);
  requireWriter(context);
  const scope = researchScopeInput.parse(input);
  await checkScope(w, scope.domainId, scope.projectId);
  const result = await getPool().query(
    "SELECT id,input->>'topic' AS topic,state,page_id,error_message,created_at,updated_at,author_id,jsonb_array_length(\"references\") AS source_count FROM research_run WHERE workspace_id=$1 AND domain_id=$2 AND project_id IS NOT DISTINCT FROM $3::uuid AND ($4::boolean OR author_id=$5) ORDER BY created_at DESC LIMIT 50",
    [
      w,
      scope.domainId,
      scope.projectId,
      context.role === "reviewer",
      context.user.id,
    ],
  );
  return {
    scope,
    runs: result.rows as {
      id: string;
      topic: string;
      state: string;
      page_id: string | null;
      error_message: string | null;
      created_at: Date;
      updated_at: Date;
      author_id: string;
      source_count: number;
    }[],
    providers: availableResearchProviders(w),
    modelConfigured: modelProfile("knowledge").configured,
  };
}
export async function researchDetails(headers: Headers, w: string, id: string) {
  const context = await requireWorkspace(headers, w);
  requireWriter(context);
  parseId(id);
  const result = await getPool().query<ResearchRecord>(
    "SELECT * FROM research_run WHERE workspace_id=$1 AND id=$2",
    [w, id],
  );
  const run = result.rows[0];
  if (!run || !mayManage(context, run.author_id))
    throw new AccessError(404, "조사 기록을 찾을 수 없습니다.");
  let available = await citationsAvailable(
    w,
    researchScope(run.input),
    run.dependencies,
  );
  const sources =
    available && run.version_id
      ? await getPool().query<{
          id: string;
          version_id: string;
          title: string;
          publication: string;
        }>(
          "SELECT DISTINCT s.id,v.id AS version_id,s.title,v.publication FROM wiki_evidence e JOIN source_chunk c ON c.id=e.chunk_id JOIN source_version v ON v.id=c.version_id JOIN source s ON s.id=v.source_id WHERE e.workspace_id=$1 AND e.version_id=$2 ORDER BY s.id",
          [w, run.version_id],
        )
      : { rows: [] };
  // Newly collected excerpts remain private during review. A rejected, replaced
  // or withdrawn excerpt must also invalidate its derived research history.
  available &&= sources.rows.every((source) =>
    ["pending", "published"].includes(source.publication),
  );
  const links = available
    ? await wikiLinkDestinations(w, run.synthesis, researchScope(run.input))
    : {};
  return {
    id: run.id,
    input: run.input,
    state: available ? run.state : "outdated",
    synthesis: available ? run.synthesis : "",
    references: available ? run.references : [],
    sourceErrors: available ? run.source_errors : [],
    error: available
      ? run.error_message
      : "사용한 근거가 변경되었습니다. 현재 자료로 다시 조사해 주세요.",
    pageId: available ? run.page_id : null,
    versionId: available ? run.version_id : null,
    linkDestinations: links,
    sources: available ? sources.rows : [],
  };
}
export async function researchAction(
  headers: Headers,
  w: string,
  id: string,
  input: unknown,
) {
  const context = await requireWorkspace(headers, w);
  requireWriter(context);
  parseId(id);
  const data = z
    .object({ action: z.literal("cancel") })
    .strict()
    .parse(input);
  const result = await getPool().query<ResearchRecord>(
    "UPDATE research_run SET state='canceled',lease_token=NULL,error_message='직원이 조사를 중지했습니다.',synthesis='',\"references\"='[]',updated_at=now() WHERE workspace_id=$1 AND id=$2 AND ($3::boolean OR author_id=$4) AND state=ANY($5::text[]) RETURNING *",
    [w, id, context.role === "reviewer", context.user.id, activeResearchStates],
  );
  if (!result.rowCount)
    throw new AccessError(409, "진행 중인 본인 조사를 선택해 주세요.");
  if (result.rows[0].generation_id)
    await getPool().query(
      "UPDATE generation SET state='failed',error_message='직원이 조사를 중지했습니다.',updated_at=now() WHERE id=$1 AND state='running'",
      [result.rows[0].generation_id],
    );
  return { id, action: data.action };
}
export async function optimizeResearch(
  request: Request,
  w: string,
  input: unknown,
) {
  const context = await requireWorkspace(request.headers, w);
  requireWriter(context);
  const data = researchScopeInput
    .extend({
      requestId: z.uuid(),
      topic: z.string().trim().min(1).max(150),
      origin: researchOriginInput,
    })
    .strict()
    .parse(input);
  if (data.origin.kind === "review") requireReviewer(context);
  await checkScope(w, data.domainId, data.projectId);
  const basis = await researchContext(getPool(), w, data),
    profile = modelProfile("knowledge");
  if (!profile.configured)
    throw new AccessError(503, "지식 정리 모델을 먼저 설정해 주세요.");
  const run = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${w},3))`,
    );
    const [prior] = await tx
      .select({ id: generation.id })
      .from(generation)
      .where(
        and(
          eq(generation.workspaceId, w),
          eq(generation.authorId, context.user.id),
          eq(generation.requestId, data.requestId),
        ),
      );
    if (prior)
      throw new AccessError(
        409,
        "이미 사용한 요청 번호입니다. 새 요청으로 보완해 주세요.",
      );
    await checkAiCapacity(tx, w);
    const [row] = await tx
      .insert(generation)
      .values({
        workspaceId: w,
        authorId: context.user.id,
        requestId: data.requestId,
        inputHash: researchHash(data),
        kind: "research-topic",
        model: profile.model,
        state: "running",
      })
      .returning({ id: generation.id });
    return row;
  });
  let inputTokens: number | null = null,
    outputTokens: number | null = null;
  try {
    const prompt = optimizeResearchPrompt(
      data.topic,
      basis.gap.description,
      basis.gap.type,
      basis.overview,
      JSON.stringify(basis.rules),
    );
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(120000),
    ]);
    const result = await streamModel(
      [{ role: "user", content: prompt }],
      async () => {
        signal.throwIfAborted();
        await researchAuthor(
          getPool(),
          w,
          context.user.id,
          data.origin.kind === "review",
        );
      },
      signal,
      "knowledge",
    );
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
    requireWriter(await requireWorkspace(request.headers, w));
    await researchAuthor(
      getPool(),
      w,
      context.user.id,
      data.origin.kind === "review",
    );
    if ((await researchContext(getPool(), w, data)).hash !== basis.hash)
      throw new AccessError(
        409,
        "목적이나 대상 자료가 변경되었습니다. 주제를 다시 보완해 주세요.",
      );
    const parsed = parseOptimizedResearchTopic(result.text, data.topic);
    const optimized = z
      .object({
        topic: z.string().trim().min(1).max(150),
        searchQueries: z.array(z.string().trim().min(1).max(400)).min(1).max(3),
      })
      .parse(parsed);
    await getDb()
      .update(generation)
      .set({
        state: "completed",
        inputTokens,
        outputTokens,
        updatedAt: new Date(),
      })
      .where(eq(generation.id, run.id));
    return optimized;
  } catch (error) {
    await getDb()
      .update(generation)
      .set({
        state: "failed",
        inputTokens,
        outputTokens,
        errorMessage: "조사 주제 보완을 완료하지 못했습니다.",
        updatedAt: new Date(),
      })
      .where(eq(generation.id, run.id));
    throw error;
  }
}
