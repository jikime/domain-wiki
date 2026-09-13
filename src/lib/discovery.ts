import { z } from "zod";
export const guideInput = z
  .object({
    steps: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(120),
            description: z.string().trim().max(1000),
            wikiId: z.uuid().nullable(),
          })
          .strict(),
      )
      .max(8),
    readingIds: z
      .array(z.uuid())
      .max(12)
      .refine((ids) => ids.length === new Set(ids).size),
  })
  .strict();
