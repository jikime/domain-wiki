import type { SourceLocator } from "@/server/db/schema";
import { nativeFormat, officeFormat } from "../../lib/source-formats";
export type ExtractedChunk = {
  ordinal: number;
  text: string;
  locator: SourceLocator;
};
export type ExtractionImage = {
  key: string;
  name: string;
  mimeType: string;
  base64: string;
  width: number;
  height: number;
  locator: SourceLocator;
  caption?: string;
};
export type ExtractionResult = {
  images?: ExtractionImage[];
  chunks: ExtractedChunk[];
  parserVersion: string;
  warnings: string[];
};
export class ParseFailure extends Error {}
export function textChunks(text: string): ExtractedChunk[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const chunks: ExtractedChunk[] = [];
  let buffer: string[] = [];
  let start = 1;
  let heading = "";
  let currentHeading = "";
  function flush(end: number) {
    const content = buffer.join("\n").trim();
    if (content)
      chunks.push({
        ordinal: chunks.length,
        text: content,
        locator: {
          kind: "lines",
          startLine: start,
          endLine: end,
          heading: currentHeading,
        },
      });
    buffer = [];
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^#{1,6}\s/.test(line)) {
      flush(index);
      heading = line.replace(/^#{1,6}\s+/, "");
    }
    if (buffer.join("\n").length + line.length > 1800 && buffer.length)
      flush(index);
    if (!buffer.length) {
      start = index + 1;
      currentHeading = heading;
    }
    buffer.push(line);
    if (!line.trim()) flush(index + 1);
  }
  flush(lines.length);
  return chunks;
}
export async function parseDocument(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ExtractionResult> {
  if (nativeFormat[mimeType]) {
    const { parseNativeOffice } = await import("./native-office");
    return parseNativeOffice(bytes, nativeFormat[mimeType]);
  }
  if (mimeType === "application/pdf") {
    const { mineruConfig, parseMineru } = await import("./mineru");
    const config = mineruConfig();
    if (config) return parseMineru(bytes, config);
  }
  let chunks: ExtractedChunk[];
  let parserVersion: string;
  const warnings: string[] = [];
  let images: ExtractionImage[] = [];
  if (mimeType === "text/html") {
    const { htmlDocument } = await import("./html");
    const result = htmlDocument(bytes);
    chunks = result.chunks;
    parserVersion = result.parserVersion;
    warnings.push(...result.warnings);
  } else if (mimeType === "application/pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
    });
    try {
      const info = await parser.getInfo();
      if (info.total > 300)
        throw new ParseFailure("PDF는 300쪽 이하로 나누어 등록해 주세요.");
      const result = await parser.getText({ pageJoiner: "" });
      if (result.pages.some((page) => !page.text.trim()))
        throw new ParseFailure(
          "텍스트가 없는 PDF 페이지가 있습니다. 스캔·이미지·빈 페이지를 확인해 주세요. OCR은 아직 지원하지 않습니다.",
        );
      chunks = result.pages
        .flatMap((page) => {
          const pieces = page.text.match(/[\s\S]{1,1800}/g) ?? [];
          return pieces.map((text) => ({
            ordinal: 0,
            text: text.trim(),
            locator: { kind: "pdf" as const, page: page.num },
          }));
        })
        .filter((chunk) => chunk.text);
      try {
        const tables = await parser.getTable();
        const missing = tables.pages
          .filter((p) => !p.tables.length)
          .map((p) => p.num);
        if (missing.length) {
          const { pdfBorderedTables } = await import("./pdf-grid");
          const recovered = await pdfBorderedTables(bytes, missing);
          for (const page of recovered) {
            const target = tables.pages.find((p) => p.num === page.page);
            if (target) target.tables = page.tables.map((t) => t.rows);
          }
        }
        for (const page of tables.pages)
          for (const [t, table] of page.tables.entries()) {
            const labels = table[0] ?? [];
            table.forEach((row, r) => {
              const text = row
                .map(
                  (cell, c) =>
                    `${c + 1}열${r > 0 && labels[c] ? `(${labels[c]})` : ""}: ${cell}`,
                )
                .join(" | ");
              for (const part of text.match(/[\s\S]{1,1800}/g) ?? [])
                chunks.push({
                  ordinal: 0,
                  text: part,
                  locator: {
                    kind: "pdf",
                    page: page.num,
                    table: t + 1,
                    row: r + 1,
                  },
                });
            });
          }
        if (tables.pages.some((p) => p.tables.length))
          warnings.push(
            "인식한 표는 행·열을 덧붙였습니다. 표 감지는 완전하지 않으므로 병합 셀·단위·조건을 원문과 대조해 주세요.",
          );
        else
          warnings.push(
            "표 구조를 확인하지 못했습니다. 표가 포함된 문서라면 페이지 텍스트와 원문의 행·열을 직접 대조해 주세요.",
          );
      } catch {
        warnings.push(
          "PDF 표 구조를 읽지 못해 페이지 텍스트만 보관했습니다. 표는 원문에서 확인해 주세요.",
        );
      }
      try {
        const extracted = await parser.getImage({
          imageThreshold: 50,
          imageDataUrl: false,
        });
        const { prepareImage } = await import("./images");
        for (const page of extracted.pages)
          for (const item of page.images) {
            if (images.length >= 500)
              throw new ParseFailure(
                "PDF 이미지가 500개를 넘습니다. 문서를 나누어 주세요.",
              );
            const key = `image-${images.length + 1}`;
            const image = await prepareImage(item.data, {
              key,
              name: `page-${page.pageNumber}-${item.name}.png`,
              locator: {
                kind: "image",
                image: images.length + 1,
                page: page.pageNumber,
              },
            });
            images.push(image);
            chunks.push({
              ordinal: chunks.length,
              text: `![${page.pageNumber}쪽 이미지 ${images.length}](asset://${key})`,
              locator: image.locator,
            });
          }
      } catch (error) {
        if (error instanceof ParseFailure) throw error;
        warnings.push(
          "PDF의 일부 이미지를 추출하지 못했습니다. 원본 페이지를 함께 확인해 주세요.",
        );
      }
      chunks.forEach((chunk, ordinal) => {
        chunk.ordinal = ordinal;
      });
      parserVersion = "pdf-parse@2.4.5/text-table-v2";
      warnings.push(
        "PDF의 텍스트와 인식한 표를 추출했습니다. 다단 읽기 순서·병합 셀·이미지 속 글자는 원문과 대조해 주세요.",
      );
    } catch (error) {
      if (error instanceof ParseFailure) throw error;
      throw new ParseFailure(
        "PDF를 읽을 수 없습니다. 손상·암호 설정·지원하지 않는 PDF 구조를 확인해 주세요.",
      );
    } finally {
      await parser.destroy();
    }
  } else if (officeFormat[mimeType]) {
    const { parseOfficeDocument } = await import("./office");
    const result = await parseOfficeDocument(bytes, mimeType);
    chunks = result.chunks;
    parserVersion = result.parserVersion;
    warnings.push(...result.warnings);
    images = result.images ?? [];
  } else if (mimeType.startsWith("image/")) {
    const { prepareImage } = await import("./images");
    const image = await prepareImage(bytes, {
      key: "image-1",
      name: "image-1.png",
      locator: { kind: "image", image: 1 },
    });
    images = [image];
    chunks = [
      {
        ordinal: 0,
        text: "![이미지 원문](asset://image-1)",
        locator: image.locator,
      },
    ];
    parserVersion = "sharp@0.35.4/image-v1";
    warnings.push(
      "이미지 원본을 보관했습니다. 이미지 설명 모델을 설정하면 그림 속 문자와 도표 설명을 검색할 수 있습니다.",
    );
  } else if (
    mimeType.startsWith("text/") ||
    [
      "application/json",
      "application/x-ndjson",
      "application/xml",
      "application/x-ipynb+json",
    ].includes(mimeType)
  ) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ParseFailure(
        "UTF-8 인코딩의 텍스트 파일로 저장해 다시 등록해 주세요.",
      );
    }
    if (text.includes("\0"))
      throw new ParseFailure(
        "텍스트 파일에 바이너리 데이터가 포함되어 있습니다.",
      );
    if (mimeType === "text/x-org") {
      text = text
        .replace(
          /^(\*+) /gm,
          (_, stars: string) => `${"#".repeat(Math.min(6, stars.length))} `,
        )
        .replace(/^#\+BEGIN_SRC\s*(.*)$/gim, "```$1")
        .replace(/^#\+END_SRC.*$/gim, "```")
        .replace(/\[\[([^\]]+)\]\[([^\]]+)\]\]/g, "[$2]($1)");
    }
    if (mimeType === "application/x-ipynb+json") {
      try {
        const notebook = JSON.parse(text);
        if (!Array.isArray(notebook.cells)) throw new Error();
        text = notebook.cells
          .map((c: { cell_type: string; source: string[] | string }) => {
            const body = Array.isArray(c.source) ? c.source.join("") : c.source;
            return c.cell_type === "code" ? `\`\`\`\n${body}\n\`\`\`` : body;
          })
          .join("\n\n");
      } catch {
        throw new ParseFailure("노트북 파일 구조를 확인해 주세요.");
      }
    }
    chunks = textChunks(text);
    parserVersion = "utf8-lines@1";
  } else throw new ParseFailure("지원하지 않는 파일 형식입니다.");
  if (!chunks.length) throw new ParseFailure("추출할 텍스트가 없습니다.");
  if (
    chunks.length > 5000 ||
    chunks.reduce((sum, chunk) => sum + chunk.text.length, 0) > 2_000_000
  )
    throw new ParseFailure(
      "추출 결과가 너무 큽니다. 문서를 나누어 등록해 주세요.",
    );
  return { chunks, parserVersion, warnings, images };
}
