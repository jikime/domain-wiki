import { headers } from "next/headers";
import Link from "next/link";
import { DomainFilterTabs } from "@/components/domain-filter-tabs";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { contentPage } from "@/server/page-access";
import { workspaceData } from "@/server/services/workspace";
export default async function ProjectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ q?: string; domainId?: string }>;
}) {
  const { workspaceId } = await params;
  const q = await searchParams;
  const { projects, domains } = await contentPage(async () =>
    workspaceData(await headers(), workspaceId),
  );
  const query = (q.q ?? "").slice(0, 150).toLowerCase();
  const items = projects.filter(
    (p) =>
      (!q.domainId || p.domainId === q.domainId) &&
      `${p.clientName} ${p.name}`.toLowerCase().includes(query),
  );
  const base = `/w/${workspaceId}`;
  return (
    <>
      <Link className="back-link" href={base}>
        ← 업무 홈
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">사업별 지식 찾기</span>
          <h1>발주처·프로젝트</h1>
          <p>
            프로젝트의 공개 자료와 같은 도메인의 공통 지식을 함께 살펴봅니다.
          </p>
        </div>
      </div>
      <DomainFilterTabs
        domains={domains}
        base={`${base}/projects`}
        values={q}
      />
      <div className="list-toolbar">
        <p>
          프로젝트 <strong>{items.length}</strong>개
        </p>
      </div>
      <form className="panel form-stack" action={`${base}/projects`}>
        <Field>
          <FieldLabel htmlFor="project-search">
            발주처 또는 프로젝트 이름
          </FieldLabel>
          <Input
            id="project-search"
            name="q"
            maxLength={150}
            defaultValue={q.q ?? ""}
          />
        </Field>
        {q.domainId && (
          <Input type="hidden" name="domainId" value={q.domainId} />
        )}
        <Button type="submit">찾기</Button>
      </form>
      <div className="quick-grid">
        {items.map((p) => (
          <Link
            className="quick-card"
            href={`${base}/projects/${p.id}`}
            key={p.id}
          >
            <span className="eyebrow">{p.clientName}</span>
            <h2>{p.name}</h2>
            <p>{p.description}</p>
            <span className="field-help">
              {domains.find((d) => d.id === p.domainId)?.name} →
            </span>
          </Link>
        ))}
      </div>
      {!items.length && (
        <p className="panel empty-copy">조건에 맞는 프로젝트가 없습니다.</p>
      )}
    </>
  );
}
