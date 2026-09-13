import "server-only";
import { createHmac } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AccessError, requireWorkspace } from "@/server/access";
import { getDb, getPool } from "@/server/db";
import {
  originalGc,
  source,
  sourceRetirement,
  sourceVersion,
} from "@/server/db/schema";
import { getServerEnv } from "@/server/env";
import { policyFor } from "./operations";
export async function retirementOverview(h: Headers, w: string) {
  await requireWorkspace(h, w, true);
  const policy = await policyFor(w);
  const [candidates, history, pending] = await Promise.all([
    getPool().query<{ id: string; title: string }>(
      `SELECT s.id,s.title FROM source s WHERE s.workspace_id=$1 AND s.published_version_id IS NULL AND s.updated_at<now()-$2*interval '1 day' AND NOT EXISTS(SELECT 1 FROM source_version v WHERE v.source_id=s.id AND (v.publication='pending' OR v.processing IN ('queued','processing'))) ORDER BY s.updated_at LIMIT 100`,
      [w, policy.retentionDays],
    ),
    getDb()
      .select({
        id: sourceRetirement.id,
        title: sourceRetirement.title,
        createdAt: sourceRetirement.createdAt,
      })
      .from(sourceRetirement)
      .where(eq(sourceRetirement.workspaceId, w))
      .orderBy(desc(sourceRetirement.createdAt))
      .limit(100),
    getPool().query(
      `SELECT count(*)::int AS count FROM original_gc WHERE workspace_id=$1 AND removed_at IS NULL`,
      [w],
    ),
  ]);
  return {
    candidates: candidates.rows,
    history,
    pendingFiles: pending.rows[0].count,
  };
}
export async function retireSource(h: Headers, w: string, input: unknown) {
  const c = await requireWorkspace(h, w, true);
  const d = z
    .object({
      action: z.enum(["preview", "delete"]),
      sourceId: z.uuid(),
      token: z.string().length(64).optional(),
      confirmation: z.string().max(160).optional(),
    })
    .strict()
    .parse(input);
  const policy = await policyFor(w);
  return getDb().transaction(async (tx) => {
    // Source writers/reviewers use the same row lock before changing versions/publication.
    const [s] = await tx
      .select()
      .from(source)
      .where(and(eq(source.workspaceId, w), eq(source.id, d.sourceId)))
      .for("update");
    if (!s) throw new AccessError(404, "자료를 찾을 수 없습니다.");
    const versions = await tx
      .select()
      .from(sourceVersion)
      .where(eq(sourceVersion.sourceId, s.id))
      .orderBy(sourceVersion.number)
      .for("update");
    if (
      s.publishedVersionId ||
      s.updatedAt.getTime() > Date.now() - policy.retentionDays * 86400000 ||
      versions.some(
        (v) =>
          v.publication === "pending" ||
          ["queued", "processing"].includes(v.processing),
      )
    )
      throw new AccessError(
        409,
        "공개·검토·처리가 끝나고 보존 기간이 지난 자료만 삭제할 수 있습니다.",
      );
    const refs =
      await tx.execute(sql`WITH chunks AS (SELECT c.id FROM source_chunk c JOIN source_version v ON v.id=c.version_id WHERE v.source_id=${s.id}) SELECT
    EXISTS(SELECT 1 FROM rfp_evidence WHERE chunk_id IN(SELECT id FROM chunks)) OR
    EXISTS(SELECT 1 FROM rfp_report WHERE source_id=${s.id}) OR
    EXISTS(SELECT 1 FROM official_candidate WHERE source_version_id IN(SELECT id FROM source_version WHERE source_id=${s.id})) OR
    EXISTS(SELECT 1 FROM wiki_evidence WHERE chunk_id IN(SELECT id FROM chunks)) OR
    EXISTS(SELECT 1 FROM source_version v CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(v.testimony->'chunkIds','[]'::jsonb)) r(chunk) WHERE r.chunk::uuid IN(SELECT id FROM chunks)) OR
    EXISTS(SELECT 1 FROM chat_citation WHERE snapshot->>'id'=${s.id}::text OR snapshot->>'chunkId' IN(SELECT id::text FROM chunks)) OR
    EXISTS(SELECT 1 FROM change_batch b CROSS JOIN LATERAL jsonb_array_elements(b.items) i CROSS JOIN LATERAL jsonb_array_elements_text(i->'chunkIds') r(chunk) WHERE r.chunk::uuid IN(SELECT id FROM chunks)) OR
    EXISTS(SELECT 1 FROM content_issue WHERE workspace_id=${w} AND kind='source' AND target_id=${s.id} AND state<>'resolved') AS blocked`);
    if (refs.rows[0].blocked)
      throw new AccessError(
        409,
        "연결된 위키·실무 기록·대화·변경안 또는 미처리 신고가 있어 보관해야 하는 자료입니다.",
      );
    const summary = versions.map((v) => ({
      id: v.id,
      number: v.number,
      filename: v.filename,
      sha256: v.sha256,
      byteSize: v.byteSize,
      publication: v.publication,
      createdAt: v.createdAt,
    }));
    const token = createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
      .update(JSON.stringify({ w, id: s.id, updatedAt: s.updatedAt, summary }))
      .digest("hex");
    if (d.action === "preview")
      return {
        sourceId: s.id,
        title: s.title,
        files: summary.map((v) => ({
          filename: v.filename,
          number: v.number,
          byteSize: v.byteSize,
        })),
        token,
      };
    if (d.token !== token || d.confirmation !== s.title)
      throw new AccessError(
        409,
        "자료 이름과 삭제 미리보기를 다시 확인해 주세요.",
      );
    const ids = versions.map((v) => v.id);
    const selected = sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`,`,
    );
    const decisions = ids.length
      ? await tx.execute(
          sql`SELECT actor_id,action,note,created_at,source_version_id FROM review_decision WHERE source_version_id IN (${selected}) ORDER BY created_at`,
        )
      : { rows: [] };
    const assignments = ids.length
      ? await tx.execute(
          sql`SELECT actor_id,action,note,created_at,target_id FROM review_event WHERE workspace_id=${w} AND kind='source' AND target_id IN (${selected}) ORDER BY created_at`,
        )
      : { rows: [] };
    await tx.insert(sourceRetirement).values({
      id: s.id,
      workspaceId: w,
      actorId: c.user.id,
      title: s.title,
      metadata: {
        versions: summary,
        decisions: decisions.rows,
        assignments: assignments.rows,
      },
    });
    if (ids.length) {
      await tx.execute(
        sql`INSERT INTO original_gc(workspace_id,storage_key) SELECT workspace_id,storage_key FROM source_asset WHERE workspace_id=${w} AND version_id IN(${selected}) ON CONFLICT DO NOTHING`,
      );
      await tx
        .insert(originalGc)
        .values(
          versions.map((v) => ({ workspaceId: w, storageKey: v.storageKey })),
        );
      await tx.execute(
        sql`DELETE FROM content_embedding WHERE workspace_id=${w} AND kind='source' AND target_id IN(SELECT id FROM source_chunk WHERE version_id IN(${selected}))`,
      );
      for (const table of ["review_assignment", "review_event"] as const)
        await tx.execute(
          sql`DELETE FROM ${sql.identifier(table)} WHERE workspace_id=${w} AND kind='source' AND target_id IN(${selected})`,
        );
    }
    await tx.delete(source).where(eq(source.id, s.id));
    return { deleted: true, files: versions.length };
  });
}
