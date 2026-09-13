// Ported from llm_wiki 8bcf9b5. Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
export const CAPTION_PROMPT =
  "Describe this image factually for a knowledge-base index. Include: any visible text verbatim, chart axes and values, diagram structure (boxes/arrows/labels), key visual elements. Do NOT speculate or editorialize. 2 to 4 sentences. Output plain text only — no markdown, no preamble.";

function captionLanguageInstruction(outputLanguage?: string): string {
  const language = outputLanguage?.trim();
  if (!language || language.toLowerCase() === "auto") return "";
  return `Write the description in ${language}. Preserve visible text verbatim in its original language.`;
}

/**
 * Build the prompt that gets used WHEN the caller supplies
 * surrounding text. Wraps the no-context prompt with an explicit
 * "here is the document text around this image — it may or may
 * not be related, you decide" frame.
 *
 * Empty / whitespace-only sides collapse to "(none)" rather than
 * leaving an empty delimited block, which some models try to
 * interpret as silence-is-meaningful and produce odd captions
 * about. The brackets stay so the structure is uniform.
 */
export function buildCaptionPromptWithContext(
  before: string,
  after: string,
  outputLanguage?: string,
): string {
  const fmt = (s: string) => {
    const trimmed = s.trim();
    return trimmed.length > 0 ? trimmed : "(none)";
  };
  return [
    "The image is embedded in a longer document. Here is the text that appears IMMEDIATELY BEFORE and AFTER this image in the source:",
    "",
    "--- Text before image ---",
    fmt(before),
    "--- Text after image ---",
    fmt(after),
    "--- End surrounding text ---",
    "",
    'This surrounding text MAY help describe the image — for example, a sentence like "Figure 3: Q2 revenue chart" tells you what the chart actually plots. It MAY ALSO be unrelated body text that just happens to flank the image. Use your judgment: if a passage clearly identifies, references, or labels the image, anchor your caption to it; if not, ignore the surrounding text and describe what you see.',
    "",
    "Now describe the image factually for a knowledge-base index. Include: any visible text verbatim, chart axes and values, diagram structure (boxes/arrows/labels), key visual elements. If the surrounding text contains a relevant figure number / caption / referent, incorporate that specifically. Do NOT invent details that aren't visible in the image or directly stated in the surrounding text. 2 to 4 sentences. Output plain text only — no markdown, no preamble.",
    captionLanguageInstruction(outputLanguage),
  ]
    .filter(Boolean)
    .join("\n");
}
