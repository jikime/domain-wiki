import { DOMParser, type Element } from "@xmldom/xmldom";
import { type OfficeContentNode, OfficeParser } from "officeparser";
import type { SourceLocator } from "@/server/db/schema";
import { officeFormat } from "../../lib/source-formats";
import {
  type ExtractedChunk,
  type ExtractionImage,
  type ExtractionResult,
  ParseFailure,
} from "./document";
import { prepareImage } from "./images";

const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
function descendants(e: Element, ns: string, name: string) {
  return Array.from(e.getElementsByTagNameNS(ns, name));
}
function plain(n: OfficeContentNode): string {
  return n.text ?? (n.children ?? []).map(plain).join("\n");
}
export async function parseOfficeDocument(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ExtractionResult> {
  const chunks: ExtractedChunk[] = [];
  const warnings = new Set<string>();
  const images: ExtractionImage[] = [];
  const imageLocations = new Map<string, SourceLocator>();
  const format = officeFormat[mimeType];
  function add(text: string, locator: SourceLocator) {
    for (const part of text.trim().match(/[\s\S]{1,1800}/g) ?? [])
      if (part.trim())
        chunks.push({ ordinal: chunks.length, text: part.trim(), locator });
    if (chunks.length > 5000)
      throw new ParseFailure(
        "추출 결과가 너무 큽니다. 문서를 나누어 등록해 주세요.",
      );
  }
  try {
    let partial = false;
    const ast = await OfficeParser.parseOffice(Buffer.from(bytes), {
      fileType: format,
      ocr: false,
      extractAttachments: true,
      includeRawContent: true,
      ignoreSlideMasters: true,
      decompressionLimits: {
        maxUncompressedBytes: 32 * 1024 * 1024,
        maxZipEntries: 3000,
        maxTableCells: 30000,
      },
      onWarning: () => {
        partial = true;
      },
    });
    const isPptx = mimeType.endsWith("presentationml.presentation");
    if (ast.type !== format)
      throw new ParseFailure("파일 확장자와 실제 Office 형식이 다릅니다.");
    let tableNumber = 0;
    function visit(
      nodes: OfficeContentNode[],
      path: string,
      section: string,
      slide?: number,
    ) {
      nodes.forEach((n, i) => {
        const block = `${path}${i + 1}`;
        const location: SourceLocator = slide
          ? { kind: "pptx", slide, section: "notes", paragraph: i + 1 }
          : format === "docx"
            ? { kind: "docx", block, section }
            : { kind: "document", format, block, section };
        if (n.type === "image" && n.metadata?.attachmentName)
          imageLocations.set(n.metadata.attachmentName, location);
        if (n.type === "table") {
          const table = ++tableNumber;
          const rows = n.children ?? [];
          const labels = new Map(
            (rows[0]?.children ?? []).map((cell, c) => [
              cell.type === "cell" ? (cell.metadata?.col ?? c) : c,
              plain(cell),
            ]),
          );
          rows.forEach((row, r) => {
            const cells = row.children ?? [];
            const text = cells
              .map((cell, c) => {
                const col =
                  cell.type === "cell" ? (cell.metadata?.col ?? c) : c;
                const span =
                  cell.type === "cell" ? (cell.metadata?.colSpan ?? 1) : 1;
                const rows =
                  cell.type === "cell" ? (cell.metadata?.rowSpan ?? 1) : 1;
                return `${col + 1}열${r > 0 && labels.get(col) ? `(${labels.get(col)})` : ""}${span > 1 || rows > 1 ? `[${rows}행×${span}열 병합]` : ""}: ${plain(cell)}`;
              })
              .join(" | ");
            add(text, { ...location, table, row: r + 1 });
          });
          warnings.add(
            "표의 행·열을 함께 추출했습니다. 병합 셀·중첩 표는 원문의 배열을 대조해 주세요.",
          );
        } else if (n.type === "image" || n.type === "chart") {
          warnings.add(
            "문서에 이미지 또는 차트가 있습니다. 추출한 이미지와 원본을 함께 확인해 주세요.",
          );
        } else if (
          n.type === "paragraph" ||
          n.type === "heading" ||
          n.type === "list" ||
          n.type === "text"
        ) {
          add(plain(n), location);
          // Embedded images are inspected even when their paragraph has text.
          if (n.rawContent && /<(?:\w+:)?(?:drawing|pict)\b/.test(n.rawContent))
            warnings.add(
              "본문에 그림이 있습니다. 그림 속 글자는 원문에서 확인해 주세요.",
            );
        } else if (n.children)
          visit(
            n.children,
            `${block}.`,
            n.type === "header"
              ? "머리말"
              : n.type === "footer"
                ? "꼬리말"
                : section,
            slide,
          );
        if (n.notes) visit(n.notes, `${block}.n`, "각주·미주", slide);
        if (n.comments?.length)
          warnings.add(
            "검토 댓글은 본문 근거에 포함하지 않았습니다. 원문에서 별도로 확인해 주세요.",
          );
      });
    }
    if (["xlsx", "ods", "csv"].includes(format)) {
      const sheets = ast.content.some((n) => n.type === "sheet")
        ? ast.content
        : [
            {
              type: "sheet" as const,
              metadata: { sheetName: "표" },
              children: ast.content,
            },
          ];
      for (const sheet of sheets) {
        const sheetName =
          sheet.type === "sheet" ? (sheet.metadata?.sheetName ?? "표") : "표";
        const visitRows = (nodes: OfficeContentNode[]) => {
          for (const node of nodes) {
            if (node.type === "row") {
              const cells = node.children ?? [];
              const row = (
                cells.find((c) => c.type === "cell")?.metadata as
                  | { row?: number }
                  | undefined
              )?.row;
              const rowIndex = typeof row === "number" ? row + 1 : 1;
              add(
                cells
                  .map(
                    (c, i) =>
                      `${c.type === "cell" ? (c.metadata?.col ?? i) + 1 : i + 1}열: ${plain(c)}`,
                  )
                  .join(" | "),
                { kind: "spreadsheet", sheet: sheetName, row: rowIndex },
              );
            } else if (node.children) visitRows(node.children);
          }
        };
        visitRows(sheet.children ?? []);
      }
      warnings.add(
        "시트별 셀 값을 행·열과 함께 보관했습니다. 수식은 실행하지 않으며 파일에 저장된 결과를 확인합니다.",
      );
    } else if (isPptx) {
      const slides = ast.content.filter((n) => n.type === "slide");
      if (slides.length > 300)
        throw new ParseFailure("PPTX는 300장 이하로 나누어 등록해 주세요.");
      slides.forEach((slide, index) => {
        const number = slide.metadata?.slideNumber ?? index + 1;
        if (!slide.rawContent || /<!DOCTYPE|<!ENTITY/i.test(slide.rawContent))
          throw new ParseFailure("슬라이드 구조를 확인할 수 없습니다.");
        const doc = new DOMParser({
          onError: () => {
            throw new Error("XML");
          },
        }).parseFromString(slide.rawContent, "application/xml");
        const root = doc.documentElement;
        if (!root) throw new ParseFailure("슬라이드 구조가 비어 있습니다.");
        for (const shape of [
          ...descendants(root, P, "sp"),
          ...descendants(root, P, "graphicFrame"),
        ]) {
          const props = descendants(shape, P, "cNvPr")[0];
          const off = descendants(shape, A, "off")[0];
          const x = Number(off?.getAttribute("x"));
          const y = Number(off?.getAttribute("y"));
          const location: SourceLocator = {
            kind: "pptx",
            slide: number,
            section: "body",
            ...(props?.getAttribute("id")
              ? { shapeId: props.getAttribute("id") ?? "" }
              : {}),
            ...(off && Number.isFinite(x) && Number.isFinite(y)
              ? { x, y }
              : {}),
          };
          const tables = descendants(shape, A, "tbl");
          if (tables.length)
            tables.forEach((table, t) => {
              const rows = descendants(table, A, "tr");
              const cellText = (cell: Element) =>
                descendants(cell, A, "t")
                  .map((t) => t.textContent ?? "")
                  .join(" ");
              const labels = rows[0]
                ? descendants(rows[0], A, "tc").map(cellText)
                : [];
              rows.forEach((row, r) => {
                add(
                  descendants(row, A, "tc")
                    .map(
                      (c, i) =>
                        `${i + 1}열${r > 0 && labels[i] ? `(${labels[i]})` : ""}: ${cellText(c)}`,
                    )
                    .join(" | "),
                  { ...location, table: t + 1, row: r + 1 },
                );
              });
            });
          else
            descendants(shape, A, "p").forEach((p, i) => {
              add(
                descendants(p, A, "t")
                  .map((t) => t.textContent ?? "")
                  .join(""),
                { ...location, paragraph: i + 1 },
              );
            });
        }
        if (slide.notes) visit(slide.notes, "", "발표자 노트", number);
        if (
          descendants(root, P, "pic").length ||
          descendants(root, A, "graphicData").length
        )
          warnings.add(
            "슬라이드의 이미지·차트·도형 배열은 원문을 함께 확인해 주세요. 그림 속 문자·구조는 원본과 대조해 주세요.",
          );
        if (descendants(root, P, "grpSp").length)
          warnings.add(
            "묶음 도형의 위치는 상위 도형을 기준으로 한 좌표입니다. 실제 배치는 원문에서 확인해 주세요.",
          );
      });
    } else visit(ast.content, "", "본문");
    for (const attachment of ast.attachments ?? []) {
      if (attachment.type === "chart" && attachment.chartData) {
        const chart = attachment.chartData;
        add(
          [
            chart.title ?? "차트",
            ...chart.labels,
            ...chart.dataSets.map(
              (set) => `${set.name ?? "계열"}: ${set.values.join(", ")}`,
            ),
          ].join("\n"),
          {
            kind: "document",
            format,
            block: attachment.name,
            section: "차트 데이터",
          },
        );
      }
      if (!attachment.data || !attachment.mimeType?.startsWith("image/"))
        continue;
      if (images.length >= 500)
        throw new ParseFailure(
          "문서 이미지가 500개를 넘습니다. 문서를 나누어 주세요.",
        );
      try {
        const key = `image-${images.length + 1}`;
        const image = await prepareImage(
          Buffer.from(attachment.data, "base64"),
          {
            key,
            name: attachment.name,
            locator: imageLocations.get(attachment.name) ?? {
              kind: "image",
              image: images.length + 1,
            },
          },
        );
        images.push(image);
        add(`![문서 이미지 ${images.length}](asset://${key})`, image.locator);
      } catch {
        warnings.add(
          `이미지 ${attachment.name}의 미리보기를 만들지 못했습니다. 원본 문서에서 확인해 주세요.`,
        );
      }
    }
    if (partial)
      throw new ParseFailure(
        "Office 문서 일부를 완전하게 읽지 못했습니다. 문서를 확인하거나 나누어 다시 등록해 주세요.",
      );
    warnings.add(
      isPptx
        ? "슬라이드 본문과 발표자 노트를 구분했습니다. 애니메이션·숨김 요소·연결선의 의미는 원문에서 확인해 주세요."
        : "Word의 문서 블록·표 행을 기록했습니다. 쪽 번호는 문서를 여는 환경에 따라 달라질 수 있어 표시하지 않습니다.",
    );
    return {
      chunks,
      parserVersion: "officeparser@7.8.0/located-v1",
      warnings: [...warnings],
      images,
    };
  } catch (error) {
    if (error instanceof ParseFailure) throw error;
    throw new ParseFailure(
      "Office 문서를 읽을 수 없습니다. 손상·암호 설정·파일 형식·문서 크기를 확인해 주세요.",
    );
  }
}
