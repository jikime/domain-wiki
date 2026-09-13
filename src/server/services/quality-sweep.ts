import "server-only";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { z } from "zod";
import { qualityActionScope } from "@/lib/quality-actions";
import { parseFrontmatter } from "@/lib/reference/frontmatter";
import {
  extractJsonObject,
  ruleResolvedReview,
  sweepJudgePrompt,
  type WikiIndex,
} from "@/lib/reference/sweep-reviews";
import { AccessError, requireWorkspace } from "@/server/access";
import { modelProfile, streamModel } from "@/server/ai/client";
import { getDb, getPool } from "@/server/db";
import { generation } from "@/server/db/schema";
import { checkScope, requireReviewer } from "./content-access";
import { checkAiCapacity } from "./operations";
import { type QualityFinding, qualityAuthor, qualitySnapshot } from "./quality";

const inputSchema = qualityActionScope
  .extend({
    action: z.enum(["preview", "apply"]),
    requestId: z.uuid().optional(),
    useAi: z.boolean().default(true),
    id: z.uuid().optional(),
    basis: z.string().length(64).optional(),
    findingIds: z.array(z.uuid()).max(500).default([]),
  })
  .strict();
async function sweepBasis(
  db: Pick<PoolClient, "query">,
  w: string,
  scope: z.infer<typeof qualityActionScope>,
) {
  const current = await qualitySnapshot(db, w, scope.domainId, scope.projectId);
  const rows = await db.query<QualityFinding>(
    "SELECT * FROM quality_finding WHERE workspace_id=$1 AND domain_id=$2 AND project_id IS NOT DISTINCT FROM $3::uuid AND state<>'resolved' ORDER BY id LIMIT 501",
    [w, scope.domainId, scope.projectId],
  );
  if (rows.rows.length > 500)
    throw new AccessError(
      413,
      "검토 항목이 500건을 넘습니다. 프로젝트 범위를 좁혀 주세요.",
    );
  const basis = createHash("sha256")
    .update(JSON.stringify([current.hash, rows.rows]))
    .digest("hex");
  return { ...current, findings: rows.rows, basis };
}
type StoredSweep = {
  scope: z.infer<typeof qualityActionScope>;
  basis: string;
  candidates: { id: string; method: "rule" | "model" }[];
  judged: number;
  pending: number;
  applied?: boolean;
};

