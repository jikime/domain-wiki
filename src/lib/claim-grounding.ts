import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { AnalysisClaim } from "./document-analysis";

type Node = {
  type: string;
  value?: string;
  depth?: number;
  children?: Node[];
};
const parser = unified().use(remarkParse).use(remarkGfm);
const plain = (node: Node): string =>
  node.value ??
  (node.children ?? []).map(plain).join(node.type === "tableRow" ? " | " : "");
const normalize = (text: string) =>
  text
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "")
    .replace(/\s+/g, " ")
    .trim();
const escapePattern = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Read rendered text, not link URLs or formatting markers. A table row is a
// separate assertion boundary; heading context cannot cross sibling sections.
export function groundingBlocks(markdown: string, heading = "") {
  const blocks: { text: string; heading: string }[] = [];
  const headings: string[] = [heading];
  const visit = (node: Node) => {
    if (node.type === "heading") {
      headings.length = node.depth ?? 1;
      headings[node.depth ?? 1] = plain(node);
      return;
    }
    if (["paragraph", "tableRow", "code"].includes(node.type)) {
      blocks.push({
        text: plain(node),
        heading: headings.filter(Boolean).join(" / "),
      });
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(parser.parse(markdown) as Node);
  return blocks;
}

function subjectWindows(text: string, subjects: string[]) {
  const pattern = new RegExp(subjects.map(escapePattern).join("|"), "g");
  const hits = [...text.matchAll(pattern)];
  return hits.map((hit, i) => ({
    subject: hit[0],
    text: text.slice(
      i === 0 ? 0 : hit.index,
      hits[i + 1]?.index ?? text.length,
    ),
  }));
}

/**
 * Conservative lexical guard, not a semantic entailment proof. Numeric claims
 * must bind their explicit subject/value/unit in the same sentence or table row.
 * Ambiguous collective statements should be rewritten as separate assertions.
 */
export function validateClaimBindings(
  markdown: string,
  claims: AnalysisClaim[],
  heading = "",
) {
  const numeric = claims.filter(
    (c) =>
      c.subject &&
      c.value &&
      c.unit &&
      /^[+-]?\d+(?:\.\d+)?$/.test(normalize(c.value)),
  );
  if (!numeric.length) return;
  const subjects = [
    ...new Set(claims.map((c) => c.subject).filter(Boolean)),
  ].sort((a, b) => b.length - a.length);
  const windows: { subject: string; text: string }[] = [];
  for (const block of groundingBlocks(markdown, heading)) {
    // Never split a decimal at its dot. Soft line breaks remain in a sentence.
    for (const sentence of normalize(block.text).split(
      /(?<=[.!?。！？])\s+/u,
    )) {
      const explicit = subjectWindows(sentence, subjects);
      if (explicit.length) windows.push(...explicit);
      else {
        // Only the closest heading with exactly one subject can supply context.
        const nearest = block.heading
          .split(" / ")
          .reverse()
          .find((h) => subjectWindows(h, subjects).length);
        const inherited = nearest ? subjectWindows(nearest, subjects) : [];
        if (inherited.length === 1)
          windows.push({ subject: inherited[0].subject, text: sentence });
      }
    }
  }
  for (const fact of numeric) {
    const value = normalize(fact.value as string);
    const unit = fact.unit as string;
    const pattern = new RegExp(
      `(?<![\\d.+-])${escapePattern(value)}\\s*${escapePattern(unit)}(?![A-Za-z])`,
    );
    const matching = windows.filter(
      (w) => w.subject === fact.subject && pattern.test(w.text),
    );
    if (!matching.length)
      throw new Error(
        `대상과 수치의 대응을 확인하지 못했습니다: ${fact.subject} — ${value}${unit}. 대상과 값을 같은 문장이나 표의 행에 명시해 주세요.`,
      );
    // A condition elsewhere in the paragraph cannot justify this numeric fact.
    if (
      fact.condition &&
      !matching.some((w) =>
        w.text.includes(normalize(fact.condition as string)),
      )
    )
      throw new Error(
        `수치에 적용되는 조건이 같은 문장에서 확인되지 않습니다: ${fact.subject}.`,
      );
  }
  for (const subject of new Set(numeric.map((c) => c.subject))) {
    const own = numeric.filter((c) => c.subject === subject);
    for (const unit of new Set(own.map((c) => c.unit as string))) {
      const allowed = new Set(
        own
          .filter((c) => c.unit === unit)
          .map((c) => normalize(c.value as string)),
      );
      const pattern = new RegExp(
        `(?<![\\d.+-])([+-]?\\d+(?:\\.\\d+)?)\\s*${escapePattern(unit)}(?![A-Za-z])`,
        "g",
      );
      for (const window of windows.filter((w) => w.subject === subject)) {
        for (const match of window.text.matchAll(pattern)) {
          if (!allowed.has(match[1]))
            throw new Error(
              `다른 대상의 수치가 연결되었거나 근거에 없는 값입니다: ${subject} — ${match[1]}${unit}.`,
            );
        }
      }
    }
  }
}

/** After free-text merging, do not trust checks of the pre-merge sections. */
export function validateMergedGrounding(
  body: string,
  sections: { content: string }[],
  claims: AnalysisClaim[],
  previousBodies: string[],
) {
  const finalBlocks = groundingBlocks(body).map((b) => normalize(b.text));
  const protectedBlocks = [
    ...sections.flatMap((s) => groundingBlocks(s.content).map((b) => b.text)),
    ...previousBodies.flatMap((old) =>
      groundingBlocks(old)
        .map((b) => b.text)
        .filter((text) =>
          /\d|않|금지|불가|제외|없|해야|필수|미정|불확실/.test(text),
        ),
    ),
  ];
  // Permit reordered blocks, formatting changes and identical deduplication.
  // Factual rewrites require a review rather than silently weakening evidence.
  if (
    protectedBlocks.some(
      (block) => !finalBlocks.some((text) => text.includes(normalize(block))),
    )
  )
    throw new Error(
      "병합 후 검증된 문장·기존 수치·조건이 변경되거나 빠졌습니다. 원문과 변경 전 본문을 대조해 주세요.",
    );
  validateClaimBindings(body, claims);
}
