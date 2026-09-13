import "server-only";
import { createHmac } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { AccessError, requireWorkspace } from "@/server/access";
import { getDb, getPool } from "@/server/db";
import {
  conversation,
  generation,
  operationsEvent,
  operationsPolicy,
} from "@/server/db/schema";
import { getServerEnv } from "@/server/env";
import { parseId } from "./content-access";
import type { QueryDb } from "./wiki";

export async function checkAiCapacity(tx: QueryDb, w: string) {
  const result = await tx.execute(
    sql`SELECT (SELECT count(*) FROM chat_run WHERE workspace_id=${w} AND state='running' AND updated_at>=now()-interval '30 seconds') + (SELECT count(*) FROM generation WHERE workspace_id=${w} AND state='running' AND task_id IS NULL AND (CASE WHEN kind IN ('wiki-quality','deep-research') THEN updated_at ELSE created_at END)>=now()-interval '3 minutes') + (SELECT count(*) FROM ai_task WHERE workspace_id=${w} AND state='running') AS active, COALESCE((SELECT concurrency FROM operations_policy WHERE workspace_id=${w}),${getServerEnv().AI_MAX_CONCURRENT}) AS capacity`,
  );
  if (Number(result.rows[0].active) >= Number(result.rows[0].capacity))
    throw new AccessError(
      429,
      "팀의 AI 동시 요청 한도에 도달했습니다. 진행 중인 작업이 끝난 뒤 다시 시도해 주세요.",
    );
}
export async function policyFor(w: string) {
  const [policy] = await getDb()
    .select()
    .from(operationsPolicy)
    .where(eq(operationsPolicy.workspaceId, w));
  return (
    policy ?? {
      workspaceId: w,
      concurrency: getServerEnv().AI_MAX_CONCURRENT,
      retentionDays: 365,
      inputPrice: null,
      outputPrice: null,
      currency: "KRW",
    }
  );
}
const policyInput = z
  .object({
    concurrency: z.number().int().min(1).max(20),
    retentionDays: z.number().int().min(1).max(3650),
    inputPrice: z.number().int().min(0).max(100000000).nullable(),
    outputPrice: z.number().int().min(0).max(100000000).nullable(),
    currency: z.literal("KRW"),
  })
  .strict();
