import Link from "next/link";
import type { PageResult } from "@/lib/pagination";

export function ListPagination({
  result,
  base,
  values,
}: {
  result: Omit<PageResult<unknown>, "items">;
  base: string;
  values: Record<string, string | undefined>;
}) {
  const href = (page: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      if (value !== undefined && key !== "page") query.set(key, value);
    query.set("page", String(page));
    return `${base}?${query}`;
  };
  return (
    <nav className="list-pagination" aria-label="목록 페이지">
      <span>
        전체 {result.total}개 · {result.page} / {result.totalPages}페이지
      </span>
      <div>
        {result.page > 1 && <Link href={href(result.page - 1)}>← 이전</Link>}
        {result.page < result.totalPages && (
          <Link href={href(result.page + 1)}>다음 →</Link>
        )}
      </div>
    </nav>
  );
}
