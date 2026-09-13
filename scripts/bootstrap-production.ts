import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, getPool } from "../src/server/db";
import { account, membership, user, workspace } from "../src/server/db/schema";

async function main() {
  let body = "";
  for await (const chunk of process.stdin) {
    body += chunk;
    if (body.length > 4096) throw new Error("초기 계정 입력 크기 초과");
  }
  const input = z
    .object({
      email: z.email(),
      name: z.string().min(1).max(100),
      password: z.string().min(16).max(128),
      workspaceName: z.string().min(1).max(100),
    })
    .strict()
    .parse(JSON.parse(body));
  const password = await hashPassword(input.password);
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(728109)`);
    if ((await tx.select({ id: workspace.id }).from(workspace).limit(1)).length)
      throw new Error("기존 작업공간이 있어 초기 계정을 만들 수 없습니다.");
    const userId = randomUUID();
    const workspaceId = randomUUID();
    await tx
      .insert(user)
      .values({ id: userId, email: input.email, name: input.name });
    await tx.insert(account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password,
    });
    await tx
      .insert(workspace)
      .values({ id: workspaceId, name: input.workspaceName });
    await tx
      .insert(membership)
      .values({ workspaceId, userId, role: "reader", isAdmin: true });
    console.log(JSON.stringify({ workspaceId, userId }));
  });
}
main()
  .catch(() => {
    console.error(
      "초기 관리자 생성 실패: 입력 정보와 기존 작업공간을 확인하세요.",
    );
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
