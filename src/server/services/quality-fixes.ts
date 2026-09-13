import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { type QualityFixChange, qualityFixInput } from "@/lib/quality-actions";
import { parseFrontmatter } from "@/lib/reference/frontmatter";
import {
  appendWikilink,
  ensureBrokenLinkStub,
  rewriteWikilinkTarget,
} from "@/lib/reference/lint-fixes";
import { metadataFromMarkdown } from "@/lib/wiki-links";
import { emptyWikiMetadata } from "@/lib/wiki-metadata";
import {
  buildWikiReferenceIndex,
  normalizeWikiReference,
} from "@/lib/wiki-reference-index";
import { AccessError, requireWorkspace } from "@/server/access";
import { getPool } from "@/server/db";
import { checkScope, requireReviewer } from "./content-access";
import { type QualityFinding, qualityAuthor, qualitySnapshot } from "./quality";
import { checkEvidence } from "./wiki";

async function plan(
  db: Pick<PoolClient, "query">,
  w: string,
  data: ReturnType<typeof qualityFixInput.parse>,
) {
  const current = await qualitySnapshot(db, w, data.domainId, data.projectId);
  const result = await db.query<QualityFinding>(
    "SELECT * FROM quality_finding WHERE workspace_id=$1 AND domain_id=$2 AND project_id IS NOT DISTINCT FROM $3::uuid AND id=ANY($4::uuid[]) ORDER BY id",
    [w, data.domainId, data.projectId, data.findingIds],
  );
  if (result.rowCount !== data.findingIds.length)
    throw new AccessError(404, "선택한 점검 항목을 찾을 수 없습니다.");
  // Include unpublished paths when checking collisions; never overwrite another draft.
  const paths = await db.query<{
    id: string;
    project_id: string | null;
    path: string | null;
  }>(
    "SELECT p.id,p.project_id,v.metadata->>'path' AS path FROM wiki_page p JOIN wiki_version v ON v.id=p.latest_version_id WHERE p.workspace_id=$1 AND p.domain_id=$2 ORDER BY p.id",
    [w, data.domainId],
  );
  const pages = new Map(current.snapshot.pages.map((page) => [page.id, page]));
  const edits = new Map<string, QualityFixChange>();
  const pagePath = (id: string) =>
    pages.get(id)?.metadata?.path ?? `wiki/${id}.md`;
  for (const f of result.rows) {
    if (
      f.state === "resolved" ||
      !f.present ||
      f.basis_hash !== current.hash ||
      f.mode !== "structural"
    )
      throw new AccessError(
        409,
        "현재 자료로 구조 점검을 다시 실행한 뒤 수정할 항목을 선택해 주세요.",
      );
    const sourceId =
      f.kind === "orphan" ? f.suggestion.sourceId : f.page_ids[0];
    const source = sourceId ? pages.get(sourceId) : undefined;
    if (!source)
      throw new AccessError(409, "이 항목은 본문에서 직접 검토해 주세요.");
    if (source.latestVersionId !== source.versionId)
      throw new AccessError(
        409,
        `${source.title}: 저장된 초안을 먼저 검토해 주세요.`,
      );
    if (source.evidence.some((e) => !e.current))
      throw new AccessError(
        409,
        `${source.title}: 변경된 근거를 먼저 확인해 주세요.`,
      );
    let targetId = f.kind === "orphan" ? f.page_ids[0] : f.suggestion.targetId;
    let targetPath = targetId ? pagePath(targetId) : "";
    if (f.kind === "broken-link" && !targetId && f.suggestion.brokenTarget) {
      let stubBody = "";
      const stub = await ensureBrokenLinkStub("", f.suggestion.brokenTarget, {
        async fileExists(path) {
          const matches = paths.rows.filter(
            (p) =>
              (p.project_id === null || p.project_id === source.projectId) &&
              normalizeWikiReference(p.path ?? `wiki/${p.id}.md`) ===
                normalizeWikiReference(path),
          );
          if (matches.length > 1)
            throw new AccessError(
              409,
              "같은 경로의 문서가 여러 개입니다. 연결 대상을 직접 선택해 주세요.",
            );
          if (matches[0]) {
            if (!pages.has(matches[0].id))
              throw new AccessError(
                409,
                "연결 대상 경로에 게시 전 초안이 있습니다. 해당 초안을 먼저 검토해 주세요.",
              );
            targetId = matches[0].id;
          }
          return !!matches.length;
        },
        async createDirectory() {},
        async writeFile(_path, content) {
          stubBody = content;
        },
      });
      targetPath = `wiki/${stub.relativePath}`;
      if (stub.created) {
        const key = `${source.projectId ?? "common"}:${targetPath}`;
        if (!edits.has(key))
          edits.set(key, {
            pageId: null,
            title: String(
              parseFrontmatter(stubBody).frontmatter?.title ?? "새 문서",
            ),
            path: targetPath,
            projectId: source.projectId,
            before: "",
            after: stubBody,
          });
      }
    }
    if (targetId) {
      const target = pages.get(targetId);
      if (
        !target ||
        (target.projectId !== null && target.projectId !== source.projectId)
      )
        throw new AccessError(
          409,
          "제안된 연결이 문서의 프로젝트 범위를 벗어납니다. 연결 대상을 직접 확인해 주세요.",
        );
    }
    if (
      !targetPath ||
      !["broken-link", "orphan", "no-outlinks"].includes(f.kind)
    )
      throw new AccessError(409, "이 항목은 본문에서 직접 검토해 주세요.");
    const edit = edits.get(source.id) ?? {
      pageId: source.id,
      title: source.title,
      path: pagePath(source.id),
      projectId: source.projectId,
      before: source.body,
      after: source.body,
    };
    const next =
      f.kind === "broken-link"
        ? rewriteWikilinkTarget(
            edit.after,
            f.suggestion.brokenTarget ?? "",
            targetPath,
          )
        : appendWikilink(edit.after, targetPath);
    if (next === edit.after && edit.before === edit.after)
      throw new AccessError(
        409,
        "자동으로 수정할 위키 연결을 찾지 못했습니다. 본문을 직접 확인해 주세요.",
      );
    if (next.length > 40000)
      throw new AccessError(
        413,
        "수정 후 본문이 편집 가능한 40,000자를 넘습니다.",
      );
    edit.after = next;
    edits.set(source.id, edit);
  }
  const changes = [...edits.values()].filter(
    (edit) => edit.before !== edit.after,
  );
  if (
    changes.some(
      (change) => change.title.length > 160 || change.path.length > 500,
    )
  )
    throw new AccessError(
      413,
      "새 문서의 제목은 160자, 경로는 500자 이내로 정리해 주세요.",
    );
  const basis = createHash("sha256")
    .update(
      JSON.stringify([
        current.hash,
        paths.rows,
        result.rows.map((f) => [f.id, f.updated_at]),
        changes,
      ]),
    )
    .digest("hex");
  return { changes, basis, snapshot: current.snapshot };
}

