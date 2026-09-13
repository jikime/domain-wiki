"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { DraftNotice, useDraft } from "@/components/draft-controls";
import { useSelectedEvidence } from "@/components/selected-evidence";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { proposalDraft } from "@/lib/drafts";
import { proposalLabels } from "@/lib/proposals";
import type { ProposalItem } from "@/server/db/schema";
import type { SearchResult } from "@/server/services/search";
import type { listWiki, wikiDetails } from "@/server/services/wiki";

type EditableItem = ProposalItem & { editorKey: string };
const emptyItem = (editorKey: string = crypto.randomUUID()): EditableItem => ({
  editorKey,
  kind: "new",
  title: "",
  body: "",
  reason: "",
  pageId: null,
  parentVersionId: null,
  basePublishedVersionId: null,
  chunkIds: [],
  mergedPages: [],
});
export function ProposalEditor({
  workspaceId,
  domains,
  projects,
  initial,
}: {
  workspaceId: string;
  domains: { id: string; name: string }[];
  projects: { id: string; domainId: string; name: string }[];
  initial?: {
    id: string;
    taskId?: string | null;
    title: string;
    domainId: string;
    projectId: string | null;
    items: ProposalItem[];
  };
}) {
  const router = useRouter();
  const generated = !!initial?.taskId;
  const fid = useId();
  const [domainId, setDomain] = useState(
    initial?.domainId ?? domains[0]?.id ?? "",
  );
  const [projectId, setProject] = useState(initial?.projectId ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [items, setItems] = useState<EditableItem[]>(
    () =>
      initial?.items.map((item, index) => ({
        ...item,
        editorKey: `initial-${index}`,
      })) ?? [emptyItem("new-0")],
  );
  const [evidence, setEvidence] = useState<SearchResult[]>([]);
  const [wikis, setWikis] = useState<Awaited<ReturnType<typeof listWiki>>>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const draft = useDraft({
    id: `${workspaceId}:proposal:${initial?.id ?? "new"}`,
    value: { domainId, projectId, title, items },
    schema: proposalDraft,
    restore: (value) => {
      setDomain(value.domainId);
      setProject(value.projectId);
      setTitle(value.title);
      setItems(value.items);
    },
  });
  const selected = useSelectedEvidence(
    workspaceId,
    domainId,
    projectId,
    items.flatMap((item) => item.chunkIds),
  );
  const evidenceOptions = [
    ...new Map(
      [...evidence, ...selected.results].map((r) => [r.chunkId, r]),
    ).values(),
  ];
  const base = `/api/workspaces/${workspaceId}`;
  const patch = (index: number, data: Partial<ProposalItem>) =>
    setItems((rows) =>
      rows.map((row, n) => (n === index ? { ...row, ...data } : row)),
    );
  useEffect(() => {
    if (!domainId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      kind: "source",
      domainId,
      q: search,
      ...(projectId ? { projectId } : {}),
    });
    Promise.all([
      fetch(`${base}/search?${params}`, { signal: controller.signal }),
      fetch(`${base}/wiki?domainId=${domainId}`, { signal: controller.signal }),
    ])
      .then(async ([a, b]) => {
        if (!a.ok || !b.ok)
          throw new Error("근거와 대상 위키를 불러오지 못했습니다.");
        const refs: SearchResult[] = await a.json();
        const pages: Awaited<ReturnType<typeof listWiki>> = await b.json();
        setEvidence(refs.filter((r) => projectId || r.projectId === null));
        setWikis(pages.filter((p) => p.projectId === (projectId || null)));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, [base, domainId, projectId, search]);
  async function loadWiki(id: string, version?: string) {
    const response = await fetch(
      `${base}/wiki/${id}${version ? `?version=${version}` : ""}`,
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data as Awaited<ReturnType<typeof wikiDetails>>;
  }
  async function chooseTarget(index: number, pageId: string) {
    setPending(true);
    setMessage("");
    try {
      const data = await loadWiki(pageId);
      const current = items[index];
      patch(index, {
        pageId,
        parentVersionId: data.page.latestVersionId ?? null,
        basePublishedVersionId: data.page.publishedVersionId,
        title: current.title || data.version.title,
        body: current.body || data.version.body,
        chunkIds: [
          ...new Set([
            ...current.chunkIds,
            ...data.evidence.filter((r) => r.available).map((r) => r.id),
          ]),
        ],
        mergedPages: current.mergedPages.filter((p) => p.pageId !== pageId),
      });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "대상 위키를 열지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setMessage("");
        try {
          const response = await fetch(`${base}/proposals`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title,
              domainId,
              projectId: projectId || null,
              predecessorId: initial?.id ?? null,
              items: items.map(({ editorKey: _, ...item }) => item),
            }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error);
          draft.clear();
          router.push(`/w/${workspaceId}/proposals/${data.id}`);
          router.refresh();
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "변경 묶음을 저장하지 못했습니다.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <DraftNotice draft={draft} />
      {generated && (
        <p className="notice-box">
          연결 주소를 유지하기 위해 페이지 수와 대상은 고정됩니다. 본문과 근거를
          수정한 뒤 새 묶음으로 저장해 주세요.
        </p>
      )}
      <Field>
        <FieldLabel htmlFor={`${fid}-title`}>변경 묶음 제목</FieldLabel>
        <Input
          id={`${fid}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={160}
          disabled={pending}
        />
      </Field>
      <div className="form-grid">
        <Field>
          <FieldLabel htmlFor={`${fid}-domain`}>도메인</FieldLabel>
          <Select
            value={domainId}
            disabled={pending || !!initial}
            onValueChange={(value) => {
              setDomain(value);
              setProject("");
              setItems([emptyItem()]);
            }}
          >
            <SelectTrigger id={`${fid}-domain`} className="w-full">
              <SelectValue placeholder="도메인 선택" />
            </SelectTrigger>
            <SelectContent>
              {domains.map((d) => (
                <SelectItem value={d.id} key={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${fid}-project`}>프로젝트</FieldLabel>
          <Select
            value={projectId || "common"}
            disabled={pending || !!initial}
            onValueChange={(value) => {
              setProject(value === "common" ? "" : value);
              setItems([emptyItem()]);
            }}
          >
            <SelectTrigger id={`${fid}-project`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="common">도메인 공통</SelectItem>
              {projects
                .filter((p) => p.domainId === domainId)
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="panel">
        <Field>
          <FieldLabel htmlFor={`${fid}-search`}>연결할 원문 검색</FieldLabel>
          <Input
            id={`${fid}-search`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={100}
          />
        </Field>
        <Button
          type="button"
          variant="outline"
          onClick={() => setSearch(query)}
        >
          근거 찾기
        </Button>
        <p className="field-help">
          아래 변경안마다 사용할 문단을 선택해 주세요. 범위를 바꾸면 대상과 근거
          선택을 다시 시작합니다.
        </p>
      </div>
      {items.map((item, index) => (
        <section className="panel form-stack" key={item.editorKey}>
          <div className="section-heading">
            <h2>변경안 {index + 1}</h2>
            {!generated && items.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setItems(items.filter((_, n) => n !== index))}
              >
                이 변경안 제외
              </Button>
            )}
          </div>
          <Field>
            <FieldLabel htmlFor={`${fid}-${index}-kind`}>제안 종류</FieldLabel>
            <Select
              value={item.kind}
              disabled={pending}
              onValueChange={(kind: ProposalItem["kind"]) =>
                patch(index, {
                  kind,
                  ...(kind === "new"
                    ? {
                        pageId: null,
                        parentVersionId: null,
                        basePublishedVersionId: null,
                      }
                    : {}),
                  ...(kind !== "merge" ? { mergedPages: [] } : {}),
                })
              }
            >
              <SelectTrigger id={`${fid}-${index}-kind`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(proposalLabels)
                  .filter(
                    ([kind]) =>
                      !generated ||
                      (item.pageId ? kind !== "new" : kind === "new"),
                  )
                  .map(([kind, label]) => (
                    <SelectItem key={kind} value={kind}>
                      {label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          {item.kind !== "new" && (
            <>
              <Field>
                <FieldLabel htmlFor={`${fid}-${index}-page`}>
                  대상 위키
                </FieldLabel>
                <Select
                  value={item.pageId ?? ""}
                  disabled={pending || generated}
                  onValueChange={(value) => void chooseTarget(index, value)}
                >
                  <SelectTrigger id={`${fid}-${index}-page`} className="w-full">
                    <SelectValue placeholder="변경할 위키 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {wikis.map((w) => (
                      <SelectItem key={w.pageId} value={w.pageId}>
                        {w.version.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {item.pageId && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void chooseTarget(index, item.pageId as string)
                  }
                >
                  최신 기준 버전 반영
                </Button>
              )}
            </>
          )}
          {item.kind === "merge" && (
            <div>
              <p className="field-help">
                병합 승인 시 아래에서 선택한 기존 위키의 게시를 철회하고 근거를
                대상 위키에 모읍니다.
              </p>
              {wikis
                .filter((w) => w.pageId !== item.pageId && w.publishedVersionId)
                .map((w) => (
                  <Field key={w.pageId} orientation="horizontal">
                    <Checkbox
                      id={`${fid}-${index}-merge-${w.pageId}`}
                      disabled={pending}
                      checked={item.mergedPages.some(
                        (p) => p.pageId === w.pageId,
                      )}
                      onCheckedChange={async (checked) => {
                        if (!checked) {
                          patch(index, {
                            mergedPages: item.mergedPages.filter(
                              (p) => p.pageId !== w.pageId,
                            ),
                          });
                          return;
                        }
                        setPending(true);
                        try {
                          const data = await loadWiki(
                            w.pageId,
                            w.publishedVersionId ?? undefined,
                          );
                          if (
                            !data.page.publishedVersionId ||
                            !data.page.latestVersionId
                          )
                            throw new Error(
                              "게시된 위키만 병합할 수 있습니다.",
                            );
                          patch(index, {
                            mergedPages: [
                              ...item.mergedPages,
                              {
                                pageId: w.pageId,
                                publishedVersionId:
                                  data.page.publishedVersionId,
                                latestVersionId: data.page.latestVersionId,
                              },
                            ],
                            chunkIds: [
                              ...new Set([
                                ...item.chunkIds,
                                ...data.evidence
                                  .filter((r) => r.available)
                                  .map((r) => r.id),
                              ]),
                            ],
                          });
                        } catch (error) {
                          setMessage(
                            error instanceof Error
                              ? error.message
                              : "병합 대상을 확인하지 못했습니다.",
                          );
                        } finally {
                          setPending(false);
                        }
                      }}
                    />
                    <FieldLabel htmlFor={`${fid}-${index}-merge-${w.pageId}`}>
                      {w.version.title}
                    </FieldLabel>
                  </Field>
                ))}
            </div>
          )}
          <Field>
            <FieldLabel htmlFor={`${fid}-${index}-title`}>위키 제목</FieldLabel>
            <Input
              id={`${fid}-${index}-title`}
              value={item.title}
              onChange={(e) => patch(index, { title: e.target.value })}
              maxLength={160}
              required
              disabled={pending}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fid}-${index}-body`}>
              변경 후 본문
            </FieldLabel>
            <Textarea
              id={`${fid}-${index}-body`}
              value={item.body}
              onChange={(e) => patch(index, { body: e.target.value })}
              rows={10}
              maxLength={20000}
              required
              disabled={pending}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fid}-${index}-reason`}>
              변경 이유·확인할 사항
            </FieldLabel>
            <Textarea
              id={`${fid}-${index}-reason`}
              value={item.reason}
              onChange={(e) => patch(index, { reason: e.target.value })}
              rows={3}
              maxLength={2000}
              required
              disabled={pending}
            />
          </Field>
          {generated &&
            (initial?.items.find((i) => i.plannedPageId === item.plannedPageId)
              ?.requiresResolution ||
              item.requiresResolution) && (
              <Field orientation="horizontal">
                <Checkbox
                  id={`${fid}-${index}-resolved`}
                  disabled={pending}
                  checked={!item.requiresResolution}
                  onCheckedChange={(checked) =>
                    patch(index, {
                      requiresResolution: checked !== true,
                      ...(checked && item.kind === "conflict"
                        ? { kind: "update" as const }
                        : {}),
                    })
                  }
                />
                <FieldContent>
                  <FieldLabel htmlFor={`${fid}-${index}-resolved`}>
                    모순·적용 조건을 확인하고 본문 수정을 마쳤습니다
                  </FieldLabel>
                  <FieldDescription>
                    원문과 기존 게시본을 대조한 뒤 표시해 주세요. 다른 검토
                    직원의 승인도 필요합니다.
                  </FieldDescription>
                </FieldContent>
              </Field>
            )}
          <details>
            <summary>원문 근거 선택 · {item.chunkIds.length}개</summary>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => patch(index, { chunkIds: [] })}
            >
              근거 선택 초기화
            </Button>
            {selected.error && <p role="alert">{selected.error}</p>}
            {evidenceOptions.map((r) => (
              <Field key={r.chunkId} orientation="horizontal">
                <Checkbox
                  id={`${fid}-${index}-${r.chunkId}`}
                  checked={item.chunkIds.includes(r.chunkId ?? "")}
                  disabled={pending}
                  onCheckedChange={(v) =>
                    patch(index, {
                      chunkIds: v
                        ? [...item.chunkIds, r.chunkId as string]
                        : item.chunkIds.filter((id) => id !== r.chunkId),
                    })
                  }
                />
                <FieldContent>
                  <FieldLabel htmlFor={`${fid}-${index}-${r.chunkId}`}>
                    {r.title}
                  </FieldLabel>
                  <FieldDescription>{r.excerpt}</FieldDescription>
                  <a
                    className="field-help"
                    href={r.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    원문 열기 ↗
                  </a>
                </FieldContent>
              </Field>
            ))}
            {!evidenceOptions.length && (
              <p className="empty-copy">
                현재 조건에 맞는 공개 원문이 없습니다.
              </p>
            )}
          </details>
        </section>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={pending || generated}
        onClick={() => setItems([...items, emptyItem()])}
      >
        변경안 추가
      </Button>
      {message && (
        <p role="alert" className="form-error">
          {message}
        </p>
      )}
      <p className="field-help">
        저장한 묶음의 내용은 고정됩니다. 수정할 때는 새 묶음으로 저장하므로
        검토자가 확인한 버전이 바뀌지 않습니다.
      </p>
      <Button type="submit" disabled={pending || !domainId}>
        {pending
          ? "저장 중…"
          : initial
            ? "수정한 새 변경 묶음 저장"
            : "변경 묶음 저장"}
      </Button>
    </form>
  );
}
