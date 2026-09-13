import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { buildCaptionPromptWithContext } from "@/lib/reference/vision-caption-prompt";
import { getDb } from "@/server/db";
import { generation, imageCaptionCache, membership } from "@/server/db/schema";
import { getServerEnv } from "@/server/env";
import { AccessError } from "@/server/errors";
import type { ExtractionResult } from "@/server/parsers/document";
import { checkAiCapacity } from "@/server/services/operations";
import { modelProfile, streamModel } from "./client";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export async function captionExtractedImages(
  w: string,
  authorId: string,
  result: ExtractionResult,
  signal: AbortSignal,
) {
  const profile = modelProfile("vision");
  if (!profile.configured || !profile.model) return;
  const db = getDb();
  for (const image of result.images ?? []) {
    signal.throwIfAborted();
    const raw = Buffer.from(image.base64, "base64");
    const position = result.chunks.findIndex((c) =>
      c.text.includes(`asset://${image.key}`),
    );
    const before = result.chunks
        .slice(Math.max(0, position - 1), position)
        .map((c) => c.text)
        .join("\n")
        .slice(-1200),
      after = result.chunks
        .slice(position + 1, position + 2)
        .map((c) => c.text)
        .join("\n")
        .slice(0, 1200);
    const prompt = buildCaptionPromptWithContext(before, after, "Korean"),
      cacheKey = hash(
        JSON.stringify([hash(raw), profile.identity, prompt, "caption-v1"]),
      );
    let caption = (
      await db
        .select()
        .from(imageCaptionCache)
        .where(
          and(
            eq(imageCaptionCache.workspaceId, w),
            eq(imageCaptionCache.cacheKey, cacheKey),
          ),
        )
    )[0]?.caption;
    let id: string | undefined;
    try {
      if (!caption) {
        id = randomUUID();
        const generationId = id;
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${w},3))`,
          );
          const [member] = await tx
            .select()
            .from(membership)
            .where(
              and(
                eq(membership.workspaceId, w),
                eq(membership.userId, authorId),
                eq(membership.isActive, true),
              ),
            );
          if (
            !member ||
            !(member.isAdmin || ["writer", "reviewer"].includes(member.role))
          )
            throw new AccessError(
              403,
              "이미지 설명 작업의 작성 권한이 변경되었습니다.",
            );
          await checkAiCapacity(tx, w);
          await tx.insert(generation).values({
            id: generationId,
            workspaceId: w,
            authorId,
            requestId: randomUUID(),
            inputHash: cacheKey,
            kind: "image-caption",
            state: "running",
            model: profile.model as string,
          });
        });
        const thumbnail = await sharp(raw)
          .resize({
            width: 2048,
            height: 2048,
            fit: "inside",
            withoutEnlargement: true,
          })
          .png()
          .toBuffer();
        const output = await streamModel(
          [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${thumbnail.toString("base64")}`,
                  },
                },
              ],
            },
          ],
          async () => signal.throwIfAborted(),
          AbortSignal.any([
            signal,
            AbortSignal.timeout(getServerEnv().AI_TIMEOUT_SECONDS * 1000),
          ]),
          "vision",
        );
        caption = output.text.trim();
        if (!caption) throw new Error("빈 이미지 설명");
        await db
          .update(generation)
          .set({
            state: "completed",
            inputTokens: output.inputTokens,
            outputTokens: output.outputTokens,
            updatedAt: new Date(),
          })
          .where(eq(generation.id, generationId));
        signal.throwIfAborted();
        await db
          .insert(imageCaptionCache)
          .values({ workspaceId: w, cacheKey, caption, model: profile.model })
          .onConflictDoNothing();
      }
      image.caption = caption;
      result.warnings = result.warnings.filter(
        (warning) => !warning.includes("이미지 설명 모델을 설정하면"),
      );
      const text = `이미지 설명: ${caption}\n\n![${caption
        .replace(/[\r\n]/g, " ")
        .replace(/[[\]]/g, "")
        .slice(0, 2000)}](asset://${image.key})`;
      if (position >= 0) {
        const chunk = result.chunks[position];
        // Embedded Markdown images may share a chunk with prose or other images.
        // Retain all source text and add the caption beside the existing image.
        chunk.text += `\n\n이미지 설명 (${image.name.replace(/[\r\n]/g, " ")}): ${caption}`;
      } else
        result.chunks.push({
          ordinal: result.chunks.length,
          text,
          locator: image.locator,
        });
    } catch (error) {
      if (id)
        await db
          .update(generation)
          .set({
            state: "failed",
            errorMessage: "이미지 설명을 완료하지 못했습니다.",
            updatedAt: new Date(),
          })
          .where(and(eq(generation.id, id), eq(generation.state, "running")));
      if (signal.aborted) throw error;
      result.warnings.push(
        `이미지 ${image.name}의 설명을 만들지 못했습니다. 원본 이미지는 보관했습니다.`,
      );
    }
  }
}
