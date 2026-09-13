import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { requireWorkspace } from "@/server/access";
import { getDb } from "@/server/db";
import {
  changeBatch,
  chatFeedback,
  source,
  sourceVersion,
  wikiPage,
  wikiVersion,
} from "@/server/db/schema";
import { requireReviewer } from "./content-access";
import { latestBatchSql } from "./generation-batches";
export async function reviewQueue(
  requestHeaders: Headers,
  workspaceId: string,
) {
  const context = await requireWorkspace(requestHeaders, workspaceId);
  requireReviewer(context);
  const [sources, wikis, feedback, batches] = await Promise.all([
    getDb()
      .select({
        id: source.id,
        title: source.title,
        versionId: sourceVersion.id,
        number: sourceVersion.number,
        processing: sourceVersion.processing,
        own: eq(sourceVersion.uploadedBy, context.user.id),
      })
      .from(sourceVersion)
      .innerJoin(source, eq(source.id, sourceVersion.sourceId))
      .where(
        and(
          eq(source.workspaceId, workspaceId),
          eq(sourceVersion.publication, "pending"),
          eq(source.latestVersionId, sourceVersion.id),
        ),
      )
      .orderBy(desc(sourceVersion.createdAt))
      .limit(100),
    getDb()
      .select({
        id: wikiPage.id,
        title: wikiVersion.title,
        versionId: wikiVersion.id,
        number: wikiVersion.number,
        own: eq(wikiVersion.authorId, context.user.id),
      })
      .from(wikiVersion)
      .innerJoin(wikiPage, eq(wikiPage.id, wikiVersion.pageId))
      .where(
        and(
          eq(wikiPage.workspaceId, workspaceId),
          eq(wikiVersion.state, "submitted"),
          eq(wikiPage.latestVersionId, wikiVersion.id),
        ),
      )
      .orderBy(desc(wikiVersion.createdAt))
      .limit(100),
    getDb()
      .select({
        id: chatFeedback.id,
        rating: chatFeedback.rating,
        note: chatFeedback.note,
        state: chatFeedback.state,
        createdAt: chatFeedback.createdAt,
      })
      .from(chatFeedback)
      .where(
        and(
          eq(chatFeedback.workspaceId, workspaceId),
          eq(chatFeedback.state, "open"),
        ),
      )
      .orderBy(desc(chatFeedback.createdAt))
      .limit(100),
    getDb()
      .select({
        id: changeBatch.id,
        title: changeBatch.title,
        createdAt: changeBatch.createdAt,
      })
      .from(changeBatch)
      .where(
        and(
          eq(changeBatch.workspaceId, workspaceId),
          eq(changeBatch.state, "submitted"),
          latestBatchSql,
        ),
      )
      .orderBy(desc(changeBatch.createdAt))
      .limit(100),
  ]);
  return { sources, wikis, feedback, batches };
}