export async function saveOperationsPolicy(
  h: Headers,
  w: string,
  input: unknown,
) {
  const context = await requireWorkspace(h, w, true);
  const values = policyInput.parse(input);
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${w},3))`,
    );
    await tx
      .insert(operationsPolicy)
      .values({ workspaceId: w, ...values })
      .onConflictDoUpdate({
        target: operationsPolicy.workspaceId,
        set: values,
      });
    await tx.insert(operationsEvent).values({
      workspaceId: w,
      actorId: context.user.id,
      action: "policy",
      counts: {
        concurrency: values.concurrency,
        retentionDays: values.retentionDays,
      },
    });
    return values;
  });
}
export async function operationsOverview(h: Headers, w: string) {
  await requireWorkspace(h, w, true);
  const [policy, usage, jobs, errors, events, embedding] = await Promise.all([
    policyFor(w),
    getPool().query(
      `WITH runs AS (SELECT model,state,input_tokens,output_tokens,created_at FROM chat_run WHERE workspace_id=$1 UNION ALL SELECT model,state,input_tokens,output_tokens,created_at FROM generation WHERE workspace_id=$1) SELECT model,count(*)::int AS requests,count(*) FILTER(WHERE input_tokens IS NULL OR output_tokens IS NULL)::int AS unknown,sum(input_tokens)::bigint AS input,sum(output_tokens)::bigint AS output,count(*) FILTER(WHERE state IN ('failed','interrupted'))::int AS failures FROM runs WHERE created_at>=now()-interval '30 days' GROUP BY model ORDER BY model`,
      [w],
    ),
    getPool().query(
      `SELECT v.id,v.source_id,s.title,v.number,v.processing,v.error_message,v.updated_at FROM source_version v JOIN source s ON s.id=v.source_id WHERE v.workspace_id=$1 AND v.processing IN ('queued','processing','failed','canceled') ORDER BY v.updated_at DESC LIMIT 100`,
      [w],
    ),
    getPool().query(
      `SELECT kind,state,error_message,created_at FROM (SELECT 'chat' AS kind,state,error_message,created_at FROM chat_run WHERE workspace_id=$1 UNION ALL SELECT CASE WHEN kind='wiki-quality' THEN 'quality' ELSE 'generation' END,state,error_message,created_at FROM generation WHERE workspace_id=$1) t WHERE error_message IS NOT NULL ORDER BY created_at DESC LIMIT 50`,
      [w],
    ),
    getDb()
      .select()
      .from(operationsEvent)
      .where(eq(operationsEvent.workspaceId, w))
      .orderBy(desc(operationsEvent.createdAt))
      .limit(50),
    getPool().query(
      `SELECT model,purpose,count(*)::int AS requests,count(*) FILTER(WHERE input_tokens IS NULL)::int AS unknown,sum(input_tokens)::bigint AS input,count(*) FILTER(WHERE state='failed')::int AS failures FROM embedding_usage WHERE workspace_id=$1 AND created_at>=now()-interval '30 days' GROUP BY model,purpose ORDER BY model,purpose`,
      [w],
    ),
  ]);
  return {
    policy,
    embedding: embedding.rows,
    usage: usage.rows.map((r) => ({
      ...r,
      estimate:
        policy.inputPrice === null ||
        policy.outputPrice === null ||
        r.input === null ||
        r.output === null
          ? null
          : (Number(r.input) * policy.inputPrice +
              Number(r.output) * policy.outputPrice) /
            1000000,
    })),
    jobs: jobs.rows,
    errors: errors.rows,
    events,
  };
}
async function retentionTargets(tx: QueryDb, w: string, cutoff: string) {
  const chats = await tx.execute(
    sql`SELECT c.id FROM conversation c WHERE c.workspace_id=${w} AND c.updated_at<${cutoff}::timestamptz AND NOT EXISTS(SELECT 1 FROM chat_run r WHERE r.conversation_id=c.id AND (r.state='running' OR EXISTS(SELECT 1 FROM chat_feedback f WHERE f.run_id=r.id AND f.state<>'resolved'))) ORDER BY c.id LIMIT 1000`,
  );
  const gens = await tx.execute(
    sql`SELECT id FROM generation WHERE workspace_id=${w} AND state<>'running' AND updated_at<${cutoff}::timestamptz ORDER BY id LIMIT 1000`,
  );
  return {
    conversations: chats.rows.map((r) => String(r.id)),
    generations: gens.rows.map((r) => String(r.id)),
  };
}
function retentionToken(
  w: string,
  cutoff: string,
  ids: Awaited<ReturnType<typeof retentionTargets>>,
) {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update(JSON.stringify({ w, cutoff, ids }))
    .digest("hex");
}
export async function retentionAction(h: Headers, w: string, input: unknown) {
  const c = await requireWorkspace(h, w, true);
  const command = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("preview") }).strict(),
      z
        .object({
          action: z.literal("delete"),
          cutoff: z.iso.datetime(),
          token: z.string().length(64),
          confirmation: z.literal("보존 기간이 지난 대화 삭제"),
        })
        .strict(),
    ])
    .parse(input);
  const policy = await policyFor(w);
  const cutoff =
    command.action === "preview"
      ? new Date(Date.now() - policy.retentionDays * 86400000).toISOString()
      : command.cutoff;
  if (new Date(cutoff).getTime() > Date.now() - policy.retentionDays * 86400000)
    throw new AccessError(
      409,
      "보존 정책이 바뀌었습니다. 대상을 다시 확인해 주세요.",
    );
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${w},3))`,
    );
    const ids = await retentionTargets(tx, w, cutoff);
    const token = retentionToken(w, cutoff, ids);
    const counts = {
      conversations: ids.conversations.length,
      generations: ids.generations.length,
    };
    if (command.action === "preview") return { cutoff, token, counts };
    if (token !== command.token)
      throw new AccessError(
        409,
        "삭제 대상이 바뀌었습니다. 미리보기를 다시 확인해 주세요.",
      );
    if (ids.conversations.length) {
      const selected = sql.join(
        ids.conversations.map((id) => sql`${id}::uuid`),
        sql`,`,
      );
      for (const table of ["review_assignment", "review_event"] as const)
        await tx.execute(
          sql`DELETE FROM ${sql.identifier(table)} WHERE workspace_id=${w} AND kind='feedback' AND target_id IN (SELECT f.id FROM chat_feedback f JOIN chat_run r ON r.id=f.run_id WHERE r.conversation_id IN (${selected}))`,
        );
      await tx
        .delete(conversation)
        .where(
          and(
            eq(conversation.workspaceId, w),
            inArray(conversation.id, ids.conversations),
          ),
        );
    }
    if (ids.generations.length)
      await tx
        .delete(generation)
        .where(
          and(
            eq(generation.workspaceId, w),
            inArray(generation.id, ids.generations),
          ),
        );
    await tx.insert(operationsEvent).values({
      workspaceId: w,
      actorId: c.user.id,
      action: "retention",
      counts,
    });
    return { deleted: counts };
  });
}
export async function deleteOwnConversation(h: Headers, w: string, id: string) {
  const c = await requireWorkspace(h, w);
  parseId(id);
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${w},3))`,
    );
    const [item] = await tx
      .select()
      .from(conversation)
      .where(
        and(
          eq(conversation.workspaceId, w),
          eq(conversation.ownerId, c.user.id),
          eq(conversation.id, id),
        ),
      )
      .for("update");
    if (!item) throw new AccessError(404, "대화를 찾을 수 없습니다.");
    const active = await tx.execute(
      sql`SELECT 1 FROM chat_run WHERE conversation_id=${id} AND state='running'`,
    );
    if (active.rowCount)
      throw new AccessError(409, "답변을 중지한 뒤 대화를 삭제해 주세요.");
    for (const table of ["review_assignment", "review_event"] as const)
      await tx.execute(
        sql`DELETE FROM ${sql.identifier(table)} WHERE workspace_id=${w} AND kind='feedback' AND target_id IN (SELECT f.id FROM chat_feedback f JOIN chat_run r ON r.id=f.run_id WHERE r.conversation_id=${id})`,
      );
    await tx.delete(conversation).where(eq(conversation.id, id));
    return { deleted: true };
  });
}
