import type { WikiCandidate, WikiPagePlan } from "./wiki-generation";

const canonical = (name: string) =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
const names = (page: { title: string; aliases: string[] }) =>
  new Set([page.title, ...page.aliases].map(canonical).filter(Boolean));

// A name collision is a reason to review identity, never proof that two facts
// should be merged. Source summaries intentionally remain per-source artifacts.
export function validateTopicIdentity(
  pages: WikiPagePlan[],
  candidates: WikiCandidate[],
  projectId: string | null,
) {
  for (const page of pages) {
    if (page.kind !== "new" || page.type === "source") continue;
    const incoming = names(page);
    const overlaps = (other: { title: string; aliases: string[] }) =>
      [...names(other)].some((name) => incoming.has(name));
    const existing = candidates.find(
      (candidate) =>
        candidate.projectId === projectId &&
        candidate.metadata.type === page.type &&
        overlaps({
          title: candidate.title,
          aliases: candidate.metadata.aliases,
        }),
    );
    if (existing)
      throw new Error(
        `같은 범위에 제목·별칭이 겹치는 주제 위키가 있습니다: ${existing.title}. 동일한 대상이면 기존 페이지의 수정·충돌 계획으로 연결하고, 다른 대상이면 제목과 범위를 구분해 주세요.`,
      );
    if (
      pages.some(
        (other) =>
          other !== page && other.type === page.type && overlaps(other),
      )
    )
      throw new Error(
        "한 계획 안에 제목·별칭이 겹치는 주제 위키가 있습니다. 같은 대상은 하나의 페이지로 정리하고 다른 대상은 제목을 구분해 주세요.",
      );
  }
}
