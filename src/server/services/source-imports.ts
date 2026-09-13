import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { normalizeSourceWatchConfig } from "@/lib/reference/source-watch-config";
import { AccessError, requireWorkspace } from "@/server/access";
import { getDb } from "@/server/db";
import { sourceImport, sourceImportFile } from "@/server/db/schema";
import {
  type ContentContext,
  checkScope,
  mayManage,
  parseId,
  requireWriter,
} from "./content-access";

const rootSchema = z.array(
  z.object({
    key: z.string().regex(/^[a-z0-9_-]{1,60}$/),
    label: z.string().min(1).max(120),
    path: z.string().min(1),
    workspaceId: z.uuid(),
  }),
);
export function configuredImportRoots(workspaceId: string) {
  try {
    return rootSchema
      .parse(JSON.parse(process.env.SOURCE_IMPORT_ROOTS || "[]"))
      .filter((r) => r.workspaceId === workspaceId);
  } catch {
    throw new AccessError(503, "서버 폴더 연결 설정을 확인해 주세요.");
  }
}
const configInput = z
  .object({
    includeExtensions: z.array(z.string().max(30)).max(100).optional(),
    excludeExtensions: z.array(z.string().max(30)).max(100).optional(),
    excludeDirs: z.array(z.string().max(200)).max(100).optional(),
    excludeGlobs: z.array(z.string().max(200)).max(100).optional(),
    maxFileSizeMb: z.number().int().min(1).max(100).optional(),
  })
  .strict();
const inputSchema = z
  .object({
    id: z.uuid().optional(),
    label: z.string().trim().min(1).max(120),
    domainId: z.uuid(),
    projectId: z.uuid().nullable(),
    category: z.enum(["guideline", "project", "reference"]),
    mode: z.enum(["upload", "watch"]),
    rootKey: z.string().max(60).nullable().optional(),
    enabled: z.boolean().default(false),
    intervalMinutes: z.number().int().min(1).max(1440).default(5),
    config: configInput.default({}),
  })
  .strict();
export async function importRecord(context: ContentContext, id: string) {
  const [row] = await getDb()
    .select()
    .from(sourceImport)
    .where(
      and(
        eq(sourceImport.id, parseId(id)),
        eq(sourceImport.workspaceId, context.workspaceId),
      ),
    );
  if (!row || !mayManage(context, row.createdBy))
    throw new AccessError(404, "가져오기 기록을 찾을 수 없습니다.");
  return row;
}
export async function listSourceImports(h: Headers, w: string) {
  const context = await requireWorkspace(h, w);
  requireWriter(context);
  const items = await getDb()
    .select()
    .from(sourceImport)
    .where(
      and(
        eq(sourceImport.workspaceId, w),
        context.role === "reviewer"
          ? undefined
          : eq(sourceImport.createdBy, context.user.id),
      ),
    )
    .orderBy(desc(sourceImport.updatedAt));
  return {
    items,
    roots: configuredImportRoots(w).map(({ key, label }) => ({ key, label })),
  };
}
export async function saveSourceImport(h: Headers, w: string, raw: unknown) {
  const context = await requireWorkspace(h, w);
  requireWriter(context);
  const input = inputSchema.parse(raw);
  await checkScope(w, input.domainId, input.projectId);
  if (
    input.mode === "watch" &&
    !configuredImportRoots(w).some((r) => r.key === input.rootKey)
  )
    throw new AccessError(400, "연결된 서버 폴더를 선택해 주세요.");
  const values = {
    ...input,
    rootKey: input.mode === "watch" ? input.rootKey : null,
    enabled: input.mode === "watch" && input.enabled,
    config: normalizeSourceWatchConfig(input.config),
  };
  if (input.id) {
    const old = await importRecord(context, input.id);
    if (
      old.domainId !== input.domainId ||
      old.projectId !== input.projectId ||
      old.category !== input.category ||
      old.mode !== input.mode ||
      old.rootKey !== values.rootKey
    )
      throw new AccessError(
        409,
        "연결 범위를 바꾸려면 새 가져오기를 등록해 주세요.",
      );
    const [saved] = await getDb()
      .update(sourceImport)
      .set({
        label: values.label,
        enabled: values.enabled,
        config: values.config,
        intervalMinutes: input.intervalMinutes,
        nextScanAt: new Date(),
      })
      .where(eq(sourceImport.id, old.id))
      .returning();
    return saved;
  }
  const [saved] = await getDb()
    .insert(sourceImport)
    .values({ ...values, workspaceId: w, createdBy: context.user.id })
    .returning();
  return saved;
}
export async function sourceImportDetails(h: Headers, w: string, id: string) {
  const context = await requireWorkspace(h, w);
  requireWriter(context);
  const item = await importRecord(context, id);
  const files = await getDb()
    .select()
    .from(sourceImportFile)
    .where(eq(sourceImportFile.importId, id))
    .orderBy(sourceImportFile.relativePath);
  return { item, files };
}
export async function sourceImportAction(
  h: Headers,
  w: string,
  id: string,
  raw: unknown,
) {
  const context = await requireWorkspace(h, w);
  requireWriter(context);
  const item = await importRecord(context, id);
  const { action } = z
    .object({ action: z.enum(["scan", "pause", "resume"]) })
    .strict()
    .parse(raw);
  if (item.mode !== "watch")
    throw new AccessError(400, "서버 폴더 연결에서 사용할 수 있습니다.");
  const [saved] = await getDb()
    .update(sourceImport)
    .set({ enabled: action !== "pause", nextScanAt: new Date() })
    .where(eq(sourceImport.id, id))
    .returning();
  return saved;
}
