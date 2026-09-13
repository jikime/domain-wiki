import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { account, membership, user } from "../src/server/db/schema";

loadEnvConfig(process.cwd());
async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("개발용 계정 준비 절차입니다.");
  const { getDb, getPool } = await import("../src/server/db");
  try {
    if (existsSync(".local/content-accounts.json")) {
      console.log("기존 개발 작성·검토 계정 정보를 유지합니다.");
      return;
    }
    const [admin] = await getDb()
      .select({ workspaceId: membership.workspaceId })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(
        and(
          eq(user.email, "admin@wiki.local"),
          eq(membership.isAdmin, true),
          eq(membership.isActive, true),
        ),
      )
      .limit(1);
    if (!admin) throw new Error("먼저 db:bootstrap을 실행하세요.");
    const accounts = ["writer", "reviewer"].map((role) => ({
      id: randomUUID(),
      email: `${role}@wiki.local`,
      name: role === "writer" ? "개발 작성 직원" : "개발 검토 직원",
      password: randomBytes(18).toString("base64url"),
      role: role as "writer" | "reviewer",
    }));
    const hashes = await Promise.all(
      accounts.map((item) => hashPassword(item.password)),
    );
    mkdirSync(".local", { recursive: true, mode: 0o700 });
    writeFileSync(
      ".local/content-accounts.json",
      JSON.stringify(
        {
          notice: "개발용 계정. 외부 공유·커밋 금지.",
          workspaceId: admin.workspaceId,
          accounts,
        },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
    try {
      await getDb().transaction(async (tx) => {
        for (let i = 0; i < accounts.length; i++) {
          const item = accounts[i];
          await tx
            .insert(user)
            .values({ id: item.id, name: item.name, email: item.email });
          await tx.insert(account).values({
            id: randomUUID(),
            accountId: item.id,
            providerId: "credential",
            userId: item.id,
            password: hashes[i],
          });
          await tx.insert(membership).values({
            workspaceId: admin.workspaceId,
            userId: item.id,
            role: item.role,
          });
        }
      });
    } catch (error) {
      rmSync(".local/content-accounts.json", { force: true });
      throw error;
    }
    console.log("작성·검토 계정 생성 완료: .local/content-accounts.json");
  } finally {
    await getPool().end();
  }
}
main().catch(() => {
  console.error("계정 준비 실패: 초기 관리자와 기존 이메일을 확인하세요.");
  process.exitCode = 1;
});
