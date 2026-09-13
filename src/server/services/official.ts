import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { calendarDate } from "@/lib/business";
import { AccessError, requireWorkspace } from "@/server/access";
import { getDb } from "@/server/db";
import {
  officialCandidate,
  officialDecision,
  officialSite,
  sourceVersion,
} from "@/server/db/schema";
import {
  fetchOfficial,
  officialUrl,
  withinSite,
} from "@/server/official/fetch";
import { htmlDocument } from "@/server/parsers/html";
import {
  checkScope,
  isWriter,
  mayManage,
  parseId,
  requireReviewer,
  requireWriter,
} from "./content-access";
import { uploadSource } from "./sources";

export async function officialSites(h: Headers, w: string) {
  const c = await requireWorkspace(h, w);
  if (!isWriter(c) && !c.isAdmin)
    throw new AccessError(403, "작성·검토 또는 관리 권한이 필요합니다.");
  return getDb()
    .select()
    .from(officialSite)
    .where(eq(officialSite.workspaceId, w))
    .orderBy(officialSite.name);
}
export async function saveOfficialSite(
  h: Headers,
  w: string,
  input: unknown,
  id?: string,
) {
  const c = await requireWorkspace(h, w, true);
  if (id) {
    const { active } = z.object({ active: z.boolean() }).strict().parse(input);
    const [row] = await getDb()
      .update(officialSite)
      .set({ active, updatedAt: new Date() })
      .where(
        and(eq(officialSite.workspaceId, w), eq(officialSite.id, parseId(id))),
      )
      .returning();
    if (!row) throw new AccessError(404, "등록 사이트를 찾을 수 없습니다.");
    return row;
  }
  const d = z
    .object({
      name: z.string().trim().min(1).max(100),
      url: z.string().max(2000),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(input);
  const url = officialUrl(d.url);
  if (url.search)
    throw new AccessError(400, "허용 경로에는 검색 조건을 넣지 마세요.");
  const [row] = await getDb()
    .insert(officialSite)
    .values({
      workspaceId: w,
      name: d.name,
      origin: url.origin,
      pathPrefix: url.pathname,
      createdBy: c.user.id,
    })
    .returning();
  return row;
}
export async function listOfficial(h: Headers, w: string) {
  const c = await requireWorkspace(h, w);
  requireWriter(c);
  return getDb()
    .select({
      candidate: officialCandidate,
      publisher: officialSite.name,
      sourceId: sourceVersion.sourceId,
      current: sql<boolean>`COALESCE(source_is_current(${officialCandidate.sourceVersionId}),false)`,
    })
    .from(officialCandidate)
    .innerJoin(officialSite, eq(officialSite.id, officialCandidate.siteId))
    .leftJoin(
      sourceVersion,
      eq(sourceVersion.id, officialCandidate.sourceVersionId),
    )
    .where(
      and(
        eq(officialCandidate.workspaceId, w),
        c.role === "reviewer"
          ? undefined
          : or(
              eq(officialCandidate.authorId, c.user.id),
              eq(officialCandidate.state, "verified"),
            ),
      ),
    )
    .orderBy(desc(officialCandidate.createdAt))
    .limit(100);
}
export async function officialDetails(h: Headers, w: string, id: string) {
  const c = await requireWorkspace(h, w);
  requireWriter(c);
  const [item] = await getDb()
    .select({
      candidate: officialCandidate,
      site: officialSite,
      sourceId: sourceVersion.sourceId,
      publication: sourceVersion.publication,
      processing: sourceVersion.processing,
      current: sql<boolean>`COALESCE(source_is_current(${officialCandidate.sourceVersionId}),false)`,
    })
    .from(officialCandidate)
    .innerJoin(officialSite, eq(officialSite.id, officialCandidate.siteId))
    .leftJoin(
      sourceVersion,
      eq(sourceVersion.id, officialCandidate.sourceVersionId),
    )
    .where(
      and(
        eq(officialCandidate.workspaceId, w),
        eq(officialCandidate.id, parseId(id)),
      ),
    );
  if (
    !item ||
    (!mayManage(c, item.candidate.authorId) &&
      item.candidate.state !== "verified")
  )
    throw new AccessError(404, "자료 후보를 찾을 수 없습니다.");
  const decisions = await getDb()
    .select()
    .from(officialDecision)
    .where(eq(officialDecision.candidateId, id))
    .orderBy(officialDecision.createdAt);
  return { ...item, decisions };
}
export async function collectOfficial(
  request: Request,
  w: string,
  input: unknown,
) {
  const c = await requireWorkspace(request.headers, w);
  requireWriter(c);
  const d = z
    .object({
      requestId: z.uuid(),
      url: z.string().max(2000),
      title: z.string().trim().min(1).max(160),
      domainId: z.uuid(),
      projectId: z.uuid().nullable().default(null),
    })
    .strict()
    .parse(input);
  const url = officialUrl(d.url);
  const sites = await officialSites(request.headers, w);
  const site = sites.find((s) => withinSite(url, s));
  if (!site)
    throw new AccessError(
      403,
      "허용한 사이트와 경로에서만 수집할 수 있습니다.",
    );
  await checkScope(w, d.domainId, d.projectId);
  const inputHash = createHash("sha256")
    .update(JSON.stringify(d))
    .digest("hex");
  const started = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${w},8))`,
    );
    const [old] = await tx
      .select()
      .from(officialCandidate)
      .where(
        and(
          eq(officialCandidate.workspaceId, w),
          eq(officialCandidate.authorId, c.user.id),
          eq(officialCandidate.requestId, d.requestId),
        ),
      );
    if (old) {
      if (old.inputHash !== inputHash)
        throw new AccessError(
          409,
          "같은 수집 요청 번호에 다른 내용을 넣을 수 없습니다.",
        );
      return { row: old, replay: true };
    }
    await tx
      .update(officialCandidate)
      .set({
        state: "failed",
        errorMessage: "수집 연결이 종료되었습니다. 새 요청으로 재시도하세요.",
      })
      .where(
        and(
          eq(officialCandidate.workspaceId, w),
          eq(officialCandidate.state, "fetching"),
          sql`${officialCandidate.createdAt} < now()-interval '2 minutes'`,
        ),
      );
    const count = await tx.execute(
      sql`SELECT count(*)::int AS n FROM official_candidate WHERE workspace_id=${w} AND state='fetching'`,
    );
    if (Number(count.rows[0].n) >= 3)
      throw new AccessError(
        429,
        "자료 수집 3건이 진행 중입니다. 완료 후 다시 시도하세요.",
      );
    const [row] = await tx
      .insert(officialCandidate)
      .values({
        workspaceId: w,
        siteId: site.id,
        authorId: c.user.id,
        requestId: d.requestId,
        inputHash,
        url: url.href,
        title: d.title,
        domainId: d.domainId,
        projectId: d.projectId,
      })
      .returning();
    return { row, replay: false };
  });
  if (started.replay)
    return { id: started.row.id, state: started.row.state, replay: true };
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
  try {
    const result = await fetchOfficial(url.href, sites, signal);
    const parsed =
      result.contentType === "text/html"
        ? htmlDocument(result.bytes, result.url)
        : null;
    const currentSites = await officialSites(request.headers, w);
    if (
      !currentSites.find((s) => s.id === site.id && s.active) ||
      !currentSites.some((s) => withinSite(new URL(result.url), s))
    )
      throw new AccessError(409, "수집 중 허용 사이트 설정이 변경되었습니다.");
    signal.throwIfAborted();
    const form = new FormData();
    const title = parsed?.title || d.title;
    form.set("title", title);
    form.set("domainId", d.domainId);
    form.set("projectId", d.projectId ?? "");
    form.set("category", "guideline");
    form.set(
      "file",
      new File([new Uint8Array(result.bytes)], result.filename, {
        type: result.contentType,
      }),
    );
    const headers = new Headers(request.headers);
    headers.delete("content-type");
    headers.delete("content-length");
    const uploaded = await uploadSource(
      new Request(request.url, { method: "POST", headers, body: form }),
      w,
    );
    await getDb()
      .update(officialCandidate)
      .set({
        state: "captured",
        title,
        finalUrl: result.url,
        sourceVersionId: uploaded.versionId,
        sha256: createHash("sha256").update(result.bytes).digest("hex"),
        publishedHint: parsed?.publishedHint ?? null,
        attachments: parsed?.attachments ?? [],
        fetchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(officialCandidate.id, started.row.id));
    return { id: started.row.id, state: "captured", ...uploaded };
  } catch (error) {
    const message =
      error instanceof AccessError
        ? error.message
        : "원문을 수집하지 못했습니다. 연결·형식·제한 시간을 확인하고 새 요청으로 다시 시도하세요.";
    await getDb()
      .update(officialCandidate)
      .set({ state: "failed", errorMessage: message, updatedAt: new Date() })
      .where(eq(officialCandidate.id, started.row.id));
    throw error instanceof AccessError ? error : new AccessError(502, message);
  }
}
export async function reviewOfficial(
  h: Headers,
  w: string,
  id: string,
  input: unknown,
) {
  const c = await requireWorkspace(h, w);
  requireReviewer(c);
  const d = z
    .object({
      action: z.enum(["verify", "reject"]),
      note: z.string().trim().min(5).max(2000),
      confirmed: z.boolean(),
      publishedDate: calendarDate.nullable().default(null),
      effectiveDate: calendarDate.nullable().default(null),
    })
    .strict()
    .parse(input);
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(officialCandidate)
      .where(
        and(
          eq(officialCandidate.workspaceId, w),
          eq(officialCandidate.id, parseId(id)),
        ),
      )
      .for("update");
    if (!row) throw new AccessError(404, "자료 후보를 찾을 수 없습니다.");
    if (row.authorId === c.user.id)
      throw new AccessError(
        409,
        "본인이 수집한 자료는 다른 검토 직원이 확인해야 합니다.",
      );
    if (row.state !== "captured")
      throw new AccessError(
        409,
        "원문을 확보한 확인 대기 후보만 검토할 수 있습니다.",
      );
    if (d.action === "verify") {
      if (!d.confirmed || !row.sourceVersionId)
        throw new AccessError(
          400,
          "원문·기관·날짜·첨부를 직접 대조했는지 확인해 주세요.",
        );
      const found = await tx
        .select({ sourceId: sourceVersion.sourceId })
        .from(sourceVersion)
        .where(eq(sourceVersion.id, row.sourceVersionId));
      if (!found[0]) throw new AccessError(409, "원문 버전이 없습니다.");
      await tx.execute(
        sql`SELECT id FROM source WHERE id=${found[0].sourceId} FOR UPDATE`,
      );
      const valid = await tx.execute(
        sql`SELECT source_is_current(${row.sourceVersionId}::uuid) AS valid`,
      );
      if (!valid.rows[0].valid)
        throw new AccessError(
          409,
          "원본 자료의 공개 검토를 먼저 완료해 주세요. 개정·철회된 원문은 확인할 수 없습니다.",
        );
    }
    const [saved] = await tx
      .update(officialCandidate)
      .set({
        state: d.action === "verify" ? "verified" : "rejected",
        publishedDate: d.publishedDate,
        effectiveDate: d.effectiveDate,
        reviewNote: d.note,
        checkedBy: c.user.id,
        updatedAt: new Date(),
      })
      .where(eq(officialCandidate.id, id))
      .returning();
    await tx.insert(officialDecision).values({
      candidateId: id,
      actorId: c.user.id,
      action: d.action,
      note: d.note,
    });
    return saved;
  });
}
