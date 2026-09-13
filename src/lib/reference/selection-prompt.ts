// Extracted from llm_wiki src/components/editor/wiki-editor.tsx (GPL-3.0).
import type { TextSelectionSnapshot } from "./selection-edit";
export function buildSelectionPrompt(
  intent: "ask" | "edit",
  filePath: string,
  instruction: string,
  selection: TextSelectionSnapshot & { sourceMapped: boolean },
  references: { title: string; path: string; snippet: string }[],
) {
  const retrievedContext =
    references.length > 0
      ? references
          .map(
            (reference, index) =>
              `[${index + 1}] ${reference.title}\nPath: ${reference.path}\n${reference.snippet}`,
          )
          .join("\n\n")
      : "No additional knowledge-base results were retrieved.";
  return [
    intent === "edit"
      ? "Edit the selected text according to the user's instruction. Return only the replacement text without explanation or an outer Markdown fence."
      : "Answer the user's instruction about the selected text. Use the nearby text only as supporting context.",
    `File: ${filePath}`,
    `Instruction: ${instruction}`,
    "Context before selection:",
    selection.sourceMapped
      ? selection.prefix.slice(-1200)
      : "Unavailable because the rendered selection could not be mapped safely to one source range.",
    "<selected_text>",
    selection.selectedText,
    "</selected_text>",
    "Context after selection:",
    selection.sourceMapped
      ? selection.suffix.slice(0, 1200)
      : "Unavailable because the rendered selection could not be mapped safely to one source range.",
    "Knowledge-base context:",
    retrievedContext,
    "When knowledge-base context supports the answer, cite it using [1], [2], and so on. Do not invent citations.",
  ].join("\n\n");
}
