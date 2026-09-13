import "server-only";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { includedRoles } from "@/lib/permissions";
import {
  domainInput,
  memberInput,
  memberUpdate,
  projectInput,
} from "@/lib/validation";
import { AccessError, requireWorkspace } from "@/server/access";
import { getDb } from "@/server/db";
import {
  account,
  domain,
  membership,
  project,
  session,
  user,
  workspace,
} from "@/server/db/schema";

export async function workspaceData(
  requestHeaders: Headers,
  workspaceId: string,
) {
  await requireWorkspace(requestHeaders, workspaceId);
  const [domains, projects] = await Promise.all([
    getDb()
      .select()
      .from(domain)
      .where(eq(domain.workspaceId, workspaceId))
      .orderBy(domain.createdAt),
    getDb()
      .select()
      .from(project)
      .where(eq(project.workspaceId, workspaceId))
      .orderBy(project.createdAt),
  ]);
  return { domains, projects };
}
export async function saveDomain(
  requestHeaders: Headers,
  workspaceId: string,
  input: unknown,
  id?: string,
) {
  await requireWorkspace(requestHeaders, workspaceId, true);
  const data = domainInput.parse(input);
  if (id) {
    z.uuid().parse(id);
    const [saved] = await getDb()
      .update(domain)
      .set(data)
      .where(and(eq(domain.id, id), eq(domain.workspaceId, workspaceId)))
      .returning();
    if (!saved) throw new AccessError(404, "도메인을 찾을 수 없습니다.");
    return saved;
  }
  const [saved] = await getDb()
    .insert(domain)
    .values({ ...data, workspaceId })
    .returning();
  return saved;
}
export async function saveProject(
  requestHeaders: Headers,
  workspaceId: string,
  input: unknown,
  id?: string,
) {
  await requireWorkspace(requestHeaders, workspaceId, true);
  const data = projectInput.parse(input);
  const [parent] = await getDb()
    .select({ id: domain.id })
    .from(domain)
    .where(
      and(eq(domain.id, data.domainId), eq(domain.workspaceId, workspaceId)),
    );
  if (!parent) throw new AccessError(404, "도메인을 찾을 수 없습니다.");
  if (id) {
    z.uuid().parse(id);
    const [saved] = await getDb()
      .update(project)
      .set(data)
      .where(and(eq(project.id, id), eq(project.workspaceId, workspaceId)))
      .returning();
    if (!saved) throw new AccessError(404, "프로젝트를 찾을 수 없습니다.");
    return saved;
  }
  const [saved] = await getDb()
    .insert(project)
    .values({ ...data, workspaceId })
    .returning();
  return saved;
}
export async function listMembers(
  requestHeaders: Headers,
  workspaceId: string,
) {
  await requireWorkspace(requestHeaders, workspaceId, true);
  const rows = await getDb()
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: membership.role,
      isAdmin: membership.isAdmin,
      isActive: membership.isActive,
    })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(eq(membership.workspaceId, workspaceId))
    .orderBy(membership.createdAt);
  return rows.map((row) => ({
    ...row,
    roles: includedRoles(row.role, row.isAdmin),
    assignedRoles: includedRoles(row.role),
  }));
}
export async function createMember(
  requestHeaders: Headers,
  workspaceId: string,
  input: unknown,
) {
  await requireWorkspace(requestHeaders, workspaceId, true);
  const data = memberInput.parse(input);
  const password = await hashPassword(data.password);
  const id = randomUUID();
  await getDb().transaction(async (tx) => {
    await tx.insert(user).values({ id, email: data.email, name: data.name });
    await tx.insert(account).values({
      id: randomUUID(),
      userId: id,
      providerId: "credential",
      accountId: id,
      password,
    });
    await tx.insert(membership).values({
      workspaceId,
      userId: id,
      role: data.role,
      isAdmin: data.isAdmin,
    });
  });
  return { id, name: data.name, email: data.email };
}
export async function updateMember(
  requestHeaders: Headers,
  workspaceId: string,
  id: string,
  input: unknown,
) {
  const context = await requireWorkspace(requestHeaders, workspaceId, true);
  const data = memberUpdate.parse(input);
  if (id === context.user.id && (!data.isAdmin || !data.isActive))
    throw new AccessError(
      409,
      "본인의 관리자 권한이나 이용 상태는 다른 관리자가 변경해야 합니다.",
    );
  await getDb().transaction(async (tx) => {
    // Serialize administrator changes so concurrent requests cannot remove every administrator.
    await tx
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .for("update");
    const [caller] = await tx
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.workspaceId, workspaceId),
          eq(membership.userId, context.user.id),
        ),
      );
    if (!caller?.isActive || !caller.isAdmin)
      throw new AccessError(403, "관리자 권한이 필요합니다.");
    const [target] = await tx
      .select()
      .from(membership)
      .where(
        and(eq(membership.workspaceId, workspaceId), eq(membership.userId, id)),
      );
    if (!target) throw new AccessError(404, "직원을 찾을 수 없습니다.");
    const admins = await tx
      .select({ id: membership.userId })
      .from(membership)
      .where(
        and(
          eq(membership.workspaceId, workspaceId),
          eq(membership.isAdmin, true),
          eq(membership.isActive, true),
        ),
      );
    if (
      target.isActive &&
      target.isAdmin &&
      (!data.isAdmin || !data.isActive) &&
      admins.length <= 1
    )
      throw new AccessError(
        409,
        "작업공간에는 활성 관리자가 한 명 이상 필요합니다.",
      );
    await tx
      .update(membership)
      .set(data)
      .where(
        and(eq(membership.workspaceId, workspaceId), eq(membership.userId, id)),
      );
    if (!data.isActive) await tx.delete(session).where(eq(session.userId, id));
  });
  return { id, ...data };
}
