import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { effectiveRole, includedRoles } from "@/lib/permissions";
import { getDb } from "./db";
import { membership, user, workspace } from "./db/schema";

export { AccessError } from "./errors";

import { AccessError } from "./errors";
export async function requireUser(requestHeaders: Headers) {
  // Background workers reuse DB validation services without handling sessions.
  // Load the authentication SDK when an HTTP request actually needs it.
  const { getAuth } = await import("./auth");
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) throw new AccessError(401, "로그인이 필요합니다.");
  return session.user;
}
export async function requireWorkspace(
  requestHeaders: Headers,
  workspaceId: string,
  admin = false,
) {
  const currentUser = await requireUser(requestHeaders);
  if (!z.uuid().safeParse(workspaceId).success)
    throw new AccessError(404, "작업공간을 찾을 수 없습니다.");
  const [member] = await getDb()
    .select({
      role: membership.role,
      isAdmin: membership.isAdmin,
      workspaceName: workspace.name,
    })
    .from(membership)
    .innerJoin(workspace, eq(workspace.id, membership.workspaceId))
    .where(
      and(
        eq(membership.workspaceId, workspaceId),
        eq(membership.userId, currentUser.id),
        eq(membership.isActive, true),
      ),
    );
  if (!member) throw new AccessError(404, "작업공간을 찾을 수 없습니다.");
  if (admin && !member.isAdmin)
    throw new AccessError(403, "관리자 권한이 필요합니다.");
  return {
    ...member,
    assignedRole: member.role,
    role: effectiveRole(member.role, member.isAdmin),
    roles: includedRoles(member.role, member.isAdmin),
    user: currentUser,
    workspaceId,
  };
}
export async function myWorkspaces(requestHeaders: Headers) {
  const currentUser = await requireUser(requestHeaders);
  return getDb()
    .select({ id: workspace.id, name: workspace.name })
    .from(workspace)
    .innerJoin(membership, eq(membership.workspaceId, workspace.id))
    .innerJoin(user, eq(user.id, membership.userId))
    .where(and(eq(user.id, currentUser.id), eq(membership.isActive, true)))
    .orderBy(workspace.createdAt);
}
