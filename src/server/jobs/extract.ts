import "server-only";
import { fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import { captionExtractedImages } from "@/server/ai/image-caption";
import { getDb } from "@/server/db";
import { sourceAsset, sourceChunk, sourceVersion } from "@/server/db/schema";
import type { ExtractionResult } from "@/server/parsers/document";
import type { FolderImageInput } from "@/server/parsers/folder-markdown";
import { originals } from "@/server/storage/originals";
import { loadFolderMedia } from "./folder-media";
import { EXTRACT_QUEUE, type ExtractionJob } from "./queue";

class PermanentFailure extends Error {}
async function parseInChild(
  bytes: Buffer,
  mimeType: string,
  signal: AbortSignal,
  folderImages: FolderImageInput[] = [],
) {
  return new Promise<ExtractionResult>((resolveResult, reject) => {
    const child = fork(resolve("scripts/parse-child.ts"), [], {
      execArgv: ["--import", "tsx", "--max-old-space-size=768"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let settled = false;
    const finish = (error?: Error, result?: ExtractionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      child.kill("SIGKILL");
      if (error) reject(error);
      else if (result) resolveResult(result);
    };
    const abort = () => finish(new Error("처리가 중단되었습니다."));
    const parseTimeout =
      process.env.MINERU_BACKEND && process.env.MINERU_BACKEND !== "disabled"
        ? 3_660_000
        : 45_000;
    const timeout = setTimeout(
      () =>
        finish(
          new PermanentFailure(
            `문서 읽기 제한 시간(${Math.round(parseTimeout / 1000)}초)을 초과했습니다. 파일과 OCR 서버를 확인해 주세요.`,
          ),
        ),
      parseTimeout,
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    child.on(
      "message",
      (message: { result?: ExtractionResult; error?: string }) => {
        if (message.error) finish(new PermanentFailure(message.error));
        else if (message.result) finish(undefined, message.result);
      },
    );
    child.on("error", () =>
      finish(new Error("문서 처리 프로세스를 시작하지 못했습니다.")),
    );
    child.on("exit", () => {
      if (!settled)
        finish(
          new PermanentFailure(
            "문서 처리 프로세스가 종료되었습니다. 파일 구조와 크기를 확인해 주세요.",
          ),
        );
    });
    child.send({ bytes: bytes.toString("base64"), mimeType, folderImages });
  });
}
export async function extractJob(job: JobWithMetadata<ExtractionJob>) {
  const { versionId, workspaceId } = job.data;
  const db = getDb();
  const [version] = await db
    .update(sourceVersion)
    .set({ processing: "processing", errorMessage: null })
    .where(
      and(
        eq(sourceVersion.id, versionId),
        eq(sourceVersion.workspaceId, workspaceId),
        eq(sourceVersion.activeJobId, job.id),
        inArray(sourceVersion.processing, ["queued", "processing"]),
      ),
    )
    .returning();
  if (!version) return;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  job.signal.addEventListener("abort", onAbort, { once: true });
  const interval = setInterval(async () => {
    try {
      const [current] = await db
        .select({
          job: sourceVersion.activeJobId,
          state: sourceVersion.processing,
        })
        .from(sourceVersion)
        .where(eq(sourceVersion.id, versionId));
      if (!current || current.job !== job.id || current.state === "canceled")
        controller.abort();
    } catch {
      controller.abort();
    }
  }, 500);
  const writtenKeys: string[] = [];
  try {
    const bytes = await originals.read(version.storageKey);
    if (createHash("sha256").update(bytes).digest("hex") !== version.sha256)
      throw new PermanentFailure("원본 파일 무결성 확인에 실패했습니다.");
    const folder = await loadFolderMedia(version, controller.signal);
    const result = await parseInChild(
      bytes,
      version.mimeType,
      controller.signal,
      folder.images,
    );
    result.warnings.push(...folder.warnings);
    await captionExtractedImages(
      workspaceId,
      version.uploadedBy,
      result,
      controller.signal,
    );
    const imageRows: (typeof sourceAsset.$inferInsert)[] = [];
    let imageBytes = 0;
    for (const image of result.images ?? []) {
      if (controller.signal.aborted) throw new Error("처리가 중단되었습니다.");
      const data = Buffer.from(image.base64, "base64");
      imageBytes += data.length;
      if (imageBytes > 100 * 1024 * 1024)
        throw new PermanentFailure(
          "추출한 이미지가 100MiB를 넘습니다. 문서를 나누어 주세요.",
        );
      const id = randomUUID(),
        storageKey = `${workspaceId}/${id}`;
      writtenKeys.push(storageKey);
      await originals.put(storageKey, data);
      imageRows.push({
        id,
        workspaceId,
        versionId,
        name: `${image.key}.png`,
        mimeType: image.mimeType,
        storageKey,
        sha256: createHash("sha256").update(data).digest("hex"),
        byteSize: data.length,
        width: image.width,
        height: image.height,
        locator: image.locator,
        caption: image.caption ?? "",
      });
      for (const chunk of result.chunks)
        chunk.text = chunk.text.replaceAll(
          `asset://${image.key}`,
          `/api/workspaces/${workspaceId}/source-assets/${id}`,
        );
    }
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(sourceVersion)
        .where(eq(sourceVersion.id, versionId))
        .for("update");
      if (
        !current ||
        current.activeJobId !== job.id ||
        current.processing !== "processing" ||
        controller.signal.aborted
      )
        return;
      if (imageRows.length) await tx.insert(sourceAsset).values(imageRows);
      // A completed version is never re-parsed, so evidence chunk IDs remain stable.
      await tx.delete(sourceChunk).where(eq(sourceChunk.versionId, versionId));
      for (let offset = 0; offset < result.chunks.length; offset += 100)
        await tx
          .insert(sourceChunk)
          .values(
            result.chunks
              .slice(offset, offset + 100)
              .map((chunk) => ({ ...chunk, versionId, workspaceId })),
          );
      await tx
        .update(sourceVersion)
        .set({
          processing: "completed",
          parserVersion: result.parserVersion,
          warnings: result.warnings,
          errorMessage: null,
        })
        .where(eq(sourceVersion.id, versionId));
    });
  } catch (error) {
    const permanent =
      error instanceof PermanentFailure || job.retryCount >= job.retryLimit;
    await db
      .update(sourceVersion)
      .set({
        processing: permanent ? "failed" : "queued",
        errorMessage:
          error instanceof PermanentFailure
            ? error.message
            : "문서 처리 연결이 중단되어 재시도를 기다립니다.",
      })
      .where(
        and(
          eq(sourceVersion.id, versionId),
          eq(sourceVersion.activeJobId, job.id),
          eq(sourceVersion.processing, "processing"),
        ),
      );
    if (!permanent) throw new Error("문서 처리 재시도");
  } finally {
    // Check durable references before cleaning up files from an interrupted attempt.
    if (writtenKeys.length)
      try {
        const durable = await db
          .select({ key: sourceAsset.storageKey })
          .from(sourceAsset)
          .where(inArray(sourceAsset.storageKey, writtenKeys));
        const kept = new Set(durable.map((r) => r.key));
        for (const key of writtenKeys)
          if (!kept.has(key)) await originals.remove(key);
      } catch {
        /* Leave uncertain writes for reconciliation; never remove referenced bytes. */
      }
    clearInterval(interval);
    job.signal.removeEventListener("abort", onAbort);
  }
}
export async function reconcileJobs(boss: PgBoss) {
  const versions = await getDb()
    .select({ id: sourceVersion.id, jobId: sourceVersion.activeJobId })
    .from(sourceVersion)
    .where(inArray(sourceVersion.processing, ["queued", "processing"]))
    .limit(200);
  for (const version of versions) {
    if (!version.jobId) continue;
    const [job] = await boss.findJobs(EXTRACT_QUEUE, { id: version.jobId });
    if (
      !job ||
      job.state === "failed" ||
      job.state === "cancelled" ||
      job.state === "completed"
    )
      await getDb()
        .update(sourceVersion)
        .set({
          processing: "failed",
          errorMessage: "처리가 완료되지 않았습니다. 다시 시도해 주세요.",
        })
        .where(
          and(
            eq(sourceVersion.id, version.id),
            eq(sourceVersion.activeJobId, version.jobId),
            inArray(sourceVersion.processing, ["queued", "processing"]),
          ),
        );
  }
}
