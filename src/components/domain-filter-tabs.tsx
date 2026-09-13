import Link from "next/link";

export function DomainFilterTabs({
  domains,
  base,
  values,
}: {
  domains: { id: string; name: string }[];
  base: string;
  values: {
    domainId?: string;
    q?: string;
    kind?: string;
    mode?: string;
    status?: string;
    mine?: string;
  };
}) {
  const items = [{ id: "", name: "전체" }, ...domains];
  return (
    <nav className="domain-tabs" aria-label="자료 도메인 분류">
      {items.map((item) => {
        const query = new URLSearchParams();
        if (item.id) query.set("domainId", item.id);
        if (values.q !== undefined) query.set("q", values.q);
        if (values.kind) query.set("kind", values.kind);
        for (const key of ["mode", "status", "mine"] as const)
          if (values[key]) query.set(key, values[key]);
        return (
          <Link
            key={item.id}
            href={`${base}${query.size ? `?${query}` : ""}`}
            aria-current={
              (values.domainId ?? "") === item.id ? "page" : undefined
            }
          >
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}
