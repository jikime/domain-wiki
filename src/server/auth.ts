import "server-only";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./db";
import * as schema from "./db/schema";
import { getServerEnv } from "./env";

function createAuth() {
  const env = getServerEnv();
  return betterAuth({
    appName: "우리 업무 위키",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema,
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 60 * 60 * 24,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: { "/sign-in/email": { window: 60, max: 10 } },
    },
    databaseHooks: {
      account: {
        update: {
          after: async (updatedAccount) => {
            if (
              updatedAccount.providerId === "credential" &&
              updatedAccount.password
            ) {
              await getDb()
                .update(schema.passwordRecovery)
                .set({ usedAt: new Date() })
                .where(
                  and(
                    eq(schema.passwordRecovery.userId, updatedAccount.userId),
                    isNull(schema.passwordRecovery.usedAt),
                  ),
                );
            }
          },
        },
      },
      session: {
        create: {
          before: async (newSession) => {
            const active = await getDb()
              .select({ userId: schema.membership.userId })
              .from(schema.membership)
              .where(
                and(
                  eq(schema.membership.userId, newSession.userId),
                  eq(schema.membership.isActive, true),
                ),
              )
              .limit(1);
            if (!active.length)
              throw new APIError("FORBIDDEN", {
                message:
                  "이용 가능한 작업공간이 없습니다. 관리자에게 문의하세요.",
              });
          },
        },
      },
    },
  });
}
let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  auth ??= createAuth();
  return auth;
}
