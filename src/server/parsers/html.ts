import { load } from "cheerio";
import type { OfficialAttachment } from "@/server/db/schema";
import { type ExtractionResult, ParseFailure } from "./document";

export function htmlDocument(
  bytes: Uint8Array,
  address = "https://invalid.example/",
) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ParseFailure(
      "웹 원문은 UTF-8 HTML만 지원합니다. 첨부 원본을 직접 등록해 주세요.",
    );
  }
  if (!/<(?:!doctype|html|body|article|main|p|h[1-6]|div|table)\b/i.test(text))
    throw new ParseFailure("HTML 원문을 확인할 수 없습니다.");
  const $ = load(text);
  const title = $("title").first().text().trim().slice(0, 160);
  const publishedHint =
    $(
      "meta[property='article:published_time'],meta[name='date'],meta[name='DC.date']",
    )
      .first()
      .attr("content")
      ?.slice(0, 100) ??
    $("time[datetime]").first().attr("datetime")?.slice(0, 100) ??
    null;
  const attachments: OfficialAttachment[] = [];
  $("a[href]").each((_, node) => {
    try {
      const url = new URL($(node).attr("href") ?? "", address);
      if (
        !/^https?:$/.test(url.protocol) ||
        !/\.(pdf|docx|pptx|hwp|hwpx|xlsx|zip)(?:$|[?&#])/i.test(url.href)
      )
        return;
      if (
        !attachments.some((a) => a.url === url.href) &&
        attachments.length < 50
      )
        attachments.push({
          url: url.href,
          title:
            $(node).text().replace(/\s+/g, " ").trim().slice(0, 160) ||
            "첨부 자료",
          supported: /\.(pdf|docx|pptx)(?:$|[?&#])/i.test(url.href),
        });
    } catch {
      /* 잘못된 외부 링크는 후보에서 제외합니다. */
    }
  });
  $(
    "script,style,noscript,template,iframe,svg,canvas,nav,header,footer,form,[hidden],[aria-hidden='true']",
  ).remove();
  const root = $("main,article").first().length
    ? $("main,article").first()
    : $("body");
  const chunks: ExtractionResult["chunks"] = [];
  let heading = title;
  let block = 0;
  let table = 0;
  root.find("h1,h2,h3,h4,h5,h6,p,li,dt,dd,blockquote,table").each((_, node) => {
    const el = $(node);
    if (
      el.parents("table").length ||
      (el.is("p") && el.parents("li,blockquote").length)
    )
      return;
    block++;
    if (el.is("table")) {
      table++;
      const labels = el
        .find("tr")
        .first()
        .children("th,td")
        .map((_, cell) => $(cell).text().replace(/\s+/g, " ").trim())
        .get();
      el.find("tr").each((r, row) => {
        const line = $(row)
          .children("th,td")
          .map(
            (c, cell) =>
              `${c + 1}열${r > 0 && labels[c] ? `(${labels[c]})` : ""}: ${$(cell).text().replace(/\s+/g, " ").trim()}`,
          )
          .get()
          .join(" | ");
        for (const part of line.match(/[\s\S]{1,1800}/g) ?? [])
          chunks.push({
            ordinal: chunks.length,
            text: part,
            locator: { kind: "html", block, heading, table, row: r + 1 },
          });
      });
    } else {
      const line = el.text().replace(/\s+/g, " ").trim();
      if (/^h[1-6]$/.test(el.prop("tagName")?.toLowerCase() ?? ""))
        heading = line.slice(0, 200);
      for (const part of line.match(/[\s\S]{1,1800}/g) ?? [])
        chunks.push({
          ordinal: chunks.length,
          text: part,
          locator: { kind: "html", block, heading },
        });
    }
  });
  if (!chunks.length) {
    const plain = root.text().replace(/\s+/g, " ").trim();
    for (const part of plain.match(/[\s\S]{1,1800}/g) ?? [])
      chunks.push({
        ordinal: chunks.length,
        text: part,
        locator: { kind: "html", block: 1, heading: title },
      });
  }
  if (!chunks.length)
    throw new ParseFailure(
      "읽을 웹 본문이 없습니다. 동적 페이지 또는 첨부 원본을 확인하세요.",
    );
  return {
    title,
    publishedHint,
    attachments,
    chunks,
    parserVersion: "cheerio@1.2.0/html-blocks-v1",
    warnings: [
      "수집 당시 HTML의 본문·표를 추출했습니다. 동적 화면·이미지·병합 셀·발행/시행일은 원문과 직접 대조해 주세요.",
    ],
  };
}
