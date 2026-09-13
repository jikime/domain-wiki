import "server-only";
import { z } from "zod";
import { pageInput, pageResult } from "@/lib/pagination";
import { AccessError, requireWorkspace } from "@/server/access";
import { getPool } from "@/server/db";
import { isWriter } from "./content-access";
import { latestBatchCondition } from "./generation-batches";
import { reviewCounts } from "./review-desk";

const notificationsSql = `
SELECT 'decision:'||d.id AS key,'source' AS kind,s.id AS target_id,v.id AS version_id,s.title,d.action,d.note,d.created_at
FROM review_decision d JOIN source_version v ON v.id=d.source_version_id JOIN source s ON s.id=v.source_id
WHERE d.workspace_id=$1 AND v.uploaded_by=$2 AND ($3='reviewer' OR ($3='writer' AND s.created_by=$2)) AND d.actor_id<>$2 AND d.action IN ('approve','reject','withdraw')
UNION ALL
SELECT 'decision:'||d.id,'wiki',p.id,v.id,v.title,d.action,d.note,d.created_at
FROM review_decision d JOIN wiki_version v ON v.id=d.wiki_version_id JOIN wiki_page p ON p.id=v.page_id
WHERE d.workspace_id=$1 AND v.author_id=$2 AND $3 IN ('writer','reviewer') AND d.actor_id<>$2 AND d.action IN ('approve','reject','withdraw')
UNION ALL
SELECT 'batch:'||d.id,'batch',b.id,NULL::uuid,b.title,d.action,d.note,d.created_at
FROM batch_decision d JOIN change_batch b ON b.id=d.batch_id
WHERE b.workspace_id=$1 AND b.author_id=$2 AND $3 IN ('writer','reviewer') AND d.actor_id<>$2 AND d.action IN ('approve','reject')
UNION ALL
SELECT 'rfp:'||d.id,'rfp',v.report_id,v.id,v.title,d.action,d.note,d.created_at
FROM rfp_decision d JOIN rfp_version v ON v.id=d.version_id
WHERE v.workspace_id=$1 AND v.author_id=$2 AND $3 IN ('writer','reviewer') AND d.actor_id<>$2 AND d.action IN ('approve','reject','withdraw')
UNION ALL
SELECT 'review:'||e.id,'issue',i.id,NULL::uuid,i.title,e.action,e.note,e.created_at
FROM review_event e JOIN content_issue i ON i.id=e.target_id AND e.kind='issue'
WHERE e.workspace_id=$1 AND i.author_id=$2 AND e.actor_id<>$2 AND e.action IN ('triage','resolve','reopen')
UNION ALL
SELECT 'review:'||e.id,'feedback',f.id,NULL::uuid,CASE WHEN f.rating='helpful' THEN '답변 의견' ELSE '답변 수정 요청' END,e.action,e.note,e.created_at
FROM review_event e JOIN chat_feedback f ON f.id=e.target_id AND e.kind='feedback'
WHERE e.workspace_id=$1 AND f.author_id=$2 AND e.actor_id<>$2 AND e.action IN ('triage','resolve','reopen')`;

