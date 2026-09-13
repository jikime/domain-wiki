import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { requireWorkspace } from "@/server/access";
import { getDb } from "@/server/db";
import { source, sourceChunk, sourceVersion } from "@/server/db/schema";
import { checkScope, requireWriter } from "./content-access";

export async function draftEvidence(
  headers: Headers,
  workspaceId: string,
  input: unknown,
) {
  requireWriter(await requireWorkspace(headers, workspaceId));
  const data = z
    .object({
      domainId: z.uuid(),
      projectId: z.uuid().optional(),
      ids: z
        .string()
        .max(6000)
        .transform((s) => [...new Set(s.split(",").filter(Boolean))])
        .pipe(z.array(z.uuid()).max(150)),
    })
    .parse(input);
  await checkScope(workspaceId, data.domainId, data.projectId ?? null);
  if (!data.ids.length) return [];
  const rows = await getDb()
    .select({
      id: sourceChunk.id,
      text: sourceChunk.text,
      locator: sourceChunk.locator,
      sourceId: source.id,
      title: source.title,
      category: source.category,
      versionId: sourceVersion.id,
      versionNumber: sourceVersion.number,
      domainId: source.domainId,
      projectId: source.projectId,
    })
    .from(sourceChunk)
    .innerJoin(sourceVersion, eq(sourceVersion.id, sourceChunk.versionId))
    .innerJoin(source, eq(source.id, sourceVersion.sourceId))
    .where(
      and(
        eq(source.workspaceId, workspaceId),
        eq(source.domainId, data.domainId),
        data.projectId
          ? or(eq(source.projectId, data.projectId), isNull(source.projectId))
          : isNull(source.projectId),
        inArray(sourceChunk.id, data.ids),
        eq(source.publishedVersionId, sourceVersion.id),
        sql`source_is_current(${sourceVersion.id})`,
      ),
    );
  return rows;
}