export async function sweepQuality(
  request: Request,
  w: string,
  input: unknown,
) {
  const context = await requireWorkspace(request.headers, w);
  requireReviewer(context);
  const data = inputSchema.parse(input);
  const scope = { domainId: data.domainId, projectId: data.projectId };
  await checkScope(w, scope.domainId, scope.projectId);
  if (data.action === "apply") {
    if (!data.id || !data.basis || !data.findingIds.length)
      throw new AccessError(400, "미리보기에서 해결할 항목을 선택해 주세요.");
    const db = await getPool().connect();
    try {
      await db.query("BEGIN");
      await db.query(
        "SELECT user_id FROM membership WHERE workspace_id=$1 AND user_id=$2 FOR SHARE",
        [w, context.user.id],
      );
      await qualityAuthor(db, w, context.user.id);
      const result = await db.query<{ result: StoredSweep }>(
        "SELECT result FROM generation WHERE workspace_id=$1 AND author_id=$2 AND id=$3 AND kind='quality-sweep' AND state='completed' FOR UPDATE",
        [w, context.user.id, data.id],
      );
      const saved = result.rows[0]?.result;
      if (
        !saved ||
        saved.applied ||
        saved.scope.domainId !== scope.domainId ||
        saved.scope.projectId !== scope.projectId
      )
        throw new AccessError(409, "검토 정리 미리보기를 다시 실행해 주세요.");
      await db.query(
        "LOCK TABLE wiki_page,source,domain,quality_policy IN SHARE MODE",
      );
      await db.query(
        "SELECT id FROM quality_finding WHERE workspace_id=$1 AND domain_id=$2 AND project_id IS NOT DISTINCT FROM $3::uuid ORDER BY id FOR UPDATE",
        [w, scope.domainId, scope.projectId],
      );
      const current = await sweepBasis(db, w, scope);
      if (data.basis !== saved.basis || saved.basis !== current.basis)
        throw new AccessError(
          409,
          "자료나 검토 상태가 변경되었습니다. 검토 정리를 다시 실행해 주세요.",
        );
      const ids = [...new Set(data.findingIds)];
      if (
        ids.some(
          (id) => !saved.candidates.some((candidate) => candidate.id === id),
        )
      )
        throw new AccessError(
          400,
          "미리보기에 있는 해결 후보만 선택해 주세요.",
        );
      for (const id of ids) {
        const method = saved.candidates.find(
          (candidate) => candidate.id === id,
        )?.method;
        const note = `${method === "rule" ? "문서 이름·제목 대조" : "AI 재검토"} 결과를 검토 직원이 확인하고 해결 처리했습니다.`;
        await db.query(
          "UPDATE quality_finding SET state='resolved',resolution=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2",
          [w, id, note],
        );
        await db.query(
          "INSERT INTO review_event(workspace_id,kind,target_id,actor_id,action,note) VALUES($1,'quality',$2,$3,'sweep-resolved',$4)",
          [w, id, context.user.id, note],
        );
      }
      await db.query(
        "UPDATE generation SET result=result||'{\"applied\":true}'::jsonb,updated_at=now() WHERE id=$1",
        [data.id],
      );
      await db.query("COMMIT");
      return { resolved: ids.length };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  if (!data.requestId) throw new AccessError(400, "새 요청 번호가 필요합니다.");
  const initial = await sweepBasis(getPool(), w, scope);
  const pages = initial.snapshot.pages.map((page) => ({
    id: (page.metadata?.path?.split("/").at(-1) ?? `${page.id}.md`)
      .replace(/\.md$/, "")
      .toLowerCase(),
    title:
      typeof parseFrontmatter(page.body).frontmatter?.title === "string"
        ? String(parseFrontmatter(page.body).frontmatter?.title).trim()
        : page.title,
  }));
  const index: WikiIndex = {
    pages,
    byId: new Set(pages.map((p) => p.id)),
    byTitle: new Set(pages.map((p) => p.title.toLowerCase())),
  };
  const reviews = initial.findings.map((f) => ({
    id: f.id,
    type: f.kind,
    title: f.title,
    description: f.note,
    affectedPages: f.page_ids.map(
      (id) =>
        initial.snapshot.pages.find((p) => p.id === id)?.metadata?.path ??
        `${id}.md`,
    ),
  }));
  const candidates: StoredSweep["candidates"] = reviews
    .filter((r) => ruleResolvedReview(r, index))
    .map((r) => ({ id: r.id, method: "rule" }));
  // Company reviews retain human judgments even if a model returns their IDs.
  const remaining = reviews.filter(
    (r) =>
      !candidates.some((c) => c.id === r.id) &&
      !["contradiction", "confirm", "suggestion"].includes(r.type),
  );
  const profile = modelProfile("knowledge");
  if (data.useAi && remaining.length && !profile.configured)
    throw new AccessError(
      503,
      "지식 정리 모델을 설정하거나 문서 이름 대조만 실행해 주세요.",
    );
  const run = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${w},3))`,
    );
    const [existing] = await tx
      .select({ id: generation.id })
      .from(generation)
      .where(
        and(
          eq(generation.workspaceId, w),
          eq(generation.authorId, context.user.id),
          eq(generation.requestId, data.requestId ?? ""),
        ),
      );
    if (existing)
      throw new AccessError(
        409,
        "이미 사용한 요청 번호입니다. 새 요청으로 실행해 주세요.",
      );
    if (data.useAi && remaining.length) await checkAiCapacity(tx, w);
    const [row] = await tx
      .insert(generation)
      .values({
        workspaceId: w,
        authorId: context.user.id,
        requestId: data.requestId ?? "",
        inputHash: initial.basis,
        kind: "quality-sweep",
        model: data.useAi ? profile.model : null,
        state: "running",
      })
      .returning({ id: generation.id });
    return row;
  });
  const abort = new AbortController();
  const signal = AbortSignal.any([
    request.signal,
    abort.signal,
    AbortSignal.timeout(120000),
  ]);
  const guard = async () => {
    signal.throwIfAborted();
    requireReviewer(await requireWorkspace(request.headers, w));
    if ((await sweepBasis(getPool(), w, scope)).basis !== initial.basis)
      throw new AccessError(
        409,
        "자료나 검토 상태가 변경되어 재검토를 중지했습니다.",
      );
  };
  let checking = false;
  const timer = setInterval(async () => {
    if (checking || signal.aborted) return;
    checking = true;
    try {
      await guard();
    } catch (error) {
      abort.abort(error);
    } finally {
      checking = false;
    }
  }, 1000);
  let inputTokens = 0,
    outputTokens = 0,
    judged = 0;
  try {
    if (data.useAi)
      for (
        let start = 0;
        start < Math.min(remaining.length, 200);
        start += 40
      ) {
        await guard();
        const batch = remaining.slice(start, start + 40);
        const result = await streamModel(
          [{ role: "user", content: sweepJudgePrompt(batch, index) }],
          async () => {
            await guard();
          },
          signal,
          "knowledge",
        );
        inputTokens += result.inputTokens ?? 0;
        outputTokens += result.outputTokens ?? 0;
        judged += batch.length;
        let ids: unknown[] = [];
        try {
          const parsed = JSON.parse(extractJsonObject(result.text));
          if (Array.isArray(parsed?.resolved)) ids = parsed.resolved;
        } catch {
          /* Malformed responses resolve nothing, matching upstream. */
        }
        const found = batch.filter((r) => ids.includes(r.id));
        if (!found.length) break;
        candidates.push(
          ...found.map((r) => ({ id: r.id, method: "model" as const })),
        );
      }
    await guard();
    const result: StoredSweep = {
      scope,
      basis: initial.basis,
      candidates,
      judged,
      pending: reviews.length,
    };
    await getDb()
      .update(generation)
      .set({
        state: "completed",
        inputTokens,
        outputTokens,
        result,
        updatedAt: new Date(),
      })
      .where(eq(generation.id, run.id));
    return {
      ...result,
      id: run.id,
      candidates: candidates.map((c) => ({
        ...c,
        title:
          initial.findings.find((f) => f.id === c.id)?.title ?? "검토 항목",
      })),
    };
  } catch (error) {
    const reason = signal.aborted ? signal.reason : error;
    await getDb()
      .update(generation)
      .set({
        state: "failed",
        inputTokens,
        outputTokens,
        errorMessage:
          reason instanceof AccessError
            ? reason.message
            : "검토 정리를 완료하지 못했습니다.",
        updatedAt: new Date(),
      })
      .where(eq(generation.id, run.id));
    if (reason instanceof AccessError) throw reason;
    if (signal.aborted)
      throw new AccessError(
        409,
        "검토 정리를 중지했습니다. 다시 실행해 주세요.",
      );
    throw error;
  } finally {
    clearInterval(timer);
  }
}
