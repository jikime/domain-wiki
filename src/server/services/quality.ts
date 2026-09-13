import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { domainKnowledgeRules } from "@/lib/domain-purpose";
import {
  QUALITY_VERSION,
  type QualityCandidate,
  type QualitySnapshot,
  type QualityStepInput,
  qualityPlan,
  structuralConfigSchema,
} from "@/lib/quality";
import { wikiLinksFromMarkdown } from "@/lib/wiki-links";
import { AccessError, requireWorkspace } from "@/server/access";
import { modelProfile } from "@/server/ai/client";
import { getPool } from "@/server/db";
import { checkScope, parseId, requireReviewer } from "./content-access";
export type QualityRun = {
  id: string;
  workspace_id: string;
  domain_id: string;
  project_id: string | null;
  author_id: string;
  mode: "structural" | "semantic";
  origin: string;
  basis_hash: string;
  snapshot: QualitySnapshot;
  state: string;
  lease_token: string | null;
  coverage: Record<string, unknown>;
  completed_steps: number;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
};
export type QualityFinding = {
  id: string;
  domain_id: string;
  project_id: string | null;
  kind: string;
  mode: string;
  severity: string;
  title: string;
  note: string;
  page_ids: string[];
  quotes: QualityCandidate["quotes"];
  purpose_question: string | null;
  target_id: string | null;
  suggestion: NonNullable<QualityCandidate["suggestion"]>;
  state: string;
  resolution: string;
  run_id: string;
  basis_hash: string;
  occurrences: number;
  present: boolean;
  created_at: Date;
  updated_at: Date;
};
export const qualityScopeSchema = z.object({
  domainId: z.uuid(),
  projectId: z.uuid().nullable().default(null),
});
export async function qualitySnapshot(
  db: Pick<PoolClient, "query">,
  w: string,
  d: string,
  p: string | null,
) {
  const domain = await db.query(
    `SELECT name,purpose,purpose_guide AS "purposeGuide",purpose_markdown AS "purposeMarkdown",schema_markdown AS "schemaMarkdown",terms,record_template AS "recordTemplate" FROM domain WHERE workspace_id=$1 AND id=$2`,
    [w, d],
  );
  if (!domain.rowCount)
    throw new AccessError(404, "도메인을 찾을 수 없습니다.");
  const rows = await db.query<QualitySnapshot["pages"][number]>(
    `SELECT p.id,v.id AS "versionId",p.latest_version_id AS "latestVersionId",p.domain_id AS "domainId",p.project_id AS "projectId",v.title,v.body,v.state,v.metadata,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'versionId',sv.id,'chunkId',c.id,'title',s.title,'locator',c.locator,'current',source_is_current(sv.id)) ORDER BY c.id)
      FROM wiki_evidence e JOIN source_chunk c ON c.id=e.chunk_id JOIN source_version sv ON sv.id=c.version_id JOIN source s ON s.id=sv.source_id WHERE e.workspace_id=$1 AND e.version_id=v.id),'[]'::jsonb) AS evidence
    FROM wiki_page p JOIN wiki_version v ON v.id=p.published_version_id WHERE p.workspace_id=$1 AND p.domain_id=$2 AND ($3::uuid IS NULL OR p.project_id IS NULL OR p.project_id=$3) ORDER BY p.id LIMIT 1001`,
    [w, d, p],
  );
  if (
    rows.rows.length > 1000 ||
    rows.rows.reduce((n, p) => n + p.body.length, 0) > 8000000
  )
    throw new AccessError(
      413,
      "품질 점검은 1,000개 페이지·본문 800만 자까지 가능합니다. 프로젝트 범위를 좁혀 주세요.",
    );
  // Existence outside the selected scope prevents false broken-link reports; identifiers are not returned to the UI/model.
  const known = await db.query<{ id: string }>(
    "SELECT id FROM wiki_page WHERE workspace_id=$1 AND published_version_id IS NOT NULL AND id=ANY($2::uuid[]) ORDER BY id",
    [
      w,
      [...new Set(rows.rows.flatMap((p) => wikiLinksFromMarkdown(p.body, w)))],
    ],
  );
  const config = await db.query(
    "SELECT structural_config FROM quality_policy WHERE workspace_id=$1 AND domain_id=$2",
    [w, d],
  );
  const snapshot: QualitySnapshot = {
    structuralConfig: structuralConfigSchema.parse(
      config.rows[0]?.structural_config ?? {},
    ),
    pages: rows.rows,
    knownPageIds: known.rows.map((x) => x.id),
    rules: domainKnowledgeRules(domain.rows[0]),
  };
  const hash = createHash("sha256")
    .update(
      JSON.stringify([
        QUALITY_VERSION,
        w,
        d,
        p,
        snapshot,
        modelProfile("knowledge").identity,
      ]),
    )
    .digest("hex");
  return { snapshot, hash };
}
export async function qualityAuthor(
  db: Pick<PoolClient, "query">,
  w: string,
  id: string,
) {
  const result = await db.query(
    "SELECT 1 FROM membership m JOIN app_user u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.is_active AND (m.is_admin OR m.role='reviewer')",
    [w, id],
  );
  if (!result.rowCount)
    throw new AccessError(
      403,
      "점검을 요청한 직원의 검토 권한이 바뀌었습니다.",
    );
}
export async function enqueueQuality(
  db: PoolClient,
  w: string,
  author: string,
  input: {
    domainId: string;
    projectId: string | null;
    mode: "structural" | "semantic";
    requestId: string;
    force?: boolean;
  },
  origin = "manual",
) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,14))", [
    `${w}:${input.domainId}:${input.projectId ?? "*"}`,
  ]);
  await qualityAuthor(db, w, author);
  const replay = await db.query<QualityRun>(
    "SELECT * FROM quality_run WHERE workspace_id=$1 AND author_id=$2 AND request_id=$3",
    [w, author, input.requestId],
  );
  if (replay.rows[0]) {
    const r = replay.rows[0];
    if (
      r.domain_id !== input.domainId ||
      r.project_id !== input.projectId ||
      r.mode !== input.mode
    )
      throw new AccessError(409, "같은 요청 ID의 점검 범위가 다릅니다.");
    return { run: r, replay: true };
  }
  const { snapshot, hash } = await qualitySnapshot(
    db,
    w,
    input.domainId,
    input.projectId,
  );
  const prior = await db.query<QualityRun>(
    `SELECT * FROM quality_run WHERE workspace_id=$1 AND domain_id=$2 AND project_id IS NOT DISTINCT FROM $3::uuid AND mode=$4 AND (state IN ('queued','running') OR ($6=false AND basis_hash=$5 AND state='completed')) ORDER BY created_at DESC LIMIT 1`,
    [
      w,
      input.domainId,
      input.projectId,
      input.mode,
      hash,
      input.force ?? false,
    ],
  );
  if (prior.rows[0]) return { run: prior.rows[0], replay: true };
  let plan: { steps: QualityStepInput[]; coverage: Record<string, unknown> } = {
    steps: [],
    coverage: { pages: snapshot.pages.length },
  };
  if (input.mode === "semantic") {
    const profile = modelProfile("knowledge");
    if (!profile.configured)
      throw new AccessError(503, "지식 정리 모델 연결을 먼저 설정해 주세요.");
    try {
      plan = qualityPlan(w, snapshot, profile.contextChars);
    } catch (e) {
      throw new AccessError(
        413,
        e instanceof Error ? e.message : "점검 범위를 확인해 주세요.",
      );
    }
  }
  const result = await db.query<QualityRun>(
    `INSERT INTO quality_run(workspace_id,domain_id,project_id,author_id,request_id,mode,origin,basis_hash,snapshot,coverage) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) RETURNING *`,
    [
      w,
      input.domainId,
      input.projectId,
      author,
      input.requestId,
      input.mode,
      origin,
      hash,
      JSON.stringify(snapshot),
      JSON.stringify(plan.coverage),
    ],
  );
  for (const [ordinal, step] of plan.steps.entries())
    await db.query(
      "INSERT INTO quality_step(workspace_id,run_id,ordinal,input) VALUES($1,$2,$3,$4::jsonb)",
      [w, result.rows[0].id, ordinal, JSON.stringify(step)],
    );
  return { run: result.rows[0], replay: false };
}
export async function createQuality(h: Headers, w: string, input: unknown) {
  const c = await requireWorkspace(h, w);
  requireReviewer(c);
  const data = qualityScopeSchema
    .extend({
      mode: z.enum(["structural", "semantic"]).default("structural"),
      requestId: z.uuid(),
      force: z.boolean().default(false),
    })
    .strict()
    .parse(input);
  await checkScope(w, data.domainId, data.projectId);
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const r = await enqueueQuality(db, w, c.user.id, data);
    await db.query("COMMIT");
    return { id: r.run.id, state: r.run.state, replay: r.replay };
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function qualityOverview(h: Headers, w: string, input: unknown) {
  const c = await requireWorkspace(h, w);
  requireReviewer(c);
  const scope = qualityScopeSchema.parse(input);
  await checkScope(w, scope.domainId, scope.projectId);
  const current = await qualitySnapshot(
    getPool(),
    w,
    scope.domainId,
    scope.projectId,
  );
  const [runs, findings, policy] = await Promise.all([
    getPool().query<QualityRun>(
      "SELECT id,mode,origin,state,coverage,completed_steps,error_message,basis_hash,created_at,updated_at FROM quality_run WHERE workspace_id=$1 AND domain_id=$2 AND project_id IS NOT DISTINCT FROM $3::uuid ORDER BY created_at DESC LIMIT 30",
      [w, scope.domainId, scope.projectId],
    ),
    getPool().query<QualityFinding & { assignee_name: string | null }>(
      `SELECT f.*,u.name AS assignee_name FROM quality_finding f LEFT JOIN review_assignment a ON a.workspace_id=f.workspace_id AND a.kind='quality' AND a.target_id=f.id LEFT JOIN membership m ON m.workspace_id=a.workspace_id AND m.user_id=a.assignee_id AND m.is_active AND (m.is_admin OR m.role='reviewer') LEFT JOIN app_user u ON u.id=m.user_id WHERE f.workspace_id=$1 AND f.domain_id=$2 AND f.project_id IS NOT DISTINCT FROM $3::uuid ORDER BY (f.state='resolved'),CASE f.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,f.updated_at DESC LIMIT 500`,
      [w, scope.domainId, scope.projectId],
    ),
    getPool().query(
      "SELECT mode,interval_days,after_revision,next_run_at,structural_config FROM quality_policy WHERE workspace_id=$1 AND domain_id=$2",
      [w, scope.domainId],
    ),
  ]);
  return {
    scope,
    pages: current.snapshot.pages.map(({ id, versionId, title, evidence }) => ({
      id,
      versionId,
      title,
      evidence,
    })),
    rules: current.snapshot.rules,
    runs: runs.rows.map((r) => ({
      ...r,
      current: r.basis_hash === current.hash,
    })),
    findings: findings.rows.map((f) => ({
      ...f,
      current: f.basis_hash === current.hash,
    })),
    policy: policy.rows[0] ?? {
      mode: "structural",
      interval_days: 0,
      after_revision: false,
      structural_config: structuralConfigSchema.parse({}),
    },
    isAdmin: c.isAdmin,
  };
}
export async function qualityRunAction(
  h: Headers,
  w: string,
  id: string,
  input: unknown,
) {
  const c = await requireWorkspace(h, w);
  requireReviewer(c);
  parseId(id);
  const { action } = z
    .object({ action: z.literal("cancel") })
    .strict()
    .parse(input);
  const result = await getPool().query(
    "UPDATE quality_run SET state='canceled',lease_token=NULL,error_message='직원이 점검을 중지했습니다.',updated_at=now() WHERE workspace_id=$1 AND id=$2 AND state IN ('queued','running') RETURNING id",
    [w, id],
  );
  if (!result.rowCount)
    throw new AccessError(409, "진행 중인 점검을 선택해 주세요.");
  return { id, action };
}
export async function saveQualityPolicy(h: Headers, w: string, input: unknown) {
  const c = await requireWorkspace(h, w);
  requireReviewer(c);
  const data = z
    .object({
      domainId: z.uuid(),
      mode: z.enum(["structural", "semantic"]),
      intervalDays: z.number().int().min(0).max(30),
      afterRevision: z.boolean(),
      structuralConfig: structuralConfigSchema.optional(),
    })
    .strict()
    .parse(input);
  await checkScope(w, data.domainId, null);
  const { hash } = await qualitySnapshot(getPool(), w, data.domainId, null);
  await getPool().query(
    `INSERT INTO quality_policy(workspace_id,domain_id,author_id,mode,interval_days,after_revision,last_basis_hash,next_run_at,structural_config) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5>0 THEN now()+make_interval(days=>$5) ELSE NULL END,COALESCE($8::jsonb,(SELECT structural_config FROM quality_policy WHERE workspace_id=$1 AND domain_id=$2),'{"ignoreOrphan":false,"ignoreNoOutlinks":false,"ignorePages":[]}')) ON CONFLICT(workspace_id,domain_id) DO UPDATE SET author_id=excluded.author_id,mode=excluded.mode,interval_days=excluded.interval_days,after_revision=excluded.after_revision,last_basis_hash=excluded.last_basis_hash,next_run_at=excluded.next_run_at,structural_config=excluded.structural_config,updated_at=now()`,
    [
      w,
      data.domainId,
      c.user.id,
      data.mode,
      data.intervalDays,
      data.afterRevision,
      hash,
      data.structuralConfig ? JSON.stringify(data.structuralConfig) : null,
    ],
  );
  await getPool().query(
    "INSERT INTO review_event(workspace_id,kind,target_id,actor_id,action,note) VALUES($1,'quality-policy',$2,$3,'policy',$4)",
    [
      w,
      data.domainId,
      c.user.id,
      `정기 ${data.intervalDays}일 · 개정 후 ${data.afterRevision ? "사용" : "중지"} · ${data.mode === "semantic" ? "AI 의미" : "구조"} 점검`,
    ],
  );
  return { saved: true };
}
export async function saveQualityFindings(
  db: PoolClient,
  run: QualityRun,
  candidates: QualityCandidate[],
) {
  const groups = new Map<string, QualityCandidate>();
  for (const candidate of candidates) {
    const previous = groups.get(candidate.key);
    if (!previous) {
      groups.set(candidate.key, { ...candidate });
      continue;
    }
    previous.note = [...new Set([previous.note, candidate.note])].join("\n\n");
    previous.quotes = [
      ...new Map(
        [...previous.quotes, ...candidate.quotes].map((q) => [
          `${q.pageId}:${q.start}:${q.quote}`,
          q,
        ]),
      ).values(),
    ];
    if (
      candidate.severity === "error" ||
      (candidate.severity === "warning" && previous.severity === "info")
    )
      previous.severity = candidate.severity;
  }
  const unique = [...groups.values()];
  const scopeKey = `${run.domain_id}:${run.project_id ?? "*"}`;
  for (const f of unique) {
    const previous = await db.query<QualityFinding>(
      "SELECT * FROM quality_finding WHERE workspace_id=$1 AND scope_key=$2 AND finding_key=$3 FOR UPDATE",
      [run.workspace_id, scopeKey, f.key],
    );
    const old = previous.rows[0];
    const state = old?.state === "resolved" ? "open" : (old?.state ?? "open");
    const result = await db.query<{ id: string }>(
      `INSERT INTO quality_finding(workspace_id,domain_id,project_id,scope_key,finding_key,mode,kind,severity,title,note,page_ids,quotes,purpose_question,target_id,state,run_id,basis_hash,suggestion) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18::jsonb) ON CONFLICT(workspace_id,scope_key,finding_key) DO UPDATE SET present=true,severity=excluded.severity,title=excluded.title,note=excluded.note,page_ids=excluded.page_ids,quotes=excluded.quotes,purpose_question=excluded.purpose_question,suggestion=excluded.suggestion,state=excluded.state,run_id=excluded.run_id,basis_hash=excluded.basis_hash,occurrences=quality_finding.occurrences+CASE WHEN quality_finding.state='resolved' THEN 1 ELSE 0 END,updated_at=now(),last_seen_at=now() RETURNING id`,
      [
        run.workspace_id,
        run.domain_id,
        run.project_id,
        scopeKey,
        f.key,
        run.mode,
        f.kind,
        f.severity,
        f.title,
        f.note,
        JSON.stringify(f.pageIds),
        JSON.stringify(f.quotes),
        f.purposeQuestion ?? null,
        f.targetId ?? null,
        state,
        run.id,
        run.basis_hash,
        JSON.stringify(f.suggestion ?? {}),
      ],
    );
    if (!old || old.state === "resolved" || old.basis_hash !== run.basis_hash)
      await db.query(
        "INSERT INTO review_event(workspace_id,kind,target_id,actor_id,action,note) VALUES($1,'quality',$2,$3,$4,$5)",
        [
          run.workspace_id,
          result.rows[0].id,
          run.author_id,
          !old
            ? "detected"
            : old.state === "resolved"
              ? "recurred"
              : "rechecked",
          `점검 ${run.id} · ${!old ? "새 후보" : old.state === "resolved" ? "해결 후 다시 발견" : "개정 후 다시 확인"}`,
        ],
      );
  }
  if (run.mode === "structural") {
    const resolved = await db.query<{ id: string }>(
      "UPDATE quality_finding SET present=false,state='resolved',resolution='구조 재점검에서 문제가 더 이상 발견되지 않았습니다.',basis_hash=$4,run_id=$5,updated_at=now() WHERE workspace_id=$1 AND scope_key=$2 AND mode='structural' AND state<>'resolved' AND NOT(finding_key=ANY($3::text[])) RETURNING id",
      [
        run.workspace_id,
        scopeKey,
        unique.map((f) => f.key),
        run.basis_hash,
        run.id,
      ],
    );
    for (const f of resolved.rows)
      await db.query(
        "INSERT INTO review_event(workspace_id,kind,target_id,actor_id,action,note) VALUES($1,'quality',$2,$3,'auto-resolved','구조 재점검에서 문제가 사라졌습니다.')",
        [run.workspace_id, f.id, run.author_id],
      );
  } else {
    const unseen = await db.query<{ id: string }>(
      "UPDATE quality_finding SET present=false,basis_hash=$4,run_id=$5,updated_at=now() WHERE workspace_id=$1 AND scope_key=$2 AND mode='semantic' AND NOT(finding_key=ANY($3::text[])) RETURNING id",
      [
        run.workspace_id,
        scopeKey,
        unique.map((f) => f.key),
        run.basis_hash,
        run.id,
      ],
    );
    for (const f of unseen.rows)
      await db.query(
        "INSERT INTO review_event(workspace_id,kind,target_id,actor_id,action,note) VALUES($1,'quality',$2,$3,'not-reproduced','이번 AI 점검에서 재발견되지 않았습니다. 이전 비교 구절은 보존하며 해결 여부는 직원이 검토합니다.')",
        [run.workspace_id, f.id, run.author_id],
      );
  }
}