type Notification = {
  key: string;
  kind: "source" | "wiki" | "batch" | "rfp" | "issue" | "feedback";
  target_id: string;
  version_id: string | null;
  title: string;
  action: string;
  note: string;
  created_at: Date;
  unread: boolean;
};
function destination(
  w: string,
  item: Pick<Notification, "kind" | "target_id" | "version_id">,
) {
  const base = `/w/${w}`;
  if (item.kind === "issue" || item.kind === "feedback")
    return `${base}/issues#${item.kind}-${item.target_id}`;
  const path = {
    source: "sources",
    wiki: "wiki",
    batch: "proposals",
    rfp: "tools/rfp",
  }[item.kind];
  return `${base}/${path}/${item.target_id}${item.version_id ? `?version=${item.version_id}` : ""}`;
}
async function unreadCount(w: string, userId: string, role: string) {
  const result = await getPool().query(
    `WITH notifications AS (${notificationsSql}) SELECT count(*)::int AS count FROM notifications n WHERE NOT EXISTS(SELECT 1 FROM activity_read r WHERE r.workspace_id=$1 AND r.user_id=$2 AND r.notification_key=n.key)`,
    [w, userId, role],
  );
  return result.rows[0].count as number;
}
export async function activitySummary(h: Headers, w: string) {
  const c = await requireWorkspace(h, w);
  const [unread, reviews] = await Promise.all([
    unreadCount(w, c.user.id, c.role),
    c.role === "reviewer"
      ? reviewCounts(w, c.user.id)
      : { pending: 0, assigned: 0 },
  ]);
  return { unread, reviews };
}
export async function myActivity(h: Headers, w: string, input: unknown = {}) {
  const c = await requireWorkspace(h, w);
  const filter = pageInput
    .extend({ unread: z.enum(["true", "false"]).optional() })
    .parse(input);
  const values = [w, c.user.id, c.role, filter.unread === "true"];
  const query = `WITH notifications AS (${notificationsSql}), visible AS (SELECT n.*,r.notification_key IS NULL AS unread FROM notifications n LEFT JOIN activity_read r ON r.workspace_id=$1 AND r.user_id=$2 AND r.notification_key=n.key) `;
  const [items, total, summary, drafts] = await Promise.all([
    getPool().query<Notification>(
      `${query} SELECT * FROM visible WHERE NOT $4::boolean OR unread ORDER BY created_at DESC,key LIMIT $5 OFFSET $6`,
      [...values, filter.pageSize, (filter.page - 1) * filter.pageSize],
    ),
    getPool().query(
      `${query} SELECT count(*)::int AS count FROM visible WHERE NOT $4::boolean OR unread`,
      values,
    ),
    activitySummary(h, w),
    isWriter(c)
      ? getPool().query<{
          kind: Notification["kind"];
          target_id: string;
          version_id: string | null;
          title: string;
          state: string;
          updated_at: Date;
        }>(
          `
      SELECT * FROM (
      SELECT 'source' AS kind,s.id AS target_id,v.id AS version_id,s.title,v.publication::text AS state,v.updated_at FROM source s JOIN source_version v ON v.id=s.latest_version_id WHERE s.workspace_id=$1 AND s.created_by=$2 AND v.publication IN ('pending','rejected')
      UNION ALL SELECT 'wiki',p.id,v.id,v.title,v.state::text,v.created_at FROM wiki_page p JOIN wiki_version v ON v.id=p.latest_version_id WHERE p.workspace_id=$1 AND v.author_id=$2 AND v.state IN ('draft','submitted','rejected')
      UNION ALL SELECT 'batch',id,NULL::uuid,title,state,updated_at FROM change_batch WHERE workspace_id=$1 AND author_id=$2 AND state IN ('draft','submitted','rejected') AND ${latestBatchCondition}
      UNION ALL SELECT 'rfp',r.id,v.id,v.title,v.state,v.created_at FROM rfp_report r JOIN rfp_version v ON v.id=r.latest_version_id WHERE r.workspace_id=$1 AND v.author_id=$2 AND v.state IN ('draft','submitted','rejected')
      ) d ORDER BY updated_at DESC,target_id LIMIT 20`,
          [w, c.user.id],
        )
      : { rows: [] },
  ]);
  return {
    ...summary,
    canWrite: isWriter(c),
    notifications: pageResult(
      items.rows.map((item) => ({ ...item, href: destination(w, item) })),
      total.rows[0].count,
      { page: filter.page, pageSize: filter.pageSize },
    ),
    drafts: drafts.rows.map((item) => ({
      ...item,
      href: destination(w, item),
    })),
  };
}
export async function markActivityRead(h: Headers, w: string, input: unknown) {
  const c = await requireWorkspace(h, w);
  const data = z
    .object({
      keys: z
        .array(z.string().regex(/^(decision|batch|rfp|review):[0-9a-f-]{36}$/))
        .min(1)
        .max(100),
    })
    .strict()
    .parse(input);
  const keys = [...new Set(data.keys)];
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const found = await db.query(
      `WITH notifications AS (${notificationsSql}) SELECT key FROM notifications WHERE key=ANY($4::text[])`,
      [w, c.user.id, c.role, keys],
    );
    if (found.rows.length !== keys.length)
      throw new AccessError(404, "본인의 처리 결과만 확인할 수 있습니다.");
    await db.query(
      `INSERT INTO activity_read(workspace_id,user_id,notification_key) SELECT $1,$2,unnest($3::text[]) ON CONFLICT DO NOTHING`,
      [w, c.user.id, keys],
    );
    await db.query("COMMIT");
    return { saved: true };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
