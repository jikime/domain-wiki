import "server-only";
import { and, eq } from "drizzle-orm";
import { domainKnowledgeRules } from "@/lib/domain-purpose";
import { domain } from "@/server/db/schema";
import { AccessError } from "@/server/errors";
import type { QueryDb } from "@/server/services/wiki";
import { hashValue } from "./task-context";

export async function readDomainContext(
  db: QueryDb,
  workspaceId: string,
  domainId: string,
  lock = false,
) {
  const query = db
    .select()
    .from(domain)
    .where(and(eq(domain.workspaceId, workspaceId), eq(domain.id, domainId)));
  const [value] = await (lock ? query.for("share") : query);
  if (!value) throw new AccessError(404, "도메인을 찾을 수 없습니다.");
  const rules = domainKnowledgeRules(value);
  return { rules, rulesHash: hashValue(rules) };
}
