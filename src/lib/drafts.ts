import { z } from "zod";
import type { SourceLocator } from "@/server/db/schema";
import { rfpSectionInput } from "./business";
import { proposalItemInput } from "./proposals";
import { wikiTypeSchema } from "./wiki-metadata";

const scope = {
  domainId: z.string(),
  projectId: z.string(),
  title: z.string().max(160),
};
const ids = z.array(z.uuid()).max(30);
const text = z.string().max(5000);
const evidence = z.object({
  kind: z.enum(["source", "wiki"]),
  category: z.string().optional(),
  id: z.uuid(),
  versionId: z.uuid(),
  title: z.string(),
  excerpt: z.string(),
  domainId: z.uuid(),
  projectId: z.uuid().nullable(),
  href: z.string().startsWith("/w/"),
  chunkId: z.uuid().optional(),
  locator: z
    .custom<SourceLocator>(
      (value) =>
        !!value &&
        typeof value === "object" &&
        "kind" in value &&
        [
          "lines",
          "pdf",
          "html",
          "docx",
          "pptx",
          "spreadsheet",
          "document",
          "image",
        ].includes(String(value.kind)),
    )
    .optional(),
});
export const wikiDraft = z.object({
  ...scope,
  // An oversized rich-editor paste remains recoverable while the employee
  // reduces it to the server's 40,000-character save limit.
  body: z.string().max(200000),
  evidence: z.array(evidence).max(30),
  wikiType: wikiTypeSchema.default("other"),
  aliases: z.string().max(2100).default(""),
});
export const recordDraft = z.object({
  ...scope,
  rawNote: z.string().max(12000),
  fields: z.object({
    situation: text,
    reasoning: text,
    result: text,
    followUp: text,
  }),
  chunkIds: ids,
});
export const proposalDraft = z.object({
  ...scope,
  items: z.array(
    z.object({
      ...proposalItemInput.shape,
      title: z.string().max(160),
      body: z.string().max(20000),
      reason: z.string().max(2000),
      chunkIds: ids,
      editorKey: z.string(),
    }),
  ),
});
export const rfpDraft = z.object({
  title: z.string().max(160),
  rows: z
    .array(
      rfpSectionInput.extend({
        title: z.string().max(160),
        meaning: z.string().max(4000),
        questions: z.array(z.string().max(1000)).max(8),
        key: z.string(),
        query: z.string(),
      }),
    )
    .max(30),
  aiSelected: ids,
  focus: z.string().max(2000),
});
