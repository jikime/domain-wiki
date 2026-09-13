import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { MAX_FILE_BYTES } from "@/lib/content";
import { effectiveRole, includedRoles } from "@/lib/permissions";
import { isPathAllowedBySourceWatch } from "@/lib/reference/source-watch-config";
import { SOURCE_FORMATS, safeRelativePath } from "@/lib/source-formats";
import {
  isImportImage,
  isPathAllowedForImport,
} from "@/lib/source-import-files";
import { AccessError } from "@/server/access";
import { getDb } from "@/server/db";
import {
  membership,
  sourceImport,
  sourceImportFile,
  user,
  workspace,
} from "@/server/db/schema";
import type { ContentContext } from "@/server/services/content-access";
import { configuredImportRoots } from "@/server/services/source-imports";
import { registerSourceFile } from "@/server/services/sources";

export async function importOwner(
  w: string,
  id: string,
): Promise<ContentContext> {
  const [row] = await getDb()
    .select({ member: membership, user, workspace })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .innerJoin(workspace, eq(workspace.id, membership.workspaceId))
    .where(
      and(
        eq(membership.workspaceId, w),
        eq(membership.userId, id),
        eq(membership.isActive, true),
      ),
    );
  if (!row || effectiveRole(row.member.role, row.member.isAdmin) === "reader")
    throw new AccessError(
      403,
      "폴더 연결 담당자의 작성 권한이 변경되었습니다.",
    );
  return {
    workspaceId: w,
    workspaceName: row.workspace.name,
    role: effectiveRole(row.member.role, row.member.isAdmin),
    assignedRole: row.member.role,
    isAdmin: row.member.isAdmin,
    roles: includedRoles(row.member.role, row.member.isAdmin),
    user: row.user,
  };
}
function inside(root: string, path: string) {
  const rel = relative(root, path);
  return !rel || (!rel.startsWith("..") && !isAbsolute(rel));
}
export async function scanSourceImport(
  item: typeof sourceImport.$inferSelect,
  leaseId: string,
) {
  const roots = configuredImportRoots(item.workspaceId),
    root = roots.find((r) => r.key === item.rootKey);
  if (!root || !isAbsolute(root.path))
    throw new AccessError(503, "서버 폴더 연결을 확인해 주세요.");
  const resolvedRoot = await realpath(root.path);
  if (!(await lstat(resolvedRoot)).isDirectory())
    throw new AccessError(400, "서버 폴더를 확인해 주세요.");
  const started = new Date();
  const observed = new Set<string>();
  const check = async () => {
    const context = await importOwner(item.workspaceId, item.createdBy);
    const [current] = await getDb()
      .update(sourceImport)
      .set({ leaseUntil: new Date(Date.now() + 120_000) })
      .where(
        and(
          eq(sourceImport.id, item.id),
          eq(sourceImport.leaseId, leaseId),
          eq(sourceImport.enabled, true),
        ),
      )
      .returning();
    if (!current) throw new AccessError(409, "폴더 감지를 중지했습니다.");
    return context;
  };
  const errors: string[] = [];
  async function walk(dir: string, imagesFirst: boolean) {
    await check();
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name),
        relativePath = safeRelativePath(
          relative(resolvedRoot, path).split("\\").join("/"),
        );
      if (!relativePath || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        // Directory pruning uses the same original exclusion rules as files.
        if (
          isPathAllowedBySourceWatch(`${relativePath}/probe.md`, {
            ...item.config,
            includeExtensions: [],
            excludeExtensions: [],
          })
        )
          await walk(path, imagesFirst);
        continue;
      }
      if (
        !entry.isFile() ||
        !SOURCE_FORMATS[entry.name.split(".").at(-1)?.toLowerCase() ?? ""] ||
        !isPathAllowedForImport(relativePath, item.config) ||
        isImportImage(relativePath) !== imagesFirst
      )
        continue;
      observed.add(relativePath);
      try {
        const context = await check();
        if (!inside(resolvedRoot, await realpath(path)))
          throw new Error("outside");
        const handle = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        let bytes: Buffer;
        try {
          const before = await handle.stat();
          if (
            !before.isFile() ||
            before.size >
              Math.min(MAX_FILE_BYTES, item.config.maxFileSizeMb * 1024 * 1024)
          )
            throw new AccessError(413, "파일 크기 제한을 초과했습니다.");
          bytes = await handle.readFile();
          const after = await handle.stat();
          if (
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            bytes.length !== before.size ||
            !inside(resolvedRoot, await realpath(path))
          )
            throw new AccessError(
              409,
              "읽는 중 변경되었습니다. 다음 감지에서 다시 확인합니다.",
            );
        } finally {
          await handle.close();
        }
        const digest = createHash("sha256").update(bytes).digest("hex");
        const mappings = await getDb()
          .select()
          .from(sourceImportFile)
          .where(eq(sourceImportFile.importId, item.id));
        if (!mappings.some((m) => m.relativePath === relativePath)) {
          const same = mappings.filter((m) => m.sha256 === digest);
          if (same.length === 1) {
            const old = same[0],
              oldPath = safeRelativePath(old.relativePath);
            let absent = false;
            if (oldPath)
              try {
                await lstat(join(resolvedRoot, oldPath));
              } catch (e) {
                absent =
                  !!e &&
                  typeof e === "object" &&
                  "code" in e &&
                  e.code === "ENOENT";
              }
            // Only an absent path with one exact content match proves a move.
            if (absent)
              await getDb().transaction(async (tx) => {
                const [owned] = await tx
                  .select()
                  .from(sourceImport)
                  .where(
                    and(
                      eq(sourceImport.id, item.id),
                      eq(sourceImport.leaseId, leaseId),
                      eq(sourceImport.enabled, true),
                    ),
                  )
                  .for("update");
                if (!owned)
                  throw new AccessError(409, "폴더 감지를 중지했습니다.");
                await tx
                  .update(sourceImportFile)
                  .set({ relativePath, missing: false, observedAt: new Date() })
                  .where(
                    and(
                      eq(sourceImportFile.importId, item.id),
                      eq(sourceImportFile.relativePath, old.relativePath),
                    ),
                  );
              });
          }
        }
        await registerSourceFile(
          context,
          new File([new Uint8Array(bytes)], entry.name),
          {
            title:
              entry.name.replace(/\.[^.]+$/, "").slice(0, 160) || entry.name,
            domainId: item.domainId,
            projectId: item.projectId,
            category: item.category,
          },
          {
            importId: item.id,
            relativePath,
            importLeaseId: leaseId,
            importObservedSince: started,
          },
        );
      } catch (error) {
        if (error instanceof AccessError && [403, 409].includes(error.status))
          throw error;
        if (errors.length < 20)
          errors.push(
            `${relativePath}: ${error instanceof AccessError ? error.message : "읽기 실패"}`,
          );
      }
    }
  }
  await walk(resolve(resolvedRoot), true);
  await walk(resolve(resolvedRoot), false);
  await check();
  // A missing file needs an impact review; published evidence is immutable.
  const records = await getDb()
    .select()
    .from(sourceImportFile)
    .where(eq(sourceImportFile.importId, item.id));
  for (const record of records)
    if (!observed.has(record.relativePath))
      await getDb()
        .update(sourceImportFile)
        .set({ missing: true })
        .where(
          and(
            eq(sourceImportFile.importId, item.id),
            eq(sourceImportFile.relativePath, record.relativePath),
          ),
        );
  await getDb()
    .update(sourceImport)
    .set({
      state: errors.length ? "failed" : "idle",
      errorMessage: errors.join("\n") || null,
      lastScanAt: started,
      leaseId: null,
      leaseUntil: null,
      nextScanAt: new Date(Date.now() + item.intervalMinutes * 60_000),
    })
    .where(
      and(eq(sourceImport.id, item.id), eq(sourceImport.leaseId, leaseId)),
    );
}
export async function runNextSourceImport() {
  const leaseId = randomUUID();
  const item = await getDb().transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(sourceImport)
      .where(
        and(
          eq(sourceImport.enabled, true),
          eq(sourceImport.mode, "watch"),
          sql`${sourceImport.nextScanAt} <= now()`,
          sql`(${sourceImport.leaseUntil} IS NULL OR ${sourceImport.leaseUntil} < now())`,
        ),
      )
      .orderBy(sourceImport.nextScanAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    await tx
      .update(sourceImport)
      .set({
        leaseId,
        leaseUntil: new Date(Date.now() + 120_000),
        state: "scanning",
        errorMessage: null,
      })
      .where(eq(sourceImport.id, candidate.id));
    return candidate;
  });
  if (!item) return false;
  try {
    await scanSourceImport(item, leaseId);
  } catch (error) {
    await getDb()
      .update(sourceImport)
      .set({
        state: "failed",
        errorMessage:
          error instanceof AccessError
            ? error.message
            : "폴더를 읽지 못했습니다. 서버 연결과 파일 권한을 확인해 주세요.",
        leaseId: null,
        leaseUntil: null,
        nextScanAt: new Date(Date.now() + item.intervalMinutes * 60_000),
      })
      .where(
        and(eq(sourceImport.id, item.id), eq(sourceImport.leaseId, leaseId)),
      );
  }
  return true;
}
