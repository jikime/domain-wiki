"use client";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import {
  confirmDraftNavigation,
  DraftNotice,
  useDraft,
} from "@/components/draft-controls";
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
import { rfpKindLabels } from "@/lib/business";
import { locatorLabel, sourceCategories } from "@/lib/content";
import { rfpDraft } from "@/lib/drafts";
import type { RfpSection } from "@/server/db/schema";
import type { rfpContext, rfpDetails } from "@/server/services/rfp";

type Context = Awaited<ReturnType<typeof rfpContext>>;
async function post(url: string, data: unknown, signal?: AbortSignal) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal,
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error);
  return result;
}
export function RfpSourceChooser({
  workspaceId,
  sourceId,
  items,
}: {
  workspaceId: string;
  sourceId?: string;
  items: { id: string; title: string }[];
}) {
  const router = useRouter();
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>분석할 RFP 원문</FieldLabel>
      <Select
        value={sourceId ?? ""}
        onValueChange={(v) => {
          if (confirmDraftNavigation())
            router.push(`/w/${workspaceId}/tools/rfp/new?sourceId=${v}`);
        }}
      >
        <SelectTrigger className="w-full" id={id}>
          <SelectValue placeholder="공개된 RFP 문서를 선택하세요" />
        </SelectTrigger>
        <SelectContent>
          {items.map((s) => (
            <SelectItem value={s.id} key={s.id}>
              {s.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        자료실에서 원문 등록·공개 검토를 마친 문서를 선택하세요.
      </FieldDescription>
    </Field>
  );
}
export function RfpEditor({
  workspaceId,
  context,
  initial,
  modelConfigured,
}: {
  workspaceId: string;
  context: Context;
  initial?: Awaited<ReturnType<typeof rfpDetails>>;
  modelConfigured: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [title, setTitle] = useState(
    initial?.version.title ?? `${context.source.title} · 요구 분석`,
  );
  const blank = (): RfpSection => ({
    kind: "requirement",
    title: "",
    meaning: "",
    quote: "",
    chunkIds: [],
    questions: [],
  });
  const [rows, setRows] = useState(() =>
    (initial?.version.sections ?? [blank()]).map((r, i) => ({
      ...r,
      key: `initial-${i}`,
      query: "",
    })),
  );
  const [related, setRelated] = useState(context.related);
  const [relatedQuery, setRelatedQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [aiSelected, setAiSelected] = useState<string[]>([]);
  const [aiQuery, setAiQuery] = useState("");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [controller, setController] = useState<AbortController | null>(null);
  const draft = useDraft({
    id: `${workspaceId}:rfp:${context.source.id}:${initial?.version.id ?? context.source.publishedVersionId}`,
    value: { title, rows, aiSelected, focus },
    schema: rfpDraft,
    restore: (value) => {
      setTitle(value.title);
      setRows(value.rows);
      setAiSelected(value.aiSelected);
      setFocus(value.focus);
    },
  });
  const selected = useSelectedEvidence(
    workspaceId,
    context.source.domainId,
    context.source.projectId,
    [...aiSelected, ...rows.flatMap((row) => row.chunkIds)],
  );
  const sourceChunks = context.chunks.map((c) => ({
    ...c,
    sourceId: context.source.id,
    title: context.source.title,
    category: context.source.category,
    versionId: c.versionId,
    versionNumber: 0,
  }));
  const candidates = [
    ...new Map(
      [
        ...sourceChunks,
        ...related,
        ...(initial?.evidence ?? []),
        ...selected.items,
      ].map((c) => [c.id, c]),
    ).values(),
  ];
  const update = (key: string, patch: Partial<(typeof rows)[number]>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <form
      className="stack-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          const result = await post(
            `/api/workspaces/${workspaceId}/rfp${initial ? `/${initial.report.id}` : ""}`,
            {
              title,
              sourceId: context.source.id,
              parentVersionId: initial?.report.latestVersionId ?? null,
              basePublishedVersionId:
                initial?.report.publishedVersionId ?? null,
              sections: rows.map(({ key: _, query: __, ...r }) => ({
                ...r,
                questions: r.questions.map((q) => q.trim()).filter(Boolean),
              })),
            },
          );
          draft.clear();
          router.push(`/w/${workspaceId}/tools/rfp/${result.reportId}`);
          router.refresh();
        } catch (error) {
          setMessage(
            error instanceof Error ? error.message : "저장하지 못했습니다.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <DraftNotice draft={draft} />
      {selected.error && <p role="alert">{selected.error}</p>}
      <section className="panel">
        <h2 className="content-subtitle">분석할 문서와 참고 근거</h2>
        <p>
          {context.source.title} · RFP 원문 {context.chunks.length}개 문단
        </p>
        <p className="field-help">
          {context.notice} 관련 자료는 추천 후보입니다. 실제 적용 여부를 검토해
          주세요.
        </p>
        <Field>
          <FieldLabel htmlFor={`${id}-search`}>
            관련 기준·사례 더 찾기
          </FieldLabel>
          <Input
            id={`${id}-search`}
            value={relatedQuery}
            onChange={(e) => setRelatedQuery(e.target.value)}
            maxLength={1000}
            placeholder="관련 업무·요구를 입력하세요"
          />
        </Field>
        <Button
          type="button"
          variant="outline"
          disabled={busy || searching || !relatedQuery.trim()}
          onClick={async () => {
            setSearching(true);
            setMessage("");
            try {
              const response = await fetch(
                `/api/workspaces/${workspaceId}/rfp-context/${context.source.id}?q=${encodeURIComponent(relatedQuery)}`,
              );
              const found = await response.json();
              if (!response.ok) throw new Error(found.error);
              setRelated((items) => [
                ...new Map(
                  [...items, ...found.related].map((c) => [c.id, c]),
                ).values(),
              ]);
              setMessage(`관련 원문 ${found.related.length}개를 확인했습니다.`);
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : "검색하지 못했습니다.",
              );
            } finally {
              setSearching(false);
            }
          }}
        >
          관련 원문 찾기
        </Button>
        <p className="field-help">
          확보한 참고 문단 {related.length}개. 아래 항목에서 기준·사례를
          선택하면 해당 원문을 인용할 수 있습니다.
        </p>
      </section>
      {!initial && (
        <section className="panel">
          <h2 className="content-subtitle">AI로 분석 초안 만들기</h2>
          <p className="field-help">
            전달할 문단을 선택하세요. RFP 최대 20개·참고 최대 10개, 총
            28,000자까지 분석합니다.
          </p>
          {!modelConfigured && (
            <p className="notice-box">
              AI 모델 설정이 필요합니다. 아래 양식에서 직접 작성할 수 있습니다.
            </p>
          )}
          <Field>
            <FieldLabel htmlFor={`${id}-ai-search`}>
              AI에 전달할 문단 검색
            </FieldLabel>
            <Input
              id={`${id}-ai-search`}
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              placeholder="문단의 단어로 검색"
            />
          </Field>
          <div className="evidence-picker">
            {candidates
              .filter(
                (c) =>
                  !aiQuery ||
                  c.text.toLowerCase().includes(aiQuery.toLowerCase()),
              )
              .slice(0, 40)
              .map((c) => (
                <Field orientation="horizontal" key={c.id}>
                  <Checkbox
                    id={`${id}-ai-${c.id}`}
                    checked={aiSelected.includes(c.id)}
                    disabled={busy}
                    onCheckedChange={(v) =>
                      setAiSelected((ids) =>
                        v === true
                          ? [...ids, c.id]
                          : ids.filter((x) => x !== c.id),
                      )
                    }
                  />
                  <FieldContent>
                    <FieldLabel htmlFor={`${id}-ai-${c.id}`}>
                      {c.sourceId === context.source.id ? "RFP" : "참고"} ·{" "}
                      {c.text.slice(0, 180)}
                    </FieldLabel>
                  </FieldContent>
                </Field>
              ))}
          </div>
          <p className="field-help">
            선택 {aiSelected.length}개 · 검색 결과는 한 번에 40개까지
            표시합니다.
          </p>
          <Field>
            <FieldLabel htmlFor={`${id}-focus`}>
              특히 확인할 업무·범위
            </FieldLabel>
            <Textarea
              id={`${id}-focus`}
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              maxLength={1000}
              disabled={busy}
            />
          </Field>
          <div className="form-actions">
            <Button
              type="button"
              disabled={
                busy ||
                !modelConfigured ||
                !aiSelected.some((id) => sourceChunks.some((c) => c.id === id))
              }
              onClick={async () => {
                const abort = new AbortController();
                setController(abort);
                setBusy(true);
                setMessage("");
                try {
                  const result = await post(
                    `/api/workspaces/${workspaceId}/rfp-generations`,
                    {
                      requestId: crypto.randomUUID(),
                      sourceId: context.source.id,
                      chunkIds: aiSelected.filter((id) =>
                        sourceChunks.some((c) => c.id === id),
                      ),
                      contextChunkIds: aiSelected.filter(
                        (id) => !sourceChunks.some((c) => c.id === id),
                      ),
                      focus,
                    },
                    abort.signal,
                  );
                  if (result.state !== "completed")
                    throw new Error(
                      result.errorMessage ?? "생성이 끝나지 않았습니다.",
                    );
                  router.push(
                    `/w/${workspaceId}/tools/rfp/${result.result.reportId}`,
                  );
                } catch (error) {
                  setMessage(
                    abort.signal.aborted
                      ? "분석을 중지했습니다. 새 요청으로 다시 시도할 수 있습니다."
                      : error instanceof Error
                        ? error.message
                        : "분석하지 못했습니다.",
                  );
                } finally {
                  setController(null);
                  setBusy(false);
                }
              }}
            >
              {busy && controller ? "분석 중…" : "AI 분석 초안 만들기"}
            </Button>
            {controller && (
              <Button
                type="button"
                variant="outline"
                onClick={() => controller.abort()}
              >
                분석 중지
              </Button>
            )}
          </div>
        </section>
      )}
      <section className="panel">
        <h2 className="content-subtitle">직접 작성·수정</h2>
        <Field>
          <FieldLabel htmlFor={`${id}-title`}>보고서 제목</FieldLabel>
          <Input
            id={`${id}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={160}
            disabled={busy}
          />
        </Field>
      </section>
      {rows.map((row, index) => {
        const options = candidates
          .filter((c) =>
            row.kind === "requirement" || row.kind === "unclear"
              ? c.sourceId === context.source.id
              : row.kind === "standard"
                ? c.sourceId !== context.source.id && c.category === "guideline"
                : row.kind === "case"
                  ? c.sourceId !== context.source.id &&
                    ["project", "testimony"].includes(c.category)
                  : true,
          )
          .filter(
            (c) =>
              !row.query ||
              `${c.title} ${c.text}`
                .toLowerCase()
                .includes(row.query.toLowerCase()),
          )
          .slice(0, 30);
        const fid = `${id}-${row.key}`;
        return (
          <section className="panel stack-form" key={row.key}>
            <div className="section-heading">
              <h2 className="content-subtitle">분석 항목 {index + 1}</h2>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || rows.length === 1}
                onClick={() =>
                  setRows((rs) => rs.filter((r) => r.key !== row.key))
                }
              >
                항목 삭제
              </Button>
            </div>
            <Field>
              <FieldLabel htmlFor={`${fid}-kind`}>
                항목 {index + 1} 구분
              </FieldLabel>
              <Select
                value={row.kind}
                onValueChange={(v) =>
                  update(row.key, {
                    kind: v as RfpSection["kind"],
                    chunkIds: [],
                    quote: "",
                  })
                }
                disabled={busy}
              >
                <SelectTrigger id={`${fid}-kind`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(rfpKindLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fid}-title`}>
                항목 {index + 1} 제목
              </FieldLabel>
              <Input
                id={`${fid}-title`}
                value={row.title}
                onChange={(e) => update(row.key, { title: e.target.value })}
                required
                maxLength={160}
                disabled={busy}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fid}-meaning`}>
                항목 {index + 1} 의미·적용 범위
              </FieldLabel>
              <Textarea
                id={`${fid}-meaning`}
                value={row.meaning}
                onChange={(e) => update(row.key, { meaning: e.target.value })}
                required
                maxLength={4000}
                disabled={busy}
              />
            </Field>
            <details>
              <summary>근거 문단 선택 · 현재 {row.chunkIds.length}개</summary>
              <Field>
                <FieldLabel htmlFor={`${fid}-query`}>
                  항목 {index + 1} 원문 검색
                </FieldLabel>
                <Input
                  id={`${fid}-query`}
                  value={row.query}
                  onChange={(e) => update(row.key, { query: e.target.value })}
                  maxLength={300}
                />
              </Field>
              <div className="evidence-picker">
                {options.map((c) => (
                  <div className="decision-row" key={c.id}>
                    <Field orientation="horizontal">
                      <Checkbox
                        id={`${fid}-${c.id}`}
                        checked={row.chunkIds.includes(c.id)}
                        disabled={busy}
                        onCheckedChange={(v) =>
                          update(row.key, {
                            chunkIds:
                              v === true
                                ? [...row.chunkIds, c.id]
                                : row.chunkIds.filter((x) => x !== c.id),
                          })
                        }
                      />
                      <FieldContent>
                        <FieldLabel htmlFor={`${fid}-${c.id}`}>
                          {c.title} ·{" "}
                          {
                            sourceCategories[
                              c.category as keyof typeof sourceCategories
                            ]
                          }
                        </FieldLabel>
                        <p>{c.text}</p>
                        <small>{locatorLabel(c.locator)}</small>
                      </FieldContent>
                    </Field>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        update(row.key, {
                          quote: c.text.slice(0, 2000),
                          chunkIds: [...new Set([...row.chunkIds, c.id])],
                        })
                      }
                    >
                      이 문단 인용
                    </Button>
                  </div>
                ))}
                {!options.length && (
                  <p className="empty-copy">
                    조건에 맞는 문단이 없습니다. 관련 원문을 더 찾거나 직접
                    자료를 등록해 주세요.
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => update(row.key, { chunkIds: [], quote: "" })}
              >
                이 항목의 근거 선택 지우기
              </Button>
              <p className="field-help">
                검색 결과는 최대 30개씩 표시합니다. 선택한 문단 중 원문 구절이
                있어야 저장할 수 있습니다.
              </p>
            </details>
            <Field>
              <FieldLabel htmlFor={`${fid}-quote`}>
                항목 {index + 1} 원문 구절
              </FieldLabel>
              <Textarea
                id={`${fid}-quote`}
                value={row.quote}
                onChange={(e) => update(row.key, { quote: e.target.value })}
                maxLength={2000}
                disabled={busy}
                required={["requirement", "standard", "case"].includes(
                  row.kind,
                )}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fid}-questions`}>
                항목 {index + 1} 확인 질문
              </FieldLabel>
              <Textarea
                id={`${fid}-questions`}
                value={row.questions.join("\n")}
                onChange={(e) =>
                  update(row.key, {
                    questions: e.target.value.split("\n").slice(0, 8),
                  })
                }
                disabled={busy}
                maxLength={8000}
              />
              <FieldDescription>
                한 줄에 하나씩, 최대 8개. 추론·불명확한 범위에는 질문이
                필요합니다.
              </FieldDescription>
            </Field>
          </section>
        );
      })}
      <div className="form-actions">
        <Button
          type="button"
          variant="outline"
          disabled={busy || rows.length >= 30}
          onClick={() =>
            setRows((rs) => [
              ...rs,
              { ...blank(), key: crypto.randomUUID(), query: "" },
            ])
          }
        >
          분석 항목 추가
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "처리 중…" : "검토 전 초안 저장"}
        </Button>
      </div>
      <output aria-live="polite">{message}</output>
    </form>
  );
}
