import sharp from "sharp";
import { decodeBitmap } from "./bitmap";
import type { ExtractionImage } from "./document";
export async function prepareImage(
  bytes: Uint8Array,
  info: Pick<ExtractionImage, "key" | "name" | "locator">,
): Promise<ExtractionImage> {
  const { data, info: dimensions } = await sharp(await decodeBitmap(bytes), {
    limitInputPixels: 64_000_000,
  })
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    ...info,
    mimeType: "image/png",
    base64: data.toString("base64"),
    width: dimensions.width,
    height: dimensions.height,
  };
}
