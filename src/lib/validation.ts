import { z } from "zod";
import { purposeGuideSchema } from "./domain-purpose";
import { highestRole, type WorkRole } from "./permissions";
export const roleLabels = {
  reader: "이용 직원",
  writer: "작성 직원",
  reviewer: "검토 직원",
} as const;
export const domainInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    purpose: z.string().trim().min(1).max(3000),
    purposeGuide: purposeGuideSchema.optional(),
    purposeMarkdown: z.string().max(40000).optional(),
    schemaMarkdown: z.string().max(40000).optional(),
    overviewMarkdown: z.string().max(40000).optional(),
    autoIngest: z.boolean().optional(),
    terms: z
      .array(
        z
          .object({
            term: z.string().trim().min(1).max(100),
            definition: z.string().trim().min(1).max(1000),
            aliases: z
              .array(z.string().trim().min(2).max(80))
              .max(10)
              .optional(),
          })
          .strict(),
      )
      .max(100),
    recordTemplate: z.string().trim().min(1).max(5000),
  })
  .strict();
export const projectInput = z
  .object({
    domainId: z.uuid(),
    name: z.string().trim().min(1).max(150),
    clientName: z.string().trim().min(1).max(150),
    description: z.string().trim().max(3000),
  })
  .strict();
const memberRoles = {
  role: z.enum(["reader", "writer", "reviewer"]).optional(),
  roles: z
    .array(z.enum(["reader", "writer", "reviewer"]))
    .min(1)
    .max(3)
    .refine((roles) => new Set(roles).size === roles.length)
    .optional(),
};
function normalizeMember<T extends { role?: WorkRole; roles?: WorkRole[] }>(
  data: T,
  ctx: z.RefinementCtx,
) {
  if (
    (!data.role && !data.roles) ||
    (data.role && data.roles && data.role !== highestRole(data.roles))
  ) {
    ctx.addIssue({ code: "custom", message: "업무 권한을 확인해 주세요." });
    return z.NEVER;
  }
  const { roles, role, ...rest } = data;
  return { ...rest, role: roles ? highestRole(roles) : (role as WorkRole) };
}
export const memberInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(128),
    ...memberRoles,
    isAdmin: z.boolean(),
  })
  .strict()
  .transform(normalizeMember);
export const memberUpdate = z
  .object({
    ...memberRoles,
    isAdmin: z.boolean(),
    isActive: z.boolean(),
  })
  .strict()
  .transform(normalizeMember);
