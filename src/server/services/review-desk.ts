import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AccessError, requireWorkspace } from "@/server/access";
import { getDb, getPool } from "@/server/db";
import {
  contentIssue,
  reviewAssignment,
  reviewEvent,
} from "@/server/db/schema";
import { requireReviewer } from "./content-access";
import { latestBatchCondition } from "./generation-batches";
import { qualitySnapshot } from "./quality";
import { sourceDetails } from "./sources";
import { wikiDetails } from "./wiki";

export type ReviewTarget = {
  kind:
    | "source"
    | "wiki"
    | "batch"
    | "feedback"
    | "issue"
    | "rfp"
    | "official"
    | "quality";
  id: string;
  parent_id: string;
  title: string;
  state: string;
  created_at: Date;
  note: string;
  assignee_id: string | null;
  assignee_name: string | null;
  age_days: number;
};
const targetSql = `SELECT 'source' AS kind,v.id,s.id AS parent_id,s.title,v.publication::text AS state,v.created_at,'' AS note FROM source_version v JOIN source s ON s.latest_version_id=v.id WHERE s.workspace_id=$1 AND v.publication='pending'
UNION ALL SELECT 'wiki',v.id,p.id,v.title,v.state::text,v.created_at,'' FROM wiki_version v JOIN wiki_page p ON p.latest_version_id=v.id WHERE p.workspace_id=$1 AND v.state='submitted'
UNION ALL SELECT 'batch',id,id,title,state,created_at,'' FROM change_batch WHERE workspace_id=$1 AND state='submitted' AND ${latestBatchCondition}
UNION ALL SELECT 'rfp',v.id,r.id,v.title,v.state,v.created_at,'' FROM rfp_version v JOIN rfp_report r ON r.latest_version_id=v.id WHERE r.workspace_id=$1 AND v.state='submitted'
UNION ALL SELECT 'official',id,id,title,state,created_at,'' FROM official_candidate WHERE workspace_id=$1 AND state='captured'
UNION ALL SELECT 'feedback',id,id,CASE WHEN rating='helpful' THEN '도움이 된 답변' ELSE '답변 수정 요청' END,state,created_at,note FROM chat_feedback WHERE workspace_id=$1
UNION ALL SELECT 'issue',id,target_id,title,state,created_at,note FROM content_issue WHERE workspace_id=$1
UNION ALL SELECT 'quality',id,domain_id,title,state,created_at,note FROM quality_finding WHERE workspace_id=$1`;
export async function reviewCounts(w: string, userId: string) {
  const result = await getPool().query(
    `WITH targets AS (${targetSql}) SELECT count(*)::int AS pending,count(*) FILTER(WHERE a.assignee_id=$2)::int AS assigned FROM targets t LEFT JOIN review_assignment a ON a.workspace_id=$1 AND a.kind=t.kind AND a.target_id=t.id WHERE t.state<>'resolved'`,
    [w, userId],
  );
  return result.rows[0] as { pending: number; assigned: number };
}
export async function reviewDesk(h: Headers, w: string, input: unknown = {}) {
  const c = await requireWorkspace(h, w);
  requireReviewer(c);
  const filter = z
    .object({
      kind: z
        .enum([
          "source",
          "wiki",
          "batch",
          "feedback",
          "issue",
          "rfp",
          "official",
          "quality",
        ])
        .optional(),
      targetId: z.uuid().optional(),
      filter: z.enum(["all", "mine", "resolved", "unassigned"]).default("all"),
    })
    .parse(input);
  const [targets, reviewers, events, wikis] = await Promise.all([
    getPool().query<ReviewTarget>(
      `WITH targets AS (${targetSql}) SELECT t.*,a.assignee_id,u.name AS assignee_name, floor(extract(epoch FROM now()-t.created_at)/86400)::int AS age_days FROM targets t LEFT JOIN review_assignment a ON a.workspace_id=$1 AND a.kind=t.kind AND a.target_id=t.id LEFT JOIN membership m ON m.workspace_id=a.workspace_id AND m.user_id=a.assignee_id AND m.is_active AND (m.is_admin OR m.role='reviewer') LEFT JOIN app_user u ON u.id=m.user_id WHERE ($2::text IS NULL OR t.kind=$2) AND ($3::uuid IS NULL OR t.id=$3) AND ($3 IS NOT NULL OR $4='all' OR ($4='mine' AND a.assignee_id=$5 AND t.state<>'resolved') OR ($4='resolved' AND t.state='resolved') OR ($4='unassigned' AND u.id IS NULL AND t.state<>'resolved')) ORDER BY (t.state='resolved'),t.created_at,t.id LIMIT 500`,
      [
        w,
        filter.kind ?? null,
        filter.targetId ?? null,
        filter.filter,
        c.user.id,
      ],
    ),
    getPool().query<{ id: string; name: string }>(
      `SELECT u.id,u.name FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.is_active AND (m.is_admin OR m.role='reviewer') ORDER BY u.name`,
      [w],
    ),
    getDb()
      .select()
      .from(reviewEvent)
      .where(
        and(
          eq(reviewEvent.workspaceId, w),
          filter.kind ? eq(reviewEvent.kind, filter.kind) : undefined,
          filter.targetId
            ? eq(reviewEvent.targetId, filter.targetId)
            : undefined,
        ),
      )
      .orderBy(desc(reviewEvent.createdAt))
      .limit(100),
    getPool().query<{ id: string; title: string }>(
      `SELECT p.id,v.title FROM wiki_page p JOIN wiki_version v ON v.id=p.published_version_id WHERE p.workspace_id=$1 AND v.state='approved' AND NOT EXISTS(SELECT 1 FROM wiki_evidence e JOIN source_chunk c ON c.id=e.chunk_id WHERE e.version_id=v.id AND NOT source_is_current(c.version_id)) ORDER BY v.title LIMIT 300`,
      [w],
    ),
  ]);
  return {
    targets: targets.rows,
    reviewers: reviewers.rows,
    events,
    me: c.user.id,
    wikis: wikis.rows,
  };
}
export async function reportIssue(h: Headers, w: string, input: unknown) {
  const c = await requireWorkspace(h, w);
  const data = z
    .object({
      kind: z.enum(["source", "wiki"]),
      targetId: z.uuid(),
      note: z.string().trim().min(5).max(2000),
    })
    .strict()
    .parse(input);
  const title =
    data.kind === "source"
      ? (await sourceDetails(h, w, data.targetId)).source.title
      : (await wikiDetails(h, w, data.targetId)).version.title;
  const [saved] = await getDb()
    .insert(contentIssue)
    .values({ ...data, title, workspaceId: w, authorId: c.user.id })
    .returning();
  return saved;
}
export async function myIssues(h: Headers, w: string) {
  const c = await requireWorkspace(h, w);
  const issues = await getDb()
    .select()
    .from(contentIssue)
    .where(
      and(
        eq(contentIssue.workspaceId, w),
        eq(contentIssue.authorId, c.user.id),
      ),
    )
    .orderBy(desc(contentIssue.updatedAt))
    .limit(100);
  const feedback = await getPool().query(
    `SELECT f.id,f.rating,f.note,f.state,f.created_at,r.id AS run_id,c.id AS conversation_id FROM chat_feedback f JOIN chat_run r ON r.id=f.run_id JOIN conversation c ON c.id=r.conversation_id AND c.owner_id=$2 WHERE f.workspace_id=$1 AND f.author_id=$2 ORDER BY f.created_at DESC LIMIT 100`,
    [w, c.user.id],
  );
  const ids = [...issues.map((i) => i.id), ...feedback.rows.map((i) => i.id)];
  const events = ids.length
    ? await getPool().query(
        `SELECT kind,target_id,action,note,created_at FROM review_event WHERE workspace_id=$1 AND kind IN ('issue','feedback') AND target_id=ANY($2::uuid[]) ORDER BY created_at DESC LIMIT 200`,
        [w, ids],
      )
    : { rows: [] };
  return { issues, feedback: feedback.rows, events: events.rows };
}
export async function reviewDeskAction(h: Headers, w: string, input: unknown) {
  const c = await requireWorkspace(h, w);
  requireReviewer(c);
  const data = z
    .object({
      kind: z.enum([
        "source",
        "wiki",
        "batch",
        "feedback",
        "issue",
        "rfp",
        "official",
        "quality",
      ]),
      targetId: z.uuid(),
      action: z.enum(["assign", "triage", "defer", "resolve", "reopen"]),
      assigneeId: z.string().min(1).max(128).nullable().default(null),
      note: z.string().trim().max(2000).default(""),
      fixedWikiId: z.uuid().nullable().default(null),
    })
    .strict()
    .parse(input);
  return getDb().transaction(async (tx) => {
    if (data.kind === "quality") {
      const scope = await tx.execute(
        sql`SELECT domain_id,project_id FROM quality_finding WHERE workspace_id=${w} AND id=${data.targetId}`,
      );
      if (!scope.rowCount)
        throw new AccessError(404, "검토 항목을 찾을 수 없습니다.");
      const f = scope.rows[0];
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${w}:${f.domain_id}:${f.project_id ?? "*"}`},14))`,
      );
      if (data.action === "resolve") {
        await tx.execute(
          sql`SELECT id FROM domain WHERE workspace_id=${w} AND id=${String(f.domain_id)} FOR SHARE`,
        );
        await tx.execute(
          sql`SELECT id FROM wiki_page WHERE workspace_id=${w} AND domain_id=${String(f.domain_id)} FOR SHARE`,
        );
        await tx.execute(
          sql`SELECT id FROM source WHERE workspace_id=${w} AND domain_id=${String(f.domain_id)} FOR SHARE`,
        );
      }
    }
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${w}:${data.kind}:${data.targetId}`},6))`,
    );
    const table = {
      source: "source_version",
      rfp: "rfp_version",
      official: "official_candidate",
      wiki: "wiki_version",
      batch: "change_batch",
      feedback: "chat_feedback",
      issue: "content_issue",
      quality: "quality_finding",
    }[data.kind];
    const locked = await tx.execute(
      sql`SELECT id,${sql.identifier(data.kind === "source" ? "publication" : "state")} AS state FROM ${sql.identifier(table)} WHERE workspace_id=${w} AND id=${data.targetId} FOR UPDATE`,
    );
    if (!locked.rowCount)
      throw new AccessError(404, "검토 항목을 찾을 수 없습니다.");
    const found = locked;
    if (["source", "wiki", "batch", "rfp", "official"].includes(data.kind)) {
      const expected =
        data.kind === "source"
          ? "pending"
          : data.kind === "official"
            ? "captured"
            : "submitted";
      if (found.rows[0].state !== expected)
        throw new AccessError(409, "검토 대상의 상태가 바뀌었습니다.");
      if (["source", "wiki", "rfp"].includes(data.kind)) {
        const parent = await tx.execute(
          sql`SELECT id FROM ${sql.identifier(data.kind === "source" ? "source" : data.kind === "rfp" ? "rfp_report" : "wiki_page")} WHERE workspace_id=${w} AND latest_version_id=${data.targetId}`,
        );
        if (!parent.rowCount)
          throw new AccessError(409, "최신 검토 버전을 선택해 주세요.");
      }
    }
    if (data.kind === "batch") {
      const latest = await tx.execute(
        sql`SELECT id FROM change_batch WHERE id=${data.targetId} AND ${sql.raw(latestBatchCondition)}`,
      );
      if (!latest.rowCount)
        throw new AccessError(409, "새로 수정한 검토 묶음을 선택해 주세요.");
    }
    let note = data.note;
    if (data.action === "assign") {
      let name = "담당 미지정";
      if (data.assigneeId) {
        const result = await tx.execute(
          sql`SELECT u.name FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.workspace_id=${w} AND m.user_id=${data.assigneeId} AND m.is_active AND (m.is_admin OR m.role='reviewer')`,
        );
        if (!result.rowCount)
          throw new AccessError(
            409,
            "현재 활동 중인 검토 직원을 선택해 주세요.",
          );
        name = String(result.rows[0].name);
      }
      await tx
        .insert(reviewAssignment)
        .values({
          workspaceId: w,
          kind: data.kind,
          targetId: data.targetId,
          assigneeId: data.assigneeId,
        })
        .onConflictDoUpdate({
          target: [
            reviewAssignment.workspaceId,
            reviewAssignment.kind,
            reviewAssignment.targetId,
          ],
          set: { assigneeId: data.assigneeId, updatedAt: new Date() },
        });
      note = `담당: ${name}${note ? ` · ${note}` : ""}`;
    } else {
      if (!["feedback", "issue", "quality"].includes(data.kind))
        throw new AccessError(
          400,
          "게시·공개 요청은 해당 자료에서 검토해 주세요.",
        );
      if (!note) throw new AccessError(400, "처리 이유를 입력해 주세요.");
      const current = String(found.rows[0].state);
      if (data.action === "defer" && data.kind !== "quality")
        throw new AccessError(
          400,
          "품질 점검 후보에만 보류를 사용할 수 있습니다.",
        );
      if (data.kind === "quality" && data.action === "resolve") {
        const details = await tx.execute(
          sql`SELECT domain_id,project_id,basis_hash FROM quality_finding WHERE workspace_id=${w} AND id=${data.targetId}`,
        );
        const f = details.rows[0];
        const current = await qualitySnapshot(
          getPool(),
          w,
          String(f.domain_id),
          f.project_id ? String(f.project_id) : null,
        );
        if (current.hash !== f.basis_hash)
          throw new AccessError(
            409,
            "페이지·원문·목적이 바뀌었습니다. 재점검한 뒤 처리해 주세요.",
          );
      }
      const state = {
        triage: "triaged",
        defer: "deferred",
        resolve: "resolved",
        reopen: "open",
      }[data.action];
      if (
        current === state ||
        (current === "resolved" && data.action !== "reopen") ||
        (current !== "resolved" && data.action === "reopen")
      )
        throw new AccessError(
          409,
          "처리 상태가 바뀌었습니다. 목록을 다시 확인해 주세요.",
        );
      if (data.fixedWikiId) {
        const valid = await tx.execute(
          sql`SELECT p.id FROM wiki_page p JOIN wiki_version v ON v.id=p.published_version_id WHERE p.workspace_id=${w} AND p.id=${data.fixedWikiId} AND v.state='approved' AND NOT EXISTS(SELECT 1 FROM wiki_evidence e JOIN source_chunk c ON c.id=e.chunk_id WHERE e.version_id=v.id AND NOT source_is_current(c.version_id))`,
        );
        if (!valid.rowCount)
          throw new AccessError(
            409,
            "현재 게시된 위키를 수정 결과로 연결해 주세요.",
          );
        note += `\n수정 위키: /w/${w}/wiki/${data.fixedWikiId}`;
      }
      await tx.execute(
        sql`UPDATE ${sql.identifier(table)} SET state=${state},updated_at=now() WHERE workspace_id=${w} AND id=${data.targetId}`,
      );
      if (data.kind === "quality")
        await tx.execute(
          sql`UPDATE quality_finding SET resolution=${note},fixed_wiki_id=${data.fixedWikiId} WHERE workspace_id=${w} AND id=${data.targetId}`,
        );
      if (data.kind === "issue")
        await tx
          .update(contentIssue)
          .set({ resolution: note, fixedWikiId: data.fixedWikiId })
          .where(eq(contentIssue.id, data.targetId));
    }
    await tx.insert(reviewEvent).values({
      workspaceId: w,
      kind: data.kind,
      targetId: data.targetId,
      actorId: c.user.id,
      action: data.action,
      note,
    });
    return { saved: true };
  });
}