export async function fixQuality(headers: Headers, w: string, input: unknown) {
  const context = await requireWorkspace(headers, w);
  requireReviewer(context);
  const data = qualityFixInput.parse(input);
  await checkScope(w, data.domainId, data.projectId);
  if (data.action === "preview") {
    const { changes, basis } = await plan(getPool(), w, data);
    return { changes, basis };
  }
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "SELECT user_id FROM membership WHERE workspace_id=$1 AND user_id=$2 FOR SHARE",
      [w, context.user.id],
    );
    await qualityAuthor(db, w, context.user.id);
    // A short write transaction protects paths, current versions and all grouped edits together.
    await db.query("LOCK TABLE wiki_page IN SHARE ROW EXCLUSIVE MODE");
    await db.query(
      "SELECT id FROM quality_finding WHERE workspace_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
      [w, data.findingIds],
    );
    const proposal = await plan(db, w, data);
    if (proposal.basis !== data.basis)
      throw new AccessError(
        409,
        "미리보기 이후 자료나 검토 상태가 바뀌었습니다. 수정 내용을 다시 확인해 주세요.",
      );
    const pages = proposal.snapshot.pages;
    const assigned = proposal.changes.map((change) => ({
      ...change,
      pageId: change.pageId ?? randomUUID(),
      versionId: randomUUID(),
    }));
    const drafts = [];
    for (const change of assigned) {
      const previous = pages.find((p) => p.id === change.pageId);
      const chunkIds = [
        ...new Set(previous?.evidence.map((e) => e.chunkId) ?? []),
      ];
      await checkEvidence(
        drizzle(db),
        w,
        data.domainId,
        change.projectId,
        chunkIds,
        true,
      );
      if (!previous)
        await db.query(
          "INSERT INTO wiki_page(id,workspace_id,domain_id,project_id,created_by) VALUES($1,$2,$3,$4,$5)",
          [change.pageId, w, data.domainId, change.projectId, context.user.id],
        );
      const row = await db.query<{ version_count: number }>(
        "SELECT version_count FROM wiki_page WHERE workspace_id=$1 AND id=$2",
        [w, change.pageId],
      );
      const metadata = metadataFromMarkdown(
        change.after,
        w,
        change.pageId,
        { ...(previous?.metadata ?? emptyWikiMetadata), path: change.path },
        buildWikiReferenceIndex([
          ...pages.filter(
            (p) => p.projectId === null || p.projectId === change.projectId,
          ),
          ...assigned
            .filter(
              (p) => p.projectId === null || p.projectId === change.projectId,
            )
            .map((p) => ({
              id: p.pageId,
              title: p.title,
              metadata: { path: p.path },
            })),
        ]),
      );
      await db.query(
        "INSERT INTO wiki_version(id,workspace_id,page_id,number,title,body,metadata,base_published_version_id,author_id) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)",
        [
          change.versionId,
          w,
          change.pageId,
          row.rows[0].version_count + 1,
          change.title,
          change.after,
          JSON.stringify(metadata),
          previous?.versionId ?? null,
          context.user.id,
        ],
      );
      for (const chunkId of chunkIds)
        await db.query(
          "INSERT INTO wiki_evidence(workspace_id,version_id,chunk_id) VALUES($1,$2,$3)",
          [w, change.versionId, chunkId],
        );
      await db.query(
        "UPDATE wiki_page SET latest_version_id=$3,version_count=version_count+1 WHERE workspace_id=$1 AND id=$2",
        [w, change.pageId, change.versionId],
      );
      drafts.push({
        pageId: change.pageId,
        versionId: change.versionId,
        title: change.title,
        newStub: !previous,
      });
    }
    for (const id of data.findingIds)
      await db.query(
        "INSERT INTO review_event(workspace_id,kind,target_id,actor_id,action,note) VALUES($1,'quality',$2,$3,'fix-draft',$4)",
        [
          w,
          id,
          context.user.id,
          `연결 수정 초안 ${drafts.map((d) => d.pageId).join(", ")} · 게시 검토 후 다시 점검해 주세요.`,
        ],
      );
    await db.query("COMMIT");
    return { drafts };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
