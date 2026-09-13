import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { MAX_IMAGE_BYTES, type MessageImage } from "@/lib/chat-images";
import { AccessError, requireWorkspace } from "@/server/access";
import { getDb } from "@/server/db";
import { chatImage, chatRun, conversation } from "@/server/db/schema";
import { parseId } from "./content-access";

export async function validateChatImages(images: MessageImage[]) {
  const validated = [];
  for (const image of images) {
    const data = Buffer.from(image.dataBase64, "base64");
    if (
      !data.length ||
      data.length > MAX_IMAGE_BYTES ||
      data.toString("base64") !== image.dataBase64
    )
      throw new AccessError(
        400,
        "이미지 크기 또는 인코딩을 확인하세요. 한 장에 최대 5MB입니다.",
      );
    try {
      const decoded = sharp(data, {
        limitInputPixels: 40_000_000,
        failOn: "warning",
      });
      const metadata = await decoded.metadata();
      const mime = `image/${metadata.format}`;
      if (mime !== image.mediaType) throw new Error("MIME mismatch");
      // Decode a bounded thumbnail to reject corrupt bodies; keep the original bytes.
      await decoded.resize(32, 32, { fit: "inside" }).raw().toBuffer();
    } catch {
      throw new AccessError(
        400,
        "읽을 수 없는 이미지입니다. PNG·JPEG·WebP·GIF 파일을 확인하세요.",
      );
    }
    validated.push({
      name: image.name,
      mediaType: image.mediaType,
      data,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
  }
  return validated;
}

export const chatImageColumns = {
  id: chatImage.id,
  runId: chatImage.runId,
  ordinal: chatImage.ordinal,
  name: chatImage.name,
  mediaType: chatImage.mediaType,
};

export async function ownChatImage(
  headers: Headers,
  w: string,
  conversationId: string,
  imageId: string,
) {
  const context = await requireWorkspace(headers, w);
  parseId(conversationId);
  parseId(imageId);
  const [image] = await getDb()
    .select({ data: chatImage.data, mediaType: chatImage.mediaType })
    .from(chatImage)
    .innerJoin(chatRun, eq(chatRun.id, chatImage.runId))
    .innerJoin(conversation, eq(conversation.id, chatRun.conversationId))
    .where(
      and(
        eq(chatImage.id, imageId),
        eq(chatImage.workspaceId, w),
        eq(conversation.id, conversationId),
        eq(conversation.ownerId, context.user.id),
      ),
    );
  if (!image) throw new AccessError(404, "이미지를 찾을 수 없습니다.");
  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mediaType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}

// The caller has already checked ownership and retained only current, same-scope turns.
export async function historyChatImages(w: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await getDb()
    .select()
    .from(chatImage)
    .where(and(eq(chatImage.workspaceId, w), inArray(chatImage.id, ids)))
    .orderBy(chatImage.runId, chatImage.ordinal);
  return rows.map((row) => ({
    runId: row.runId,
    image: {
      name: row.name,
      mediaType: row.mediaType as MessageImage["mediaType"],
      dataBase64: row.data.toString("base64"),
    },
  }));
}
