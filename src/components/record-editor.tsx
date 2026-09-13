"use client";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
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
import { locatorLabel } from "@/lib/content";
import { recordDraft } from "@/lib/drafts";
import type { Testimony } from "@/server/db/schema";
import type { SearchResult } from "@/server/services/search";

const labels = {
  situation: "상황",
  reasoning: "판단과 이유",
  result: "결과",
  followUp: "추가 확인할 내용",
} as const;
type Summary = Pick<Testimony, keyof typeof labels>;
export function RecordEditor({
  workspaceId,
  domains,
  projects,
  initial,
}: {
  workspaceId: string;
  domains: { id: string; name: string; recordTemplate: string }[];
  projects: { id: string; domainId: string; name: string }[];
  initial?: {
    sourceId: string;
    versionId: string;
    title: string;
    domainId: string;
    projectId: string | null;
    testimony: Testimony;
  };
}) {
  const router = useRouter();
  const fid = useId();
  const [domainId, setDomain] = useState(
    initial?.domainId ?? domains[0]?.id ?? "",
  );
  const [projectId, setProject] = useState(initial?.projectId ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [rawNote, setNote] = useState(initial?.testimony.rawNote ?? "");
  const [fields, setFields] = useState<Summary>(
    initial?.testimony ?? {
      situation: "",
      reasoning: "",
      result: "",
      followUp: "",
    },
  );
  const [suggestion, setSuggestion] = useState<Summary | null>(null);
  const [chunkIds, setChunks] = useState<string[]>(
    initial?.testimony.chunkIds ?? [],
  );
  const [results, setResults] = useState<SearchResult[]>([]);
  const [q, setQ] = useState("");
  const [pending, setPending] = useState(false);
  const [aiPending, setAiPending] = useState(false);
  const [message, setMessage] = useState("");
  const draft = useDraft({
    id: `${workspaceId}:record:${initial?.sourceId ?? "new"}:${initial?.versionId ?? "new"}`,
    value: { domainId, projectId, title, rawNote, fields, chunkIds },
    schema: recordDraft,
    restore: (value) => {
      setDomain(value.domainId);
      setProject(value.projectId);
      setTitle(value.title);
      setNote(value.rawNote);
      setFields(value.fields);
      setChunks(value.chunkIds);
    },
  });
  const selected = useSelectedEvidence(
    workspaceId,
    domainId,
    projectId,
    chunkIds,
  );
  const evidenceOptions = [
    ...new Map(
      [...results, ...selected.results].map((r) => [r.chunkId, r]),
    ).values(),
  ];
  return (
    <form
      className="form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setMessage("");
        try {
          const response = await fetch(
            `/api/workspaces/${workspaceId}/records${initial ? `/${initial.sourceId}` : ""}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title,
                domainId,
                projectId: projectId || null,
                rawNote,
                ...fields,
                chunkIds,
              }),
            },
          );
          const data = await response.json();
          if (!response.ok) throw new Error(data.error);
          draft.clear();
          router.push(
            `/w/${workspaceId}/sources/${data.sourceId}?version=${data.versionId}`,
          );
          router.refresh();
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "기록을 저장하지 못했습니다.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <DraftNotice draft={draft} />
      <Field>
        <FieldLabel htmlFor={`${fid}-title`}>기록 제목</FieldLabel>
        <Input
          id={`${fid}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={160}
          required
          disabled={!!initial || pending}
        />
      </Field>
      <div className="form-grid">
        <Field>
          <FieldLabel htmlFor={`${fid}-domain`}>도메인</FieldLabel>
          <Select
            value={domainId}
            onValueChange={(v) => {
              setDomain(v);
              setProject("");
              setChunks([]);
              setResults([]);
            }}
            disabled={!!initial || pending}
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
            onValueChange={(v) => {
              setProject(v === "common" ? "" : v);
              setChunks([]);
              setResults([]);
            }}
            disabled={!!initial || pending}
          >
            <SelectTrigger id={`${fid}-project`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="common">도메인 공통</SelectItem>
              {projects
                .filter((p) => p.domainId === domainId)
                .map((p) => (
                  <SelectItem value={p.id} key={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <p className="field-help whitespace-pre-wrap">
        도메인 기록 안내:{" "}
        {domains.find((d) => d.id === domainId)?.recordTemplate}
      </p>
      <Field>
        <FieldLabel htmlFor={`${fid}-note`}>작성 당시 메모</FieldLabel>
        <Textarea
          id={`${fid}-note`}
          rows={5}
          value={rawNote}
          onChange={(e) => {
            setNote(e.target.value);
            setSuggestion(null);
          }}
          maxLength={12000}
          disabled={pending || aiPending}
        />
        <FieldDescription>
          메모가 없어도 아래 항목을 직접 작성할 수 있습니다. AI 정리는 메모를
          바꾸지 않습니다.
        </FieldDescription>
      </Field>
      <Button
        type="button"
        variant="outline"
        disabled={!rawNote.trim() || pending || aiPending}
        onClick={async () => {
          setAiPending(true);
          setMessage("");
          try {
            const response = await fetch(
              `/api/workspaces/${workspaceId}/generations`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "memo",
                  requestId: crypto.randomUUID(),
                  rawNote,
                }),
              },
            );
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            setSuggestion(data.result);
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : "정리하지 못했습니다.",
            );
          } finally {
            setAiPending(false);
          }
        }}
      >
        {aiPending ? "메모 정리 중…" : "AI 정리 제안 보기"}
      </Button>
      {suggestion && (
        <section className="notice-box">
          <h2 className="content-subtitle">AI가 정리한 제안</h2>
          {Object.entries(labels).map(([key, label]) => (
            <div key={key}>
              <strong>{label}</strong>
              <p className="whitespace-pre-wrap">
                {suggestion[key as keyof Summary]}
              </p>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setFields(suggestion);
              setSuggestion(null);
            }}
          >
            내용을 확인하고 작성 항목에 반영
          </Button>
        </section>
      )}
      {Object.entries(labels).map(([key, label]) => (
        <Field key={key}>
          <FieldLabel htmlFor={`${fid}-${key}`}>{label}</FieldLabel>
          <Textarea
            id={`${fid}-${key}`}
            value={fields[key as keyof Summary]}
            onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
            rows={4}
            maxLength={5000}
            required={key !== "followUp"}
            disabled={pending}
          />
        </Field>
      ))}
      <details className="panel">
        <summary>연결할 공개 원문 선택 (선택 사항)</summary>
        <Field>
          <FieldLabel htmlFor={`${fid}-q`}>원문 검색어</FieldLabel>
          <Input
            id={`${fid}-q`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            try {
              const params = new URLSearchParams({
                kind: "source",
                q,
                domainId,
                ...(projectId ? { projectId } : {}),
              });
              const response = await fetch(
                `/api/workspaces/${workspaceId}/search?${params}`,
              );
              if (!response.ok) throw new Error("근거를 불러오지 못했습니다.");
              const rows: SearchResult[] = await response.json();
              setResults(rows.filter((r) => projectId || r.projectId === null));
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "검색 실패");
            }
          }}
        >
          원문 찾기
        </Button>
        <p className="field-help">
          선택한 문단 {chunkIds.length}개 · 문서 없이 남기는 경험은 작성자
          진술로 구분됩니다.
        </p>
        {selected.error && <p role="alert">{selected.error}</p>}
        <Button type="button" variant="ghost" onClick={() => setChunks([])}>
          근거 선택 초기화
        </Button>
        {evidenceOptions.map((r) => (
          <Field key={r.chunkId} orientation="horizontal">
            <Checkbox
              id={`${fid}-${r.chunkId}`}
              checked={chunkIds.includes(r.chunkId ?? "")}
              onCheckedChange={(v) =>
                setChunks(
                  v
                    ? [...chunkIds, r.chunkId as string]
                    : chunkIds.filter((id) => id !== r.chunkId),
                )
              }
            />
            <FieldContent>
              <FieldLabel htmlFor={`${fid}-${r.chunkId}`}>
                {r.title} · {r.locator ? locatorLabel(r.locator) : "원문"}
              </FieldLabel>
              <FieldDescription>{r.excerpt}</FieldDescription>
            </FieldContent>
          </Field>
        ))}
      </details>
      {message && (
        <p role="alert" className="form-error">
          {message}
        </p>
      )}
      <p className="field-help">
        저장하면 검토 대기 자료로 등록됩니다. 작성자가 확인한 진술과 연결한
        문서를 함께 검토한 뒤 공개합니다.
      </p>
      <Button type="submit" disabled={pending || aiPending || !domainId}>
        {pending
          ? "저장 중…"
          : initial
            ? "새 기록 버전 저장"
            : "실무 기록 저장"}
      </Button>
    </form>
  );
}
