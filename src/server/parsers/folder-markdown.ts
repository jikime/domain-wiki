import remarkParse from "remark-parse";
import { unified } from "unified";
import { type ExtractionResult, textChunks } from "./document";
import { prepareImage } from "./images";
export type FolderImageInput = { ref: string; bytes: string };
type Node = {
  type: string;
  url?: string;
  children?: Node[];
  position?: { start: { offset: number }; end: { offset: number } };
};
function clean(raw: string) {
  const value = raw
    .split("#")[0]
    .split("|")[0]
    .trim()
    .replace(/^<(.+)>$/, "$1");
  try {
    return decodeURIComponent(value).replace(/\\/g, "/");
  } catch {
    return value.replace(/\\/g, "/");
  }
}
export async function attachFolderImages(
  result: ExtractionResult,
  bytes: Uint8Array,
  inputs: FolderImageInput[],
) {
  let body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const refs = new Map<string, string>();
  let total = 0;
  result.images ??= [];
  for (const input of inputs) {
    try {
      const key = `folder-image-${result.images.length + 1}`;
      const image = await prepareImage(Buffer.from(input.bytes, "base64"), {
        key,
        name: input.ref,
        locator: { kind: "image", image: result.images.length + 1 },
      });
      total += Buffer.byteLength(image.base64, "base64");
      if (total > 100 * 1024 * 1024) throw new Error("image limit");
      refs.set(input.ref.replace(/\\/g, "/"), `asset://${key}`);
      result.images.push(image);
    } catch {
      result.warnings.push(
        `연결 이미지 ${input.ref}를 읽지 못했습니다. 본문과 원본 파일은 보관했습니다.`,
      );
    }
  }
  const replacements: { start: number; end: number; value: string }[] = [];
  const visit = (node: Node) => {
    if (node.position) {
      const start = node.position.start.offset,
        end = node.position.end.offset;
      const raw = body.slice(start, end);
      if (node.type === "image" && node.url) {
        const target = refs.get(clean(node.url));
        const offset = raw.lastIndexOf(node.url);
        if (target && offset >= 0)
          replacements.push({
            start: start + offset,
            end: start + offset + node.url.length,
            value: target,
          });
      } else if (node.type === "text") {
        for (const match of raw.matchAll(/!\[\[([^\]]+)\]\]/g)) {
          const ref = clean(match[1]);
          const target = refs.get(ref);
          if (target)
            replacements.push({
              start: start + match.index,
              end: start + match.index + match[0].length,
              value: `![${ref.replace(/[[\]\r\n]/g, " ")} ](${target})`,
            });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(unified().use(remarkParse).parse(body) as Node);
  for (const r of replacements.sort((a, b) => b.start - a.start))
    body = body.slice(0, r.start) + r.value + body.slice(r.end);
  result.chunks = textChunks(body);
  for (const image of result.images) {
    if (!result.chunks.some((c) => c.text.includes(`asset://${image.key}`)))
      result.chunks.push({
        ordinal: result.chunks.length,
        locator: image.locator,
        text: `![연결 이미지](asset://${image.key})`,
      });
  }
  result.parserVersion += "/folder-images-v1";
}
