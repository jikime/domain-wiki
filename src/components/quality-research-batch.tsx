"use client";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { qualityOverview } from "@/server/services/quality";
import type { researchOverview } from "@/server/services/research";
import type { createResearchBatch } from "@/server/services/research-batch";

type Data = Awaited<ReturnType<typeof qualityOverview>>;
export function QualityResearchBatch({
  workspaceId: w,
  data,
}: {
  workspaceId: string;
  data: Data;
}) {
  const id = useId();
  const [selected, setSelected] = useState<string[]>([]),
    [mode, setMode] = useState("local"),
    [provider, setProvider] = useState("");
  const [providers, setProviders] = useState<
    Awaited<ReturnType<typeof researchOverview>>["providers"]
  >([]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof createResearchBatch>
  > | null>(null);
  const scopeQuery = `domainId=${data.scope.domainId}${data.scope.projectId ? `&projectId=${data.scope.projectId}` : ""}`;
  const findings = data.findings.filter(
    (f) =>
      f.state !== "resolved" && ["missing-page", "suggestion"].includes(f.kind),
  );
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/workspaces/${w}/research?${scopeQuery}`, {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error);
        setProviders(value.providers);
        setProvider(value.providers[0]?.provider ?? "");
      })
      .catch((error) => {
        if (!abort.signal.aborted) setMessage(error.message);
      });
    return () => abort.abort();
  }, [w, scopeQuery]);
  if (!findings.length) return null;
  return (
    <section className="panel" aria-label="검토 항목 일괄 조사">
      <h2 className="content-subtitle">선택한 검토 항목 조사</h2>
      <p className="field-help">
        누락 문서와 보완 제안을 주제로 각각 조사합니다. 이미 진행 중인 항목은
        중복 실행하지 않습니다. 주제와 검색어를 먼저 다듬으려면 각 항목의 심층
        조사 링크를 이용해 주세요.
      </p>
      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setMessage("");
          void fetch(`/api/workspaces/${w}/research-batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...data.scope,
              requestId: crypto.randomUUID(),
              findingIds: selected,
              sourceMode: mode,
              provider: provider || null,
            }),
          })
            .then(async (response) => {
              const value = await response.json();
              if (!response.ok) throw new Error(value.error);
              setResult(value);
              setSelected(
                value.results
                  .filter((r: { error?: string }) => r.error)
                  .map((r: { findingId: string }) => r.findingId),
              );
              setMessage(
                "일괄 조사 요청을 처리했습니다. 아래에서 항목별 결과를 확인해 주세요.",
              );
            })
            .catch((error) => setMessage(error.message))
            .finally(() => setBusy(false));
        }}
      >
        <div className="field-grid">
          <Field>
            <FieldLabel htmlFor={`${id}-mode`}>조사 자료</FieldLabel>
            <Select value={mode} onValueChange={setMode} disabled={busy}>
              <SelectTrigger id={`${id}-mode`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">작업공간 공개 자료</SelectItem>
                <SelectItem value="web" disabled={!providers.length}>
                  웹 검색
                </SelectItem>
                <SelectItem value="both" disabled={!providers.length}>
                  웹 + 작업공간 자료
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {mode !== "local" && (
            <Field>
              <FieldLabel htmlFor={`${id}-provider`}>웹 검색 제공자</FieldLabel>
              <Select
                value={provider}
                onValueChange={setProvider}
                disabled={busy}
              >
                <SelectTrigger id={`${id}-provider`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.provider} value={p.provider}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
        {findings.map((f) => (
          <Field key={f.id} orientation="horizontal">
            <Checkbox
              id={`${id}-${f.id}`}
              checked={selected.includes(f.id)}
              disabled={
                busy || (!selected.includes(f.id) && selected.length >= 50)
              }
              onCheckedChange={(checked) =>
                setSelected((ids) =>
                  checked === true
                    ? [...ids, f.id]
                    : ids.filter((value) => value !== f.id),
                )
              }
            />
            <FieldLabel htmlFor={`${id}-${f.id}`}>{f.title}</FieldLabel>
          </Field>
        ))}
        <Button type="submit" disabled={busy || !selected.length}>
          선택 {selected.length}건 조사 시작
        </Button>
      </form>
      <output aria-live="polite">{message}</output>
      {result?.results.map((r) => (
        <p key={r.findingId}>
          {findings.find((f) => f.id === r.findingId)?.title} ·{" "}
          {r.error ?? (r.replay ? "기존 조사 확인" : "대기열 추가")}{" "}
          {r.id && (
            <Link href={`/w/${w}/tools/research?${scopeQuery}&id=${r.id}`}>
              조사 진행 보기 →
            </Link>
          )}
        </p>
      ))}
      {!!result?.skipped.length && (
        <p className="field-help">
          이미 처리되었거나 조사 대상이 아닌 {result.skipped.length}건을
          제외했습니다.
        </p>
      )}
    </section>
  );
}
