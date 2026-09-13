import "server-only";
import { and, eq, type SQLWrapper, sql } from "drizzle-orm";
import { z } from "zod";
import { AccessError, type requireWorkspace } from "@/server/access";
import { getDb } from "@/server/db";
import {
  domain,
  project,
  source,
  sourceChunk,
  sourceVersion,
  wikiEvidence,
} from "@/server/db/schema";
export type ContentContext = Awaited<ReturnType<typeof requireWorkspace>>;
export function isWriter(context: ContentContext) {
  return context.role === "writer" || context.role === "reviewer";
}
export function requireWriter(context: ContentContext) {
  if (!isWriter(context))
    throw new AccessError(403, "작성 직원 권한이 필요합니다.");
}
export function requireReviewer(context: ContentContext) {
  if (context.role !== "reviewer")
    throw new AccessError(403, "검토 직원 권한이 필요합니다.");
}
export function mayManage(context: ContentContext, authorId: string) {
  return (
    context.role === "reviewer" ||
    (isWriter(context) && context.user.id === authorId)
  );
}
export function parseId(id: string) {
  if (!z.uuid().safeParse(id).success)
    throw new AccessError(404, "자료를 찾을 수 없습니다.");
  return id;
}
export async function checkScope(
  workspaceId: string,
  domainId: string,
  projectId: string | null,
) {
  const [parent] = await getDb()
    .select({ id: domain.id })
    .from(domain)
    .where(and(eq(domain.id, domainId), eq(domain.workspaceId, workspaceId)));
  if (!parent) throw new AccessError(404, "도메인을 찾을 수 없습니다.");
  if (projectId) {
    const [item] = await getDb()
      .select({ id: project.id })
      .from(project)
      .where(
        and(
          eq(project.id, projectId),
          eq(project.domainId, domainId),
          eq(project.workspaceId, workspaceId),
        ),
      );
    if (!item) throw new AccessError(404, "프로젝트를 찾을 수 없습니다.");
  }
}
// Used by wiki listing, details and search; current source visibility is rechecked each time.
export function validEvidenceSql(versionId: SQLWrapper) {
  return sql`NOT EXISTS (SELECT 1 FROM ${wikiEvidence} e JOIN ${sourceChunk} c ON c.id=e.chunk_id JOIN ${sourceVersion} v ON v.id=c.version_id JOIN ${source} s ON s.id=v.source_id WHERE e.version_id=${versionId} AND (s.published_version_id IS DISTINCT FROM v.id OR v.publication <> 'published' OR v.processing <> 'completed' OR NOT source_is_current(v.id)))`;
}
