import "server-only";
import { z } from "zod";
import { validateMergedGrounding } from "@/lib/claim-grounding";
import { parseFrontmatter } from "@/lib/reference/frontmatter";
import { mergePageContent } from "@/lib/reference/page-merge";
import { buildPageMergeSystemPrompt } from "@/lib/reference/page-merge-prompt";
import {
  type GeneratedSections,
  type GenerationClaim,
  generationMessages,
  type WikiCandidate,
} from "@/lib/wiki-generation";
import { AccessError } from "@/server/errors";
import type { TaskExecution } from "./task-execution";

function document(
  title: string,
  type: string,
  body: string,
  sources: string[],
  related: string[],
) {
  return `---\ntitle: ${JSON.stringify(title)}\ntype: ${JSON.stringify(type)}\nsources: ${JSON.stringify(sources)}\nrelated: ${JSON.stringify(related)}\n---\n\n${body}`;
}
export async function mergeGeneratedWiki(input: {
  run: TaskExecution;
  ordinal: number;
  incoming: string;
  title: string;
  type: string;
  sourceId: string;
  existing: WikiCandidate[];
  reuse: boolean;
  sections: GeneratedSections["sections"];
  claims: GenerationClaim[];
}) {
  const { run, existing, incoming } = input;
  const first = existing[0];
  const check = (body: string, preservePrevious: boolean) =>
    validateMergedGrounding(
      body,
      input.sections,
      input.claims,
      preservePrevious ? existing.map((page) => page.body) : [],
    );
  const saved = await run.step(input.ordinal);
  if (saved.state === "completed" && saved.result?.mergedBody) {
    const cached = z
      .object({
        mergedBody: z.string(),
        fallback: z.boolean(),
        replaced: z.boolean(),
      })
      .parse(saved.result);
    // Retry/cache paths must enforce today's validation too.
    try {
      check(cached.mergedBody, !cached.fallback && !cached.replaced);
      return cached;
    } catch {
      check(incoming, false);
      const result = { mergedBody: incoming, fallback: true, replaced: false };
      await run.guard((await import("@/server/db")).getDb());
      await run.save(input.ordinal, result);
      return result;
    }
  }
  if (input.reuse) {
    check(first.body, false);
    const result = { mergedBody: first.body, fallback: false, replaced: false };
    await run.save(input.ordinal, result);
    return result;
  }
  const previousBody = existing
    .map((page, i) => (i ? `## ${page.title}\n\n${page.body}` : page.body))
    .join("\n\n");
  const sourceIds = [
    ...new Set(existing.flatMap((page) => page.sourceIds ?? [])),
  ];
  const replaced =
    existing.length === 1 &&
    sourceIds.length === 1 &&
    sourceIds[0] === input.sourceId;
  const oldDoc = document(
    first.title,
    first.metadata.type,
    previousBody,
    sourceIds,
    existing.flatMap((p) => p.metadata.links.map((l) => l.pageId)),
  );
  const newDoc = document(
    input.title,
    input.type,
    incoming,
    [input.sourceId],
    [],
  );
  let fallback = false;
  const merged = await mergePageContent(
    newDoc,
    oldDoc,
    async (oldContent, newContent, sourceFileName) => {
      const messages = generationMessages(
        `${buildPageMergeSystemPrompt()}\n\n전송 형식: 위의 COMPLETE file 내용을 content 문자열에 넣은 JSON {"content":"---\\n..."} 하나를 반환하세요. 한국어 본문을 유지하세요. 검증된 새 문장과 기존 수치·조건 문장은 고치거나 생략하지 마세요. 중복 제거·순서 조정·제목 구성으로 통합하고 사실 문장을 새로 바꾸지 마세요.`,
        {
          sourceFileName,
          existingContent: oldContent,
          incomingContent: newContent,
        },
      );
      const result = await run.model(input.ordinal, messages, (raw) => {
        const value = z
          .object({ content: z.string().min(1).max(200000) })
          .parse(raw);
        check(parseFrontmatter(value.content).body, true);
        return value;
      });
      return result.content;
    },
    {
      sourceFileName: input.sourceId,
      pagePath: `wiki/${first.pageId}.md`,
      signal: run.signal,
      replaceExistingBody: replaced,
      // The existing immutable DB version is the upstream recovery snapshot.
      backup: async () => {
        fallback = !replaced;
      },
    },
  );
  run.signal.throwIfAborted();
  await run.guard((await import("@/server/db")).getDb());
  const parsed = parseFrontmatter(merged);
  if (!parsed.body.trim())
    throw new AccessError(502, "병합한 위키 본문이 비어 있습니다.");
  let mergedBody = parsed.body.trim();
  try {
    check(mergedBody, !fallback && !replaced);
  } catch {
    // Keep the validated incoming draft and require explicit conflict resolution.
    // The existing published version remains untouched.
    check(incoming, false);
    mergedBody = incoming;
    fallback = true;
  }
  const result = { mergedBody, fallback, replaced };
  await run.save(input.ordinal, result);
  return result;
}
