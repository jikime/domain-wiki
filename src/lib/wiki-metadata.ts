import { z } from "zod";
import { parseWikiSchemaRouting } from "./reference/wiki-schema";
export const wikiTypeLabels: Record<string, string> = {
  source: "문서 요약",
  entity: "대상·인물·조직",
  concept: "개념·기준",
  procedure: "절차",
  case: "사례",
  synthesis: "통합 정리",
  query: "확인할 질문",
  other: "일반 지식",
  comparison: "비교",
  thesis: "가설",
  methodology: "방법론",
  finding: "발견",
  overview: "개요",
};
export const wikiTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_-]*$/);
export function wikiTypesForSchema(schema = "") {
  return {
    ...wikiTypeLabels,
    ...Object.fromEntries(
      Object.keys(parseWikiSchemaRouting(schema).typeDirs).map((type) => [
        type,
        wikiTypeLabels[type] ?? type,
      ]),
    ),
  };
}
export const wikiMetadataSchema = z
  .object({
    type: wikiTypeSchema,
    aliases: z.array(z.string().trim().min(1).max(100)).max(20),
    path: z
      .string()
      .max(500)
      .regex(/^wiki\/(?!.*(?:^|\/)\.\.?\/)[^\\]+\.md$/)
      .optional(),
    frontmatter: z
      .record(z.string(), z.union([z.string(), z.array(z.string())]))
      .optional(),
    links: z
      .array(
        z
          .object({
            pageId: z.uuid(),
            reason: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export type WikiMetadata = z.infer<typeof wikiMetadataSchema>;
export const emptyWikiMetadata: WikiMetadata = {
  type: "other",
  aliases: [],
  links: [],
};
