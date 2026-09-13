"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { DraftNotice, useDraft } from "@/components/draft-controls";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { locatorLabel } from "@/lib/content";
import { wikiDraft } from "@/lib/drafts";
import { type WikiMetadata, wikiTypesForSchema } from "@/lib/wiki-metadata";
import type { SearchResult } from "@/server/services/search";

type Initial = {
  pageId: string;
  title: string;
  body: string;
  domainId: string;
  projectId: string | null;
  parentVersionId: string | null;
  basePublishedVersionId: string | null;
  evidence: SearchResult[];
  metadata?: WikiMetadata;
  versionId: string;
  linkDestinations?: Record<string, string>;
};
export function WikiEditor({
  workspaceId,
  domains,
  projects,
  initial,
}: {
  workspaceId: string;
  domains: { id: string; name: string; schemaMarkdown?: string }[];
  projects: { id: string; domainId: string; name: string }[];
  initial?: Initial;
}) {
  const router = useRouter();
  const formId = useId();
  const [domainId, setDomainId] = useState(
    initial?.domainId ?? domains[0]?.id ?? "",
  );
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [wikiType, setWikiType] = useState<WikiMetadata["type"]>(
    initial?.metadata?.type ?? "other",
  );
  const [aliases, setAliases] = useState(
    initial?.metadata?.aliases.join(", ") ?? "",
  );
  const [evidence, setEvidence] = useState<SearchResult[]>(
    initial?.evidence ?? [],
  );
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [searchError, setSearchError] = useState("");
  const draft = useDraft({
    id: `${workspaceId}:wiki:${initial?.pageId ?? "new"}:${initial?.parentVersionId ?? "new"}`,
    value: { domainId, projectId, title, body, evidence, wikiType, aliases },
    schema: wikiDraft,
    restore: (value) => {
      setDomainId(value.domainId);
      setProjectId(value.projectId);
      setTitle(value.title);
      setBody(value.body);
      setEvidence(value.evidence);
      setWikiType(value.wikiType);
      setAliases(value.aliases);
    },
  });
  useEffect(() => {
    if (!domainId) return;
    const controller = new AbortController();
    setSearchError("");
    const query = new URLSearchParams({ kind: "source", domainId, q: search });
    if (projectId) query.set("projectId", projectId);
    fetch(`/api/workspaces/${workspaceId}/search?${query}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("검색 실패");
        return response.json();
      })
      .then((data: SearchResult[]) => {
        setResults(data.filter((item) => projectId || item.projectId === null));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setSearchError("근거를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [workspaceId, domainId, projectId, search]);
  return (
    <form
      className="form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setMessage("");
        try {
          const response = await fetch(
            `/api/workspaces/${workspaceId}/wiki${initial ? `/${initial.pageId}` : ""}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title,
                body,
                classification: {
                  type: wikiType,
                  aliases: [
                    ...new Set(
                      aliases
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    ),
                  ],
                },
                domainId,
                projectId: projectId || null,
                parentVersionId: initial?.parentVersionId ?? null,
                basePublishedVersionId: initial?.basePublishedVersionId ?? null,
                chunkIds: evidence.map((item) => item.chunkId),
              }),
            },
          );
          const result = await response.json();
          if (!response.ok) {
            setMessage(result.error);
            return;
          }
          draft.clear();
          router.push(
            `/w/${workspaceId}/wiki/${result.pageId}?version=${result.versionId}`,
          );
          router.refresh();
        } catch {
          setMessage(
            "저장 결과를 확인하지 못했습니다. 위키 목록에서 최신 버전을 확인해 주세요.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <DraftNotice draft={draft} />
      <FieldSet disabled={pending} inert={pending}>
        <Field>
          <FieldLabel htmlFor={`${formId}-title`}>위키 제목</FieldLabel>
          <Input
            id={`${formId}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={160}
          />
        </Field>
        <div className="field-grid">
          <Field>
            <FieldLabel htmlFor={`${formId}-domain`}>업무 도메인</FieldLabel>
            <Select
              value={domainId}
              disabled={pending || Boolean(initial)}
              onValueChange={(value) => {
                setDomainId(value);
                setProjectId("");
                setEvidence([]);
              }}
            >
              <SelectTrigger id={`${formId}-domain`} className="w-full">
                <SelectValue placeholder="도메인을 선택해 주세요" />
              </SelectTrigger>
              <SelectContent>
                {domains.map((item) => (
                  <SelectItem value={item.id} key={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${formId}-project`}>프로젝트</FieldLabel>
            <Select
              value={projectId || "common"}
              disabled={pending || Boolean(initial)}
              onValueChange={(value) => {
                setProjectId(value === "common" ? "" : value);
                setEvidence([]);
              }}
            >
              <SelectTrigger id={`${formId}-project`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="common">도메인 공통</SelectItem>
                {projects
                  .filter((item) => item.domainId === domainId)
                  .map((item) => (
                    <SelectItem value={item.id} key={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="field-grid">
          <Field>
            <FieldLabel htmlFor={`${formId}-type`}>위키 유형</FieldLabel>
            <Select
              value={wikiType}
              onValueChange={(value) =>
                setWikiType(value as WikiMetadata["type"])
              }
              disabled={pending}
            >
              <SelectTrigger id={`${formId}-type`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries({
                  ...wikiTypesForSchema(
                    domains.find((d) => d.id === domainId)?.schemaMarkdown,
                  ),
                  ...(wikiType
                    ? { [wikiType]: wikiTypesForSchema()[wikiType] ?? wikiType }
                    : {}),
                }).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${formId}-aliases`}>별칭</FieldLabel>
            <Input
              id={`${formId}-aliases`}
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              maxLength={2100}
              aria-describedby={`${formId}-aliases-help`}
            />
            <FieldDescription id={`${formId}-aliases-help`}>
              쉼표로 구분해 최대 20개를 적습니다. 별칭으로도 검색할 수 있으며
              같은 별칭의 위키는 각각 표시합니다.
            </FieldDescription>
          </Field>
        </div>
        <MarkdownEditor
          id={`${formId}-body`}
          workspaceId={workspaceId}
          selectionScope={{
            domainId,
            projectId: projectId || null,
            pageId: initial?.pageId ?? null,
            versionId: initial?.versionId ?? null,
            latestVersionId: initial?.parentVersionId ?? null,
          }}
          linkDestinations={initial?.linkDestinations}
          value={body}
          onChange={setBody}
          disabled={pending}
        />
        <section className="evidence-picker">
          <div className="section-heading">
            <h2>공개 원문의 근거 선택</h2>
            <span>{evidence.length}개 선택</span>
          </div>
          <p className="muted">
            같은 도메인·프로젝트의 현재 공개 자료를 연결합니다. 게시 요청에는
            근거가 한 개 이상 필요합니다.
          </p>
          <div className="inline-search">
            <Input
              aria-label="근거 검색어"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  setSearch(q);
                }
              }}
              maxLength={100}
              placeholder="자료 제목이나 문구"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setSearch(q)}
            >
              근거 검색
            </Button>
          </div>
          {searchError && (
            <p role="alert" className="form-error">
              {searchError}
            </p>
          )}
          <div className="selected-evidence">
            {evidence.map((item) => (
              <Button
                variant="secondary"
                className="h-auto whitespace-normal"
                type="button"
                key={item.chunkId}
                onClick={() =>
                  setEvidence(
                    evidence.filter(
                      (selected) => selected.chunkId !== item.chunkId,
                    ),
                  )
                }
              >
                {item.title} · {item.locator && locatorLabel(item.locator)} ×
              </Button>
            ))}
          </div>
          <div className="evidence-options">
            {results.map((item) => (
              <Field
                orientation="horizontal"
                className="evidence-option"
                key={item.chunkId}
              >
                <Checkbox
                  id={`${formId}-${item.chunkId}`}
                  checked={evidence.some(
                    (selected) => selected.chunkId === item.chunkId,
                  )}
                  disabled={pending}
                  onCheckedChange={(checked) =>
                    setEvidence(
                      checked === true
                        ? [...evidence, item]
                        : evidence.filter(
                            (selected) => selected.chunkId !== item.chunkId,
                          ),
                    )
                  }
                  aria-describedby={`${formId}-${item.chunkId}-excerpt`}
                />
                <FieldContent>
                  <FieldLabel htmlFor={`${formId}-${item.chunkId}`}>
                    {item.title} · {item.locator && locatorLabel(item.locator)}
                  </FieldLabel>
                  <FieldDescription id={`${formId}-${item.chunkId}-excerpt`}>
                    {item.excerpt}
                  </FieldDescription>
                </FieldContent>
              </Field>
            ))}
            {!results.length && (
              <p className="empty-copy">
                현재 선택할 공개 근거가 없습니다. 먼저 자료를 등록하고 검토
                직원의 공개 승인을 받아 주세요.
              </p>
            )}
          </div>
        </section>
      </FieldSet>
      <p className="field-help">
        저장할 때마다 새 버전이 만들어집니다. 본문에 연결한 근거가 주장을
        뒷받침하는지는 검토 직원이 확인합니다.
      </p>
      <Button
        type="submit"
        disabled={pending || !domainId || body.length > 40000}
      >
        {pending ? "저장 중…" : "초안 저장"}
      </Button>
      {message && (
        <p role="alert" className="form-error">
          {message}
        </p>
      )}
    </form>
  );
}
