import { z } from "zod";
import {
  type ExtractionImage,
  type ExtractionResult,
  ParseFailure,
  textChunks,
} from "./document";
import { prepareImage } from "./images";
import { mineruFiles } from "./mineru-io";
import { type MineruConfig, parseWithMineruResult } from "./mineru-reference";
export function mineruConfig(): MineruConfig | null {
  const mode = process.env.MINERU_BACKEND;
  if (!mode || mode === "disabled") return null;
  if (!["local", "cloud"].includes(mode))
    throw new ParseFailure("MINERU_BACKEND 설정을 확인해 주세요.");
  return {
    enabled: true,
    backend: mode as "local" | "cloud",
    token: process.env.MINERU_API_KEY ?? "",
    modelVersion: z
      .enum(["pipeline", "vlm"])
      .parse(process.env.MINERU_MODEL_VERSION ?? "pipeline"),
    localEndpoint: process.env.MINERU_ENDPOINT,
    localToken: process.env.MINERU_LOCAL_TOKEN,
    localLanguage: process.env.MINERU_LANGUAGE ?? "korean",
    localParseMethod: z
      .enum(["auto", "txt", "ocr"])
      .parse(process.env.MINERU_PARSE_METHOD ?? "auto"),
    localBackend: z
      .enum([
        "pipeline",
        "vlm-engine",
        "hybrid-engine",
        "vlm-http-client",
        "hybrid-http-client",
      ])
      .parse(process.env.MINERU_LOCAL_BACKEND ?? "hybrid-engine"),
    localServerUrl: process.env.MINERU_MODEL_SERVER_URL,
  };
}
export async function parseMineru(
  bytes: Uint8Array,
  config: MineruConfig,
): Promise<ExtractionResult> {
  const files = new Map<string, Uint8Array>([["/job/source.pdf", bytes]]);
  try {
    return await mineruFiles.run(
      {
        files,
        endpoint:
          config.backend === "local"
            ? (config.localEndpoint ?? "http://127.0.0.1:8000")
            : undefined,
      },
      async () => {
        const result = await parseWithMineruResult(
          config,
          "/job/source.pdf",
          undefined,
          undefined,
          AbortSignal.timeout(3_600_000),
          { projectPath: "/job", sourceSummarySlug: "document" },
        );
        const images: ExtractionImage[] = [];
        let markdown = result.markdown;
        for (const saved of result.savedImages) {
          const data = files.get(saved.absPath);
          if (!data) continue;
          const key = `image-${images.length + 1}`;
          const image = await prepareImage(data, {
            key,
            name: saved.relPath,
            locator: {
              kind: "image",
              image: images.length + 1,
              ...(saved.page ? { page: saved.page } : {}),
            },
          });
          images.push(image);
          markdown = markdown.replaceAll(saved.relPath, `asset://${key}`);
        }
        return {
          chunks: textChunks(markdown),
          images,
          parserVersion: `llm_wiki-mineru-${config.backend ?? "cloud"}/v1`,
          warnings: [
            "MinerU로 문자·표·수식과 이미지를 추출했습니다. 원본과 함께 검토해 주세요.",
          ],
        };
      },
    );
  } catch (error) {
    if (error instanceof ParseFailure) throw error;
    throw new ParseFailure(
      "MinerU 문서 처리를 완료하지 못했습니다. OCR 서버 주소·인증·작업 상태를 확인해 주세요.",
    );
  }
}
