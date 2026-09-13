import { locatorLabel } from "@/lib/content";
import type { SearchResult } from "@/server/services/search";

export { SearchForm } from "./content-search-form";
export function SearchResults({ items }: { items: SearchResult[] }) {
  return (
    <div className="search-results">
      {items.map((item) => (
        <a
          href={item.href}
          key={item.chunkId ?? item.versionId}
          className="result-row"
        >
          <span className="small-tag">
            {item.category === "testimony"
              ? "작성자 진술"
              : item.kind === "source"
                ? "공개 원문"
                : "게시 위키"}
          </span>
          <h3>{item.title}</h3>
          <p>{item.excerpt}</p>
          <span className="field-help">
            {item.locator ? locatorLabel(item.locator) : "게시된 본문"} →
          </span>
        </a>
      ))}
      {!items.length && (
        <div className="panel empty-copy">
          조건에 맞는 게시 위키·공개 자료가 없습니다. 검토 대기 자료와 초안은
          검색에 포함하지 않습니다.
        </div>
      )}
    </div>
  );
}
export function Decisions({
  items,
}: {
  items: { action: string; note: string; createdAt: Date }[];
}) {
  const names: Record<string, string> = {
    approve: "승인",
    reject: "반려",
    withdraw: "철회",
    submit: "검토 제출",
    retry: "처리 재시도",
    cancel: "처리 취소",
  };
  return items.length ? (
    <section className="panel">
      <h2 className="content-subtitle">처리 이력</h2>
      {items.map((item, index) => (
        <div
          className="decision-row"
          key={`${item.createdAt.toISOString()}-${index}`}
        >
          <strong>{names[item.action] ?? item.action}</strong>
          <span>
            {item.createdAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
          </span>
          {item.note && <p>{item.note}</p>}
        </div>
      ))}
    </section>
  ) : null;
}
