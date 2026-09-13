import { z } from "zod";
export const selectionScopeSchema = z
  .object({
    domainId: z.uuid(),
    projectId: z.uuid().nullable(),
    pageId: z.uuid().nullable(),
    versionId: z.uuid().nullable(),
    latestVersionId: z.uuid().nullable(),
  })
  .strict();
export type SelectionScope = z.infer<typeof selectionScopeSchema>;
export const selectionInputSchema = z
  .object({
    action: z.enum(["generate", "validate"]).default("generate"),
    requestId: z.uuid(),
    scope: selectionScopeSchema,
    intent: z.enum(["ask", "edit"]),
    instruction: z.string().trim().min(1).max(4000),
    body: z.string().max(40000).optional(),
    selection: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        selectedText: z.string().min(1).max(40000),
        sourceMapped: z.boolean(),
      })
      .strict(),
    history: z
      .array(
        z
          .object({
            id: z.uuid(),
            question: z.string().max(4000),
            answer: z.string().max(6000),
          })
          .strict(),
      )
      .max(6)
      .default([]),
  })
  .strict();
export type SelectionInput = z.infer<typeof selectionInputSchema>;
export type SelectionReference = {
  key: string;
  title: string;
  href: string;
  text: string;
};
export type SelectionTurn = {
  id: string;
  question: string;
  answer: string;
  references: SelectionReference[];
  linkDestinations?: Record<string, string>;
};
