import "server-only";
import { and, eq } from "drizzle-orm";
import { searchGroups } from "@/lib/search-terms";
import { getDb } from "@/server/db";
import { domain } from "@/server/db/schema";
export async function workspaceSearchGroups(
  w: string,
  d: string | null | undefined,
  q: string,
  natural = false,
) {
  const rows = await getDb()
    .select({ terms: domain.terms })
    .from(domain)
    .where(and(eq(domain.workspaceId, w), d ? eq(domain.id, d) : undefined));
  return searchGroups(
    q,
    rows.flatMap((r) => r.terms),
    natural,
  );
}
