"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ChatMarkdown } from "@/components/chat-markdown";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  activeResearchStates,
  type ResearchInput,
  researchCategories,
  researchCategoryLabels,
  researchEngineLabels,
  researchEngines,
  researchStates,
} from "@/lib/research";
import type {
  researchDetails,
  researchOverview,
} from "@/server/services/research";

type Data = Awaited<ReturnType<typeof researchOverview>>;
type Details = Awaited<ReturnType<typeof researchDetails>>;
type Initial = { topic: string; origin: ResearchInput["origin"]; id?: string };
const date = (value: Date) =>
  new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
export function ResearchWorkspace({
  workspaceId: w,
  domains,
  projects,
  data,
  initial,
}: {
  workspaceId: string;
  domains: { id: string; name: string }[];
  projects: { id: string; name: string; domainId: string }[];
  data: Data;
  initial: Initial;
}) {
  const id = useId(),
    router = useRouter();
  const [topic, setTopic] = useState(initial.topic),
    [queries, setQueries] = useState(initial.topic);
  const [sourceMode, setSourceMode] = useState<ResearchInput["sourceMode"]>(
    data.providers.length ? "both" : "local",
  );
  const [provider, setProvider] = useState<ResearchInput["provider"]>(
    data.providers[0]?.provider ?? null,
  );
  const [engine, setEngine] = useState<ResearchInput["engine"]>("google"),
    [categories, setCategories] = useState<ResearchInput["categories"]>([
      "general",
    ]);
  const [origin, setOrigin] = useState(initial.origin),
    [selectedId, setSelectedId] = useState<string | null>(initial.id ?? null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const running = data.runs.some((run) =>
    activeResearchStates.includes(run.state),
  );
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [running, router]);
  async function send(resource: string, input: unknown, signal: AbortSignal) {
    const response = await fetch(`/api/workspaces/${w}/${resource}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "요청을 완료하지 못했습니다.");
    return result;
  }
  async function action(work: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setMessage("");
    try {
      await work(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof Error
            ? error.message
            : "요청을 완료하지 못했습니다.",
        );
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }
  function scope(domainId: string, projectId: string | null) {
    router.push(
      `/w/${w}/tools/research?domainId=${domainId}${projectId ? `&projectId=${projectId}` : ""}`,
    );
  }
  return (
    <>
      <section className="panel">
        <h2 className="content-subtitle">조사할 범위와 주제</h2>
        <div className="field-grid">
          <Field>
            <FieldLabel htmlFor={`${id}-domain`}>도메인</FieldLabel>
            <Select
              value={data.scope.domainId}
              disabled={busy}
              onValueChange={(value) => scope(value, null)}
            >
              <SelectTrigger id={`${id}-domain`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {domains.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-project`}>프로젝트</FieldLabel>
            <Select
              value={data.scope.projectId ?? "all"}
              disabled={busy}
              onValueChange={(value) =>
                scope(data.scope.domainId, value === "all" ? null : value)
              }
            >
              <SelectTrigger id={`${id}-project`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">도메인 전체</SelectItem>
                {projects
                  .filter((p) => p.domainId === data.scope.domainId)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} + 공통 자료
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            void action(async (signal) => {
              const searchQueries = [
                ...new Set(
                  queries
                    .split("\n")
                    .map((q) => q.trim())
                    .filter(Boolean),
                ),
              ];
              if (!searchQueries.length || searchQueries.length > 10)
                throw new Error(
                  "검색어를 한 줄에 하나씩, 1~10개 입력해 주세요.",
                );
              const result = await send(
                "research",
                {
                  ...data.scope,
                  requestId: crypto.randomUUID(),
                  topic,
                  queries: searchQueries,
                  sourceMode,
                  provider: sourceMode === "local" ? null : provider,
                  engine,
                  categories,
                  origin,
                },
                signal,
              );
              setSelectedId(result.id);
              setMessage(
                result.replay
                  ? "이 검토 항목의 진행 중인 조사를 열었습니다."
                  : "조사를 등록했습니다. 다른 화면으로 이동해도 작업이 이어집니다.",
              );
              router.refresh();
            });
          }}
        >
          {origin.kind !== "manual" && (
            <p className="notice-box">
              {origin.kind === "review" ? "검토 항목" : "그래프 인사이트"}에서
              이어진 조사입니다. 주제·검색어 보완을 누르면 도메인 목적과 개요를
              함께 읽습니다.
            </p>
          )}
          <Field>
            <FieldLabel htmlFor={`${id}-topic`}>조사 주제</FieldLabel>
            <Input
              id={`${id}-topic`}
              required
              maxLength={150}
              value={topic}
              disabled={busy}
              onChange={(event) => setTopic(event.target.value)}
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !topic.trim() || !data.modelConfigured}
            onClick={() =>
              void action(async (signal) => {
                const result = await send(
                  "research-topic",
                  {
                    ...data.scope,
                    requestId: crypto.randomUUID(),
                    topic,
                    origin,
                  },
                  signal,
                );
                setTopic(result.topic);
                setQueries(result.searchQueries.join("\n"));
                setMessage(
                  "목적과 개요를 반영한 주제·검색어입니다. 내용을 확인하거나 고친 뒤 조사를 시작해 주세요.",
                );
              })
            }
          >
            AI로 주제·검색어 보완
          </Button>
          <Field>
            <FieldLabel htmlFor={`${id}-queries`}>
              검색어 · 한 줄에 하나
            </FieldLabel>
            <Textarea
              id={`${id}-queries`}
              required
              value={queries}
              maxLength={4010}
              rows={4}
              disabled={busy}
              onChange={(event) => setQueries(event.target.value)}
              aria-describedby={`${id}-queries-help`}
            />
            <FieldDescription id={`${id}-queries-help`}>
              최대 10개, 검색어마다 400자까지 입력합니다. AI 보완은 검색어 3개를
              제안합니다.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-source`}>조사 자료</FieldLabel>
            <Select
              value={sourceMode}
              disabled={busy}
              onValueChange={(value) =>
                setSourceMode(value as ResearchInput["sourceMode"])
              }
            >
              <SelectTrigger id={`${id}-source`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">내부 공개 자료</SelectItem>
                <SelectItem value="web" disabled={!data.providers.length}>
                  웹 검색
                </SelectItem>
                <SelectItem value="both" disabled={!data.providers.length}>
                  웹 검색 + 내부 공개 자료
                </SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              내부 자료는 선택한 범위에서 검색합니다. 웹 검색을 선택하면 입력한
              검색어가 해당 제공자에게 전달됩니다.
            </FieldDescription>
          </Field>
          {sourceMode !== "local" && (
            <Field>
              <FieldLabel htmlFor={`${id}-provider`}>웹 검색 제공자</FieldLabel>
              <Select
                value={provider ?? ""}
                disabled={busy}
                onValueChange={(value) =>
                  setProvider(value as ResearchInput["provider"])
                }
              >
                <SelectTrigger id={`${id}-provider`} className="w-full">
                  <SelectValue placeholder="검색 제공자" />
                </SelectTrigger>
                <SelectContent>
                  {data.providers.map((p) => (
                    <SelectItem key={p.provider} value={p.provider}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {sourceMode !== "local" && provider === "serpapi" && (
            <Field>
              <FieldLabel htmlFor={`${id}-engine`}>검색 엔진</FieldLabel>
              <Select
                value={engine}
                disabled={busy}
                onValueChange={(value) =>
                  setEngine(value as ResearchInput["engine"])
                }
              >
                <SelectTrigger id={`${id}-engine`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {researchEngines.map((value) => (
                    <SelectItem key={value} value={value}>
                      {researchEngineLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {sourceMode !== "local" && provider === "searxng" && (
            <fieldset className="stack-form">
              <legend>검색 분야</legend>
              {researchCategories.map((category) => (
                <Field key={category} orientation="horizontal">
                  <Checkbox
                    id={`${id}-${category}`}
                    checked={categories.includes(category)}
                    disabled={
                      busy ||
                      (categories.length === 1 && categories.includes(category))
                    }
                    onCheckedChange={(value) =>
                      setCategories((current) =>
                        value === true
                          ? [...current, category]
                          : current.filter((c) => c !== category),
                      )
                    }
                  />
                  <FieldLabel htmlFor={`${id}-${category}`}>
                    {researchCategoryLabels[category]}
                  </FieldLabel>
                </Field>
              ))}
            </fieldset>
          )}
          {!data.providers.length && (
            <p className="field-help">
              웹 검색 제공자가 아직 설정되지 않았습니다. 현재는 내부 공개 자료로
              조사할 수 있습니다.
            </p>
          )}
          {!data.modelConfigured && (
            <p className="notice-box">
              지식 정리 모델 연결을 먼저 설정해 주세요.
            </p>
          )}
          <p className="field-help">
            검색어마다 웹 결과 5개와 내부 자료 최대 15개를 모아, 중복을 제외한
            최대 20개로 작성합니다. 모델·검색 제공자의 사용량이 발생합니다. 조사
            결과는 초안으로 저장되며 출처와 게시 내용은 검토를 거칩니다.
          </p>
          <Button type="submit" disabled={busy || !data.modelConfigured}>
            {busy ? "요청 중…" : "조사 시작"}
          </Button>
        </form>
        <output aria-live="polite">{message}</output>
      </section>
      {selectedId && (
        <ResearchResult
          key={selectedId}
          workspaceId={w}
          id={selectedId}
          onRerun={(input) => {
            setTopic(input.topic);
            setQueries(input.queries.join("\n"));
            setSourceMode(input.sourceMode);
            setProvider(input.provider);
            setEngine(input.engine);
            setCategories(input.categories);
            setOrigin(input.origin);
            setSelectedId(null);
            setMessage(
              "이전 주제와 검색어를 가져왔습니다. 내용을 확인하고 다시 시작할 수 있습니다.",
            );
          }}
        />
      )}
      <section className="panel">
        <h2 className="content-subtitle">최근 조사 · 최대 50건</h2>
        {data.runs.map((run) => (
          <div key={run.id} className="decision-row">
            <Button
              type="button"
              variant="link"
              onClick={() => setSelectedId(run.id)}
            >
              {run.topic}
            </Button>
            <p className="field-help">
              {researchStates[run.state]} · 자료 {run.source_count}개 ·{" "}
              {date(run.created_at)} 한국시간
            </p>
            {run.error_message && (
              <p className="form-error">{run.error_message}</p>
            )}
          </div>
        ))}
        {!data.runs.length && (
          <p className="empty-copy">아직 등록한 조사가 없습니다.</p>
        )}
      </section>
    </>
  );
}
function ResearchResult({
  workspaceId: w,
  id,
  onRerun,
}: {
  workspaceId: string;
  id: string;
  onRerun: (input: ResearchInput) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<Details | null>(null),
    [error, setError] = useState(""),
    [citation, setCitation] = useState<number | null>(null),
    [canceling, setCanceling] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(`/api/workspaces/${w}/research/${id}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setData(result);
        if (activeResearchStates.includes(result.state))
          timer = setTimeout(load, 1000);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "조사 상태를 읽지 못했습니다.",
          );
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [w, id]);
  async function cancel() {
    setCanceling(true);
    try {
      const response = await fetch(`/api/workspaces/${w}/research/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData((current) =>
        current
          ? { ...current, state: "canceled", synthesis: "", references: [] }
          : current,
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "조사를 중지하지 못했습니다.");
    } finally {
      setCanceling(false);
    }
  }
  const selected = citation !== null ? data?.references[citation] : null;
  return (
    <section className="panel" aria-label="조사 결과">
      <h2 className="content-subtitle">
        {data?.input.topic ?? "조사 상태 확인 중"}
      </h2>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {data && (
        <>
          <output>
            {researchStates[data.state]} · 수집 자료 {data.references.length}개
          </output>
          <div className="inline-actions">
            {activeResearchStates.includes(data.state) ? (
              <Button
                type="button"
                variant="outline"
                disabled={canceling}
                onClick={() => void cancel()}
              >
                조사 중지
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => onRerun(data.input)}
              >
                이 주제로 다시 조사
              </Button>
            )}
            {data.pageId && (
              <Link href={`/w/${w}/wiki/${data.pageId}/edit`}>
                조사 초안 확인·검토 요청 →
              </Link>
            )}
          </div>
          {data.error && <p className="notice-box">{data.error}</p>}
          {data.sourceErrors.map((message) => (
            <p key={message} className="notice-box">
              {message}
            </p>
          ))}
          {data.synthesis && (
            <ChatMarkdown
              citations={data.references.map((r, i) => ({
                key: String(i + 1),
                title: r.title,
              }))}
              linkDestinations={data.linkDestinations}
              onCitationClick={(key) => setCitation(Number(key) - 1)}
            >
              {data.synthesis}
            </ChatMarkdown>
          )}
          {selected && (
            <section className="notice-box" aria-label="선택한 조사 출처">
              <h3>
                출처 {(citation ?? 0) + 1}: {selected.title}
              </h3>
              <p className="whitespace-pre-wrap">{selected.snippet}</p>
              <a
                href={selected.url}
                target={selected.citation ? undefined : "_blank"}
                rel="noreferrer"
              >
                {selected.source} · 자료 열기 →
              </a>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCitation(null)}
              >
                출처 닫기
              </Button>
            </section>
          )}
          {!!data.sources.length && (
            <div className="decision-row">
              <h3>조사 초안의 원문 근거</h3>
              {data.sources.map((source) => (
                <p key={source.version_id}>
                  <Link
                    href={`/w/${w}/sources/${source.id}?version=${source.version_id}`}
                  >
                    {source.title} ·{" "}
                    {source.publication === "published"
                      ? "공개 자료"
                      : "공개 검토 필요"}{" "}
                    →
                  </Link>
                </p>
              ))}
            </div>
          )}
          {!!data.references.length && (
            <details>
              <summary>수집한 출처 {data.references.length}개</summary>
              {data.references.map((r, index) => (
                <div className="decision-row" key={`${index}:${r.url}`}>
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => setCitation(index)}
                  >
                    [{index + 1}] {r.title}
                  </Button>
                  <p className="field-help">{r.source}</p>
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}
