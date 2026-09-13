import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AccessError, requireWorkspace } from "@/server/access";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import {
  account,
  membership,
  operationsEvent,
  passwordRecovery,
  session,
  user,
} from "@/server/db/schema";
import { getServerEnv } from "@/server/env";
import type { QueryDb } from "./wiki";

const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
async function recoveryAuthority(
  db: QueryDb,
  workspaceId: string,
  userId: string,
  adminId: string,
) {
  const [active] = await db
    .select({ id: membership.userId })
    .from(membership)
    .where(
      and(
        eq(membership.workspaceId, workspaceId),
        eq(membership.userId, userId),
        eq(membership.isActive, true),
      ),
    );
  if (!active)
    throw new AccessError(404, "이용 중인 직원 계정을 찾을 수 없습니다.");
  const result = await db.execute(
    sql`SELECT 1 FROM membership target WHERE target.user_id=${userId} AND target.is_active AND NOT EXISTS (SELECT 1 FROM membership actor WHERE actor.workspace_id=target.workspace_id AND actor.user_id=${adminId} AND actor.is_active AND actor.is_admin) LIMIT 1`,
  );
  if (result.rows.length)
    throw new AccessError(
      403,
      "이 계정이 이용하는 모든 작업공간의 관리자만 복구 링크를 발급할 수 있습니다.",
    );
}
export async function issuePasswordRecovery(
  headers: Headers,
  workspaceId: string,
  input: unknown,
) {
  const context = await requireWorkspace(headers, workspaceId, true);
  const data = z
    .object({
      userId: z.string().min(1).max(128),
      adminPassword: z.string().min(1).max(128),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(input);
  const verified = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`recovery-check:${context.user.id}`}, 0))`,
    );
    const failed = await tx.execute(
      sql`SELECT count(*)::int AS count FROM operations_event WHERE actor_id=${context.user.id} AND action='password-recovery-denied' AND created_at > now()-interval '15 minutes'`,
    );
    if (Number(failed.rows[0]?.count) >= 5)
      throw new AccessError(
        429,
        "비밀번호 확인을 여러 번 실패했습니다. 15분 뒤 다시 시도해 주세요.",
      );
    try {
      await getAuth().api.verifyPassword({
        headers,
        body: { password: data.adminPassword },
      });
      return true;
    } catch {
      await tx.insert(operationsEvent).values({
        workspaceId,
        actorId: context.user.id,
        action: "password-recovery-denied",
        counts: { attempts: 1 },
      });
      return false;
    }
  });
  if (!verified) {
    throw new AccessError(
      403,
      "관리자 비밀번호를 확인해 주세요. 오래된 로그인은 다시 로그인한 뒤 진행해 주세요.",
    );
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  await getDb().transaction(async (tx) => {
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, data.userId))
      .for("update");
    await recoveryAuthority(tx, workspaceId, data.userId, context.user.id);
    await tx
      .update(passwordRecovery)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordRecovery.userId, data.userId),
          isNull(passwordRecovery.usedAt),
        ),
      );
    await tx.insert(passwordRecovery).values({
      tokenHash: digest(token),
      workspaceId,
      userId: data.userId,
      issuedBy: context.user.id,
      expiresAt,
    });
    await tx.insert(operationsEvent).values({
      workspaceId,
      actorId: context.user.id,
      action: "password-recovery-issued",
      counts: { links: 1 },
    });
  });
  return {
    url: `${new URL(getServerEnv().BETTER_AUTH_URL).origin}/reset-password#token=${token}`,
    expiresAt,
  };
}
export async function resetRecoveredPassword(input: unknown) {
  const data = z
    .object({
      token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      newPassword: z.string().min(12).max(128),
    })
    .strict()
    .parse(input);
  await getDb().transaction(async (tx) => {
    const tokenHash = digest(data.token);
    const [candidate] = await tx
      .select()
      .from(passwordRecovery)
      .where(eq(passwordRecovery.tokenHash, tokenHash));
    if (!candidate)
      throw new AccessError(
        400,
        "복구 링크가 만료되었거나 이미 사용되었습니다. 관리자에게 새 링크를 요청해 주세요.",
      );
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, candidate.userId))
      .for("update");
    const [recovery] = await tx
      .select()
      .from(passwordRecovery)
      .where(eq(passwordRecovery.tokenHash, tokenHash))
      .for("update");
    if (!recovery || recovery.usedAt || recovery.expiresAt <= new Date())
      throw new AccessError(
        400,
        "복구 링크가 만료되었거나 이미 사용되었습니다. 관리자에게 새 링크를 요청해 주세요.",
      );
    await recoveryAuthority(
      tx,
      recovery.workspaceId,
      recovery.userId,
      recovery.issuedBy,
    );
    const changed = await tx
      .update(account)
      .set({ password: await hashPassword(data.newPassword) })
      .where(
        and(
          eq(account.userId, recovery.userId),
          eq(account.providerId, "credential"),
        ),
      )
      .returning({ id: account.id });
    if (!changed.length)
      throw new AccessError(400, "비밀번호 계정을 찾을 수 없습니다.");
    await tx
      .update(passwordRecovery)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordRecovery.userId, recovery.userId),
          isNull(passwordRecovery.usedAt),
        ),
      );
    await tx.delete(session).where(eq(session.userId, recovery.userId));
    await tx.insert(operationsEvent).values({
      workspaceId: recovery.workspaceId,
      actorId: recovery.userId,
      action: "password-recovery-completed",
      counts: { accounts: 1 },
    });
  });
  return { success: true };
}
