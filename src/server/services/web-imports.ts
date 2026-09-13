import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireWorkspace } from "@/server/access";
import { htmlDocument } from "@/server/parsers/html";
import {
  fetchPublicDocument,
  publicDocumentUrl,
} from "@/server/web/fetch-document";
import { requireWriter } from "./content-access";
import { importRecord } from "./source-imports";
import { registerSourceFile } from "./sources";
export async function importWebSource(
  request: Request,
  w: string,
  input: unknown,
) {
  const context = await requireWorkspace(request.headers, w);
  requireWriter(context);
  const data = z
    .object({
      importId: z.uuid(),
      url: z.string().max(2000),
      title: z.string().trim().min(1).max(160).optional(),
    })
    .strict()
    .parse(input);
  const collection = await importRecord(context, data.importId);
  const requested = publicDocumentUrl(data.url).href;
  const document = await fetchPublicDocument(requested, request.signal);
  const parsed =
    document.contentType === "text/html"
      ? htmlDocument(document.bytes, document.url)
      : undefined;
  const title =
    data.title ??
    (parsed?.title || new URL(document.url).hostname).slice(0, 160);
  const key = createHash("sha256").update(requested).digest("hex");
  const result = await registerSourceFile(
    context,
    new File([new Uint8Array(document.bytes)], document.filename),
    {
      title,
      domainId: collection.domainId,
      projectId: collection.projectId,
      category: collection.category,
    },
    {
      importId: collection.id,
      relativePath: `web/${key}/${document.filename}`,
      originUrl: document.url,
    },
  );
  return { ...result, title, url: document.url };
}
