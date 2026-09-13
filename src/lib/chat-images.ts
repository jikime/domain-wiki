// Adapted from llm_wiki src/lib/chat-image-utils.ts, Git 8bcf9b5.
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
import { z } from "zod";

export const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 5;
export const MAX_CHAT_REQUEST_BYTES = 36 * 1024 * 1024;
export const imageInput = z
  .object({
    mediaType: z.enum(ACCEPTED_IMAGE_TYPES),
    dataBase64: z
      .string()
      .min(4)
      .max(4 * Math.ceil(MAX_IMAGE_BYTES / 3)),
    name: z.string().trim().min(1).max(200).default("첨부 이미지"),
  })
  .strict();
export type MessageImage = z.infer<typeof imageInput>;
export type ChatImageInfo = {
  id: string;
  name: string;
  mediaType: string;
  href: string;
};
export function isAcceptedImageType(type: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type);
}
export function fileToMessageImage(file: File): Promise<MessageImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("이미지를 읽지 못했습니다."));
        return;
      }
      const comma = reader.result.indexOf(",");
      resolve({
        mediaType: file.type as MessageImage["mediaType"],
        dataBase64: reader.result.slice(comma + 1),
        name: (file.name || "첨부 이미지").slice(0, 200),
      });
    };
    reader.readAsDataURL(file);
  });
}
export function messageImageToDataUrl(image: MessageImage): string {
  return `data:${image.mediaType};base64,${image.dataBase64}`;
}
