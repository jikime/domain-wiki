"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import type {
  QualityFixPreview,
  QualitySweepPreview,
} from "@/lib/quality-actions";
import { buildWordDiff } from "@/lib/reference/selection-edit";
import type { qualityOverview } from "@/server/services/quality";

export function QualityMaintenance({
  workspaceId: w,
  data,
}: {
  workspaceId: string;
  data: Awaited<ReturnType<typeof qualityOverview>>;
}) {
  const id = useId(),
    router = useRouter();
  const [selected, setSelected] = useState<string[]>([]),
    [resolveIds, setResolveIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<QualityFixPreview | null>(null),
    [sweep, setSweep] = useState<QualitySweepPreview | null>(null);
  const [drafts, setDrafts] = useState<
    { pageId: string; title: string; newStub: boolean }[]
  >([]);
  const [useAi, setUseAi] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const eligible = data.findings.filter(
    (f) =>
      f.current &&
      f.present &&
      f.state !== "resolved" &&
      f.mode === "structural" &&
      (f.kind === "broken-link" ||
        (f.kind === "orphan" && f.suggestion.sourceId) ||
        (f.kind === "no-outlinks" && f.suggestion.targetId)),
  );
  async function send(resource: string, input: unknown, signal: AbortSignal) {
    const response = await fetch(`/api/workspaces/${w}/${resource}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data.scope, ...(input as object) }),
      signal,
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "요청을 처리하지 못했습니다.");
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
      setMessage(
        controller.signal.aborted
          ? "검토 정리를 중지했습니다."
          : error instanceof Error
            ? error.message
            : "요청을 처리하지 못했습니다.",
      );
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }
  return (
    <section className="panel">
      <h2 className="content-subtitle">연결 수정·검토 정리</h2>
      <p className="field-help">
        연결 수정 내용을 비교한 뒤 초안으로 저장합니다. 게시 검토를 마치고 구조
        점검을 다시 실행하면 해결된 연결 항목이 정리됩니다.
      </p>
      <details>
        <summary>수정 가능한 연결 {eligible.length}건</summary>
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            void action(async (signal) => {
              setPreview(
                await send(
                  "quality-fixes",
                  { action: "preview", findingIds: selected },
                  signal,
                ),
              );
              setDrafts([]);
            });
          }}
        >
          {eligible.map((finding) => (
            <Field key={finding.id} orientation="horizontal">
              <Checkbox
                id={`${id}-fix-${finding.id}`}
                checked={selected.includes(finding.id)}
                disabled={
                  busy ||
                  (selected.length >= 50 && !selected.includes(finding.id))
                }
                onCheckedChange={(checked) => {
                  setPreview(null);
                  setSelected((current) =>
                    checked === true
                      ? [...current, finding.id]
                      : current.filter((value) => value !== finding.id),
                  );
                }}
              />
              <FieldLabel htmlFor={`${id}-fix-${finding.id}`}>
                {finding.title}
              </FieldLabel>
              <a href={`#finding-${finding.id}`}>상세</a>
            </Field>
          ))}
          <Button
            type="submit"
            variant="outline"
            disabled={busy || !selected.length}
          >
            선택한 연결 수정 미리보기 ({selected.length}/50)
          </Button>
        </form>
      </details>
      {preview && (
        <div className="stack-form">
          <h3>수정할 초안 {preview.changes.length}개</h3>
          {preview.changes.map((change) => (
            <details key={`${change.projectId}:${change.path}`} open>
              <summary>
                {change.title}
                {change.pageId ? " · 연결 수정" : " · 새 빈 문서"}
              </summary>
              <p className="field-help">{change.path}</p>
              <section
                className="selection-diff whitespace-pre-wrap"
                aria-label={`${change.title} 수정 비교`}
              >
                {buildWordDiff(change.before, change.after).map(
                  (part, index) =>
                    part.type === "insert" ? (
                      <ins key={`${index}-${part.type}`}>{part.value}</ins>
                    ) : part.type === "delete" ? (
                      <del key={`${index}-${part.type}`}>{part.value}</del>
                    ) : (
                      <span key={`${index}-${part.type}`}>{part.value}</span>
                    ),
                )}
              </section>
            </details>
          ))}
          <p className="field-help">
            새 빈 문서는 원문 근거가 없는 초안입니다. 내용을 작성하고 근거를
            연결한 뒤 게시 검토를 요청해 주세요.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              void action(async (signal) => {
                const result = await send(
                  "quality-fixes",
                  {
                    action: "apply",
                    findingIds: selected,
                    basis: preview.basis,
                  },
                  signal,
                );
                setDrafts(result.drafts);
                setPreview(null);
                setSelected([]);
                setMessage(
                  "연결 수정 초안을 저장했습니다. 각 초안에서 검토를 요청할 수 있습니다.",
                );
                router.refresh();
              })
            }
          >
            확인한 수정 내용을 초안으로 저장
          </Button>
        </div>
      )}
      {drafts.map((draft) => (
        <p key={draft.pageId}>
          <Link href={`/w/${w}/wiki/${draft.pageId}/edit`}>
            {draft.title} · {draft.newStub ? "빈 문서 작성" : "수정 초안 확인"}{" "}
            →
          </Link>
        </p>
      ))}
      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action(async (signal) => {
            setSweep(null);
            setResolveIds([]);
            setSweep(
              await send(
                "quality-sweep",
                { action: "preview", requestId: crypto.randomUUID(), useAi },
                signal,
              ),
            );
          });
        }}
      >
        <p className="field-help">
          현재 문서 이름·제목을 대조해 오래된 검토 항목을 찾습니다. AI 재검토는
          최대 200건을 40건씩 확인하고, 해결 후보가 없는 묶음에서 멈춥니다.
          상충·제안 등 사람의 판단이 필요한 항목은 유지합니다.
        </p>
        <Field orientation="horizontal">
          <Checkbox
            id={`${id}-ai`}
            checked={useAi}
            onCheckedChange={(value) => setUseAi(value === true)}
            disabled={busy}
          />
          <FieldLabel htmlFor={`${id}-ai`}>
            AI 재검토 함께 실행 · 모델 사용량 발생
          </FieldLabel>
        </Field>
        <div className="inline-actions">
          <Button type="submit" variant="outline" disabled={busy}>
            검토 정리 미리보기
          </Button>
          {busy && (
            <Button
              type="button"
              variant="outline"
              onClick={() => abort.current?.abort()}
            >
              중지
            </Button>
          )}
        </div>
      </form>
      {sweep && (
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            void action(async (signal) => {
              const result = await send(
                "quality-sweep",
                {
                  action: "apply",
                  id: sweep.id,
                  basis: sweep.basis,
                  findingIds: resolveIds,
                },
                signal,
              );
              setMessage(
                `${result.resolved}건을 해결 처리했습니다. 처리 이력은 검토함에 남습니다.`,
              );
              setSweep(null);
              setResolveIds([]);
              router.refresh();
            });
          }}
        >
          <p>
            처리 전 {sweep.pending}건 · AI 재검토 {sweep.judged}건 · 해결 후보{" "}
            {sweep.candidates.length}건
          </p>
          {sweep.candidates.map((candidate) => (
            <Field key={candidate.id} orientation="horizontal">
              <Checkbox
                id={`${id}-resolve-${candidate.id}`}
                disabled={busy}
                checked={resolveIds.includes(candidate.id)}
                onCheckedChange={(checked) =>
                  setResolveIds((current) =>
                    checked === true
                      ? [...current, candidate.id]
                      : current.filter((value) => value !== candidate.id),
                  )
                }
              />
              <FieldLabel htmlFor={`${id}-resolve-${candidate.id}`}>
                {candidate.title} ·{" "}
                {candidate.method === "rule" ? "이름 대조" : "AI 후보"}
              </FieldLabel>
              <a href={`#finding-${candidate.id}`}>상세</a>
            </Field>
          ))}
          <Button type="submit" disabled={busy || !resolveIds.length}>
            확인한 항목 {resolveIds.length}건 해결 처리
          </Button>
        </form>
      )}
      <output aria-live="polite">{message}</output>
    </section>
  );
}
