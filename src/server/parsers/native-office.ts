import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { type ExtractionResult, ParseFailure, textChunks } from "./document";

const execute = promisify(execFile);
export async function parseNativeOffice(
  bytes: Uint8Array,
  format: string,
): Promise<ExtractionResult> {
  if (!["doc", "xls", "xlsb", "ppt", "mobi"].includes(format))
    throw new ParseFailure("지원하지 않는 원본 형식입니다.");
  const directory = await mkdtemp(join(tmpdir(), "wiki-document-"));
  try {
    const input = join(directory, `source.${format}`);
    await writeFile(input, bytes, { mode: 0o600 });
    const binary =
      process.env.DOCUMENT_EXTRACTOR_BIN ||
      resolve("native/document-extract/target/release/wiki-document-extract");
    const { stdout } = await execute(binary, [input], {
      timeout: 40_000,
      maxBuffer: 32 * 1024 * 1024,
      encoding: "utf8",
    });
    const { markdown } = JSON.parse(stdout);
    if (typeof markdown !== "string" || !markdown.trim()) throw new Error();
    return {
      chunks: textChunks(markdown),
      parserVersion:
        format === "mobi" ? "llm_wiki-ebook/mobi@0.8" : "llm_wiki-anydoc@0.1.6",
      warnings: [
        "원본과 같은 문서 변환기로 내용을 추출했습니다. 표·수식·배치는 원본과 함께 확인해 주세요.",
      ],
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      throw new ParseFailure(
        "문서 변환기를 먼저 빌드해 주세요. 운영 Docker 이미지에는 포함됩니다.",
      );
    throw new ParseFailure(
      "문서를 변환하지 못했습니다. 손상·암호·DRM 또는 파일 형식을 확인해 주세요.",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
