import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import {
  account,
  domain,
  membership,
  project,
  user,
  workspace,
} from "../src/server/db/schema";

loadEnvConfig(process.cwd());

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("개발용 초기 계정은 운영 환경에서 생성할 수 없습니다.");
  const { getDb, getPool } = await import("../src/server/db");
  try {
    const existing = await getDb()
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "admin@wiki.local"));
    if (existing.length) {
      console.log(
        "초기 계정이 이미 있습니다. 기존 데이터와 비밀번호를 유지합니다.",
      );
      return;
    }
    const workspaceId = randomUUID();
    const domainId = randomUUID();
    const accounts = [
      {
        id: randomUUID(),
        email: "admin@wiki.local",
        name: "개발 관리자",
        password: randomBytes(18).toString("base64url"),
        role: "reader" as const,
        isAdmin: true,
      },
      {
        id: randomUUID(),
        email: "reader@wiki.local",
        name: "개발 이용 직원",
        password: randomBytes(18).toString("base64url"),
        role: "reader" as const,
        isAdmin: false,
      },
    ];
    const hashes = await Promise.all(
      accounts.map((item) => hashPassword(item.password)),
    );
    mkdirSync(".local", { recursive: true, mode: 0o700 });
    writeFileSync(
      ".local/initial-accounts.json",
      JSON.stringify(
        {
          notice: "로컬 개발 전용. 외부 공유·커밋 금지.",
          workspaceId,
          accounts,
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    try {
      await getDb().transaction(async (tx) => {
        await tx
          .insert(workspace)
          .values({ id: workspaceId, name: "우리 업무 위키 · 개발 공간" });
        for (let i = 0; i < accounts.length; i++) {
          const item = accounts[i];
          await tx
            .insert(user)
            .values({ id: item.id, email: item.email, name: item.name });
          await tx.insert(account).values({
            id: randomUUID(),
            userId: item.id,
            providerId: "credential",
            accountId: item.id,
            password: hashes[i],
          });
          await tx.insert(membership).values({
            workspaceId,
            userId: item.id,
            role: item.role,
            isAdmin: item.isAdmin,
          });
        }
        await tx.insert(domain).values({
          id: domainId,
          workspaceId,
          name: "교통관제 업무 (개발 예시)",
          purpose:
            "교통관제 업무의 용어와 프로젝트 경험을 함께 정리하는 개발용 도메인입니다. 실제 고객 규정이나 운영 지침이 아닙니다.",
          terms: [
            {
              term: "ITS",
              definition: "지능형 교통체계. 개발 표본에서 사용하는 약어입니다.",
            },
            {
              term: "검수",
              definition:
                "개발 표본에서 정한 점검 항목의 충족 여부를 확인하는 과정입니다.",
            },
          ],
        });
        await tx.insert(project).values({
          workspaceId,
          domainId,
          name: "가상 새봄시 관제 시범사업",
          clientName: "가상 새봄시",
          description:
            "권한과 프로젝트 범위를 확인하기 위한 가상의 사업입니다. 실제 사업 정보가 아닙니다.",
        });
      });
    } catch (error) {
      rmSync(".local/initial-accounts.json", { force: true });
      throw error;
    }
    console.log(
      "개발 작업공간과 계정 2개 생성 완료. 로그인 정보: .local/initial-accounts.json",
    );
  } finally {
    await getPool().end();
  }
}
main().catch(() => {
  console.error(
    "초기화 실패: DB 연결·마이그레이션·기존 계정 파일을 확인하세요.",
  );
  process.exitCode = 1;
});
