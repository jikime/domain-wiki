"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { QualityMaintenance } from "@/components/quality-maintenance";
import { QualityResearchBatch } from "@/components/quality-research-batch";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { locatorLabel } from "@/lib/content";
import { qualityLabels } from "@/lib/quality";
import type { qualityOverview } from "@/server/services/quality";

type Data = Awaited<ReturnType<typeof qualityOverview>>;
const states: Record<string, string> = {
  queued: "대기",
  running: "점검 중",
  completed: "완료",
  failed: "실패",
  outdated: "입력 변경",
  canceled: "중지",
  interrupted: "작업자 연결 종료",
  open: "새 후보",
  triaged: "확인 중",
  deferred: "보류",
  resolved: "처리 완료",
};
async function send(url: string, input: unknown, method = "POST") {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "저장하지 못했습니다.");
  return d;
}
function dateLabel(value: Date) {
  return `${new Date(new Date(value).getTime() + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ")} 한국시간`;
}

export function QualityWorkspace({
  workspaceId: w,
  domains,
  projects,
  data: d,
}: {
  workspaceId: string;
  domains: { id: string; name: string }[];
  projects: { id: string; name: string; domainId: string }[];
  data: Data;
}) {
  const id = useId(),
    router = useRouter();
  const [mode, setMode] = useState("structural"),
    [severity, setSeverity] = useState("all"),
    [state, setState] = useState("active"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [interval, setIntervalDays] = useState(String(d.policy.interval_days)),
    [revision, setRevision] = useState(Boolean(d.policy.after_revision)),
    [policyMode, setPolicyMode] = useState(String(d.policy.mode));
  const [ignoreOrphan, setIgnoreOrphan] = useState(
      Boolean(d.policy.structural_config?.ignoreOrphan),
    ),
    [ignoreNoOutlinks, setIgnoreNoOutlinks] = useState(
      Boolean(d.policy.structural_config?.ignoreNoOutlinks),
    ),
    [ignorePages, setIgnorePages] = useState(
      (d.policy.structural_config?.ignorePages ?? []).join("\n"),
    );
  const active = d.runs.some((r) => ["queued", "running"].includes(r.state));
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [active, router]);
  async function action(callback: () => Promise<unknown>, text: string) {
    setBusy(true);
    setMessage("");
    try {
      await callback();
      setMessage(text);
      router.refresh();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "요청을 처리하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  function scope(domainId: string, projectId: string | null) {
    router.push(
      `/w/${w}/quality?domainId=${domainId}${projectId ? `&projectId=${projectId}` : ""}`,
    );
  }
  const findings = d.findings.filter(
    (f) =>
      (severity === "all" || f.severity === severity) &&
      (state === "all" ||
        (state === "active" && f.state !== "resolved") ||
        state === f.state),
  );
  return (
    <>
      <section className="panel">
        <h2 className="content-subtitle">점검 범위</h2>
        <div className="field-grid">
          <Field>
            <FieldLabel htmlFor={`${id}-domain`}>도메인</FieldLabel>
            <Select
              value={d.scope.domainId}
              onValueChange={(v) => scope(v, null)}
              disabled={busy}
            >
              <SelectTrigger id={`${id}-domain`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {domains.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-project`}>프로젝트</FieldLabel>
            <Select
              value={d.scope.projectId ?? "all"}
              onValueChange={(v) =>
                scope(d.scope.domainId, v === "all" ? null : v)
              }
              disabled={busy}
            >
              <SelectTrigger id={`${id}-project`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">도메인 전체</SelectItem>
                {projects
                  .filter((p) => p.domainId === d.scope.domainId)
                  .map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name} + 공통 자료
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action(
              () =>
                send(`/api/workspaces/${w}/quality`, {
                  ...d.scope,
                  mode,
                  requestId: crypto.randomUUID(),
                  force: true,
                }),
              "점검을 등록했습니다. 결과는 자동으로 새로고침됩니다.",
            );
          }}
        >
          <Field>
            <FieldLabel htmlFor={`${id}-mode`}>점검 방법</FieldLabel>
            <Select value={mode} onValueChange={setMode} disabled={busy}>
              <SelectTrigger id={`${id}-mode`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="structural">구조·근거 점검</SelectItem>
                <SelectItem value="semantic">AI 의미 점검</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              구조 점검은 끊긴 연결과 근거 상태를 확인합니다. AI 점검은
              중복·상충·설명 보완 후보를 비교 구절과 함께 제안하며 모델 사용량이
              발생합니다.
            </FieldDescription>
          </Field>
          <div className="inline-actions">
            <Button type="submit" disabled={busy || active}>
              {active ? "점검 진행 중" : "현재 자료로 점검"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => router.refresh()}
            >
              새로고침
            </Button>
          </div>
        </form>
        <p className="field-help">
          게시 이력이 있는 페이지 {d.pages.length}개를 검사합니다. 근거가 개정된
          게시본도 검토 직원이 확인할 수 있습니다.
        </p>
        <output aria-live="polite">{message}</output>
      </section>
      <details className="panel">
        <summary>정기·개정 후 점검 설정</summary>
        <p className="field-help">
          설정은 도메인 전체에 적용됩니다. 기본값은 자동 점검을 사용하지
          않습니다. 실패한 입력을 반복 호출하지 않으며 새 점검은 직접 실행할 수
          있습니다.
        </p>
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action(
              () =>
                send(`/api/workspaces/${w}/quality-policy`, {
                  domainId: d.scope.domainId,
                  mode: policyMode,
                  intervalDays: Number(interval),
                  afterRevision: revision,
                  structuralConfig: {
                    ignoreOrphan,
                    ignoreNoOutlinks,
                    ignorePages: [
                      ...new Set(
                        ignorePages
                          .split(/[,，\n]/)
                          .map((s: string) => s.trim())
                          .filter(Boolean),
                      ),
                    ],
                  },
                }),
              "점검 설정을 저장했습니다.",
            );
          }}
        >
          <div className="field-grid">
            <Field>
              <FieldLabel htmlFor={`${id}-interval`}>정기 점검 주기</FieldLabel>
              <Select
                value={interval}
                onValueChange={setIntervalDays}
                disabled={busy}
              >
                <SelectTrigger id={`${id}-interval`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">사용하지 않음</SelectItem>
                  {[1, 7, 14, 30].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}일마다
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-policy-mode`}>
                자동 점검 방법
              </FieldLabel>
              <Select
                value={policyMode}
                onValueChange={setPolicyMode}
                disabled={busy}
              >
                <SelectTrigger id={`${id}-policy-mode`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="structural">구조·근거 점검</SelectItem>
                  <SelectItem value="semantic">
                    AI 의미 점검 · 모델 사용량 발생
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field orientation="horizontal">
            <Checkbox
              id={`${id}-revision`}
              checked={revision}
              onCheckedChange={(v) => setRevision(v === true)}
              disabled={busy}
            />
            <FieldLabel htmlFor={`${id}-revision`}>
              페이지·근거·목적 개정 후 다시 점검
            </FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id={`${id}-ignore-orphan`}
              checked={ignoreOrphan}
              onCheckedChange={(v) => setIgnoreOrphan(v === true)}
              disabled={busy}
            />
            <FieldLabel htmlFor={`${id}-ignore-orphan`}>
              들어오는 연결 없음 항목 제외
            </FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id={`${id}-ignore-outlinks`}
              checked={ignoreNoOutlinks}
              onCheckedChange={(v) => setIgnoreNoOutlinks(v === true)}
              disabled={busy}
            />
            <FieldLabel htmlFor={`${id}-ignore-outlinks`}>
              나가는 연결 없음 항목 제외
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-ignore-pages`}>
              구조 점검에서 제외할 문서
            </FieldLabel>
            <Textarea
              id={`${id}-ignore-pages`}
              value={ignorePages}
              onChange={(e) => setIgnorePages(e.target.value)}
              disabled={busy}
              maxLength={20000}
              aria-describedby={`${id}-ignore-help`}
            />
            <FieldDescription id={`${id}-ignore-help`}>
              위키 경로 또는 문서 ID를 한 줄에 하나씩 적습니다. 원문 근거 점검은
              계속 수행합니다.
            </FieldDescription>
          </Field>
          <Button type="submit" disabled={busy}>
            점검 설정 저장
          </Button>
        </form>
      </details>
      <section className="panel">
        <h2 className="content-subtitle">최근 실행</h2>
        {d.runs.map((r) => (
          <div className="decision-row" key={r.id}>
            <strong>
              {r.mode === "semantic" ? "AI 의미" : "구조·근거"} 점검 ·{" "}
              {states[r.state]}
              {!r.current ? " · 현재 자료로 재확인 필요" : ""}
            </strong>
            <p>
              {r.origin === "manual"
                ? "수동"
                : r.origin === "revision"
                  ? "개정 후"
                  : "정기"}{" "}
              · {dateLabel(r.created_at)}
              {r.mode === "semantic"
                ? ` · 비교 ${r.completed_steps}/${r.coverage.steps ?? 0}구간`
                : ""}
            </p>
            {typeof r.coverage.comparison === "string" && (
              <p className="field-help">{r.coverage.comparison}</p>
            )}
            {r.error_message && <p className="notice-box">{r.error_message}</p>}
            {["queued", "running"].includes(r.state) && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void action(
                    () =>
                      send(
                        `/api/workspaces/${w}/quality/${r.id}`,
                        { action: "cancel" },
                        "PATCH",
                      ),
                    "점검을 중지했습니다.",
                  )
                }
              >
                점검 중지
              </Button>
            )}
          </div>
        ))}
        {!d.runs.length && (
          <p className="empty-copy">아직 실행한 점검이 없습니다.</p>
        )}
      </section>
      <section className="panel">
        <h2 className="content-subtitle">검토할 후보</h2>
        <p className="notice-box">
          AI 후보는 검토 전 판단입니다. 연결이 적거나 목적 밖의 내용이라는
          이유로 문서를 오류로 단정하지 않습니다. 본문 수정은 별도 변경안과 게시
          검토를 거칩니다.
        </p>
        <div className="field-grid">
          <Field>
            <FieldLabel htmlFor={`${id}-severity`}>심각도</FieldLabel>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger id={`${id}-severity`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">모든 심각도</SelectItem>
                <SelectItem value="error">수정 필요</SelectItem>
                <SelectItem value="warning">확인 필요</SelectItem>
                <SelectItem value="info">참고 안내</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-state`}>처리 상태</FieldLabel>
            <Select value={state} onValueChange={setState}>
              <SelectTrigger id={`${id}-state`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">처리 전</SelectItem>
                <SelectItem value="deferred">보류</SelectItem>
                <SelectItem value="resolved">처리 완료</SelectItem>
                <SelectItem value="all">전체 이력</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <p className="field-help">표시 {findings.length}건 · 최대 500건</p>
      </section>
      <QualityMaintenance
        key={`${d.scope.domainId}:${d.scope.projectId}`}
        workspaceId={w}
        data={d}
      />
      <QualityResearchBatch
        key={`research:${d.scope.domainId}:${d.scope.projectId}`}
        workspaceId={w}
        data={d}
      />
      {findings.map((f) => (
        <article className="panel" key={f.id} id={`finding-${f.id}`}>
          <div className="section-heading">
            <h2 className="content-subtitle">{f.title}</h2>
            <span className="state-label">{qualityLabels[f.kind]}</span>
          </div>
          <p className="field-help">
            {f.severity === "error"
              ? "수정 필요"
              : f.severity === "warning"
                ? "확인 필요"
                : "참고 안내"}{" "}
            · {states[f.state]} · {f.assignee_name ?? "담당 미지정"} · 발견{" "}
            {f.occurrences}회
          </p>
          {!f.current && (
            <p className="notice-box">
              페이지·원문·목적이 변경되어 이전 판정입니다. 현재 자료로 재점검한
              뒤 처리해 주세요.
            </p>
          )}
          {!f.present && f.mode === "semantic" && (
            <p className="notice-box">
              이번 AI 점검에서 재발견되지 않았습니다. 아래는 이전 비교
              구절입니다. 해결 여부는 원문과 수정 내용을 확인한 뒤 검토함에서
              결정해 주세요.
            </p>
          )}
          <p className="whitespace-pre-wrap">{f.note}</p>
          {f.state !== "resolved" &&
            ["missing-page", "suggestion"].includes(f.kind) && (
              <Link
                href={`/w/${w}/tools/research?domainId=${d.scope.domainId}${d.scope.projectId ? `&projectId=${d.scope.projectId}` : ""}&reviewId=${f.id}`}
              >
                이 검토 항목으로 심층 조사 →
              </Link>
            )}
          {(f.suggestion?.targetId || f.suggestion?.sourceId) && (
            <div className="inline-actions">
              {[f.suggestion.targetId, f.suggestion.sourceId]
                .filter((id): id is string => !!id)
                .filter((id, i, all) => all.indexOf(id) === i)
                .map((id) => (
                  <Link key={id} href={`/w/${w}/wiki/${id}`}>
                    연결 제안:{" "}
                    {d.pages.find((p) => p.id === id)?.title ?? "관련 위키"} →
                  </Link>
                ))}
            </div>
          )}
          {f.quotes.map((q, i) => (
            <figure key={`${q.pageId}:${q.start}:${i}`}>
              <blockquote className="notice-box">{q.quote}</blockquote>
              <figcaption>
                <Link href={`/w/${w}/wiki/${q.pageId}?version=${q.versionId}`}>
                  {d.pages.find((p) => p.id === q.pageId)?.title ??
                    "점검한 위키 버전"}{" "}
                  · 비교 구절 확인 →
                </Link>
              </figcaption>
            </figure>
          ))}
          {f.purpose_question && (
            <p className="notice-box">
              핵심 질문: {f.purpose_question}
              <br />
              설명을 보완하거나 목적 변경이 필요한지 검토해 주세요. 목적은
              관리자가 별도로 저장합니다.{" "}
              {d.isAdmin && (
                <Link href={`/w/${w}/admin`}>도메인 목적 관리 →</Link>
              )}
            </p>
          )}
          {f.page_ids.map((pageId) => {
            const p = d.pages.find((p) => p.id === pageId);
            return (
              <div className="decision-row" key={pageId}>
                <div className="inline-actions">
                  <Link href={`/w/${w}/wiki/${pageId}`}>
                    {p?.title ?? "대상 위키"} 보기 →
                  </Link>
                  <Link href={`/w/${w}/wiki/${pageId}/edit`}>
                    수정 변경안 작성 →
                  </Link>
                </div>
                {p && (
                  <details>
                    <summary>연결 원문 {p.evidence.length}개</summary>
                    {p.evidence.map((e) => (
                      <p key={e.chunkId}>
                        <Link
                          href={`/w/${w}/sources/${e.id}?version=${e.versionId}#chunk-${e.chunkId}`}
                        >
                          {e.title} · {locatorLabel(e.locator)}
                        </Link>
                        {!e.current && " · 개정·철회되어 재확인 필요"}
                      </p>
                    ))}
                    {!p.evidence.length && (
                      <p className="field-help">
                        연결된 원문이 없습니다. 수정 변경안에서 원문을 연결해
                        주세요.
                      </p>
                    )}
                  </details>
                )}
              </div>
            );
          })}
          <Link
            className="space-link"
            href={`/w/${w}/reviews/desk?kind=quality&targetId=${f.id}`}
          >
            담당 지정·보류·처리 이력 →
          </Link>
          {f.resolution && (
            <p className="field-help whitespace-pre-wrap">
              최근 처리 사유: {f.resolution}
            </p>
          )}
        </article>
      ))}
      {!findings.length && (
        <p className="empty-copy">
          선택한 조건에 맞는 후보가 없습니다. 점검 결과가 없다는 사실만으로
          내용의 정확성을 보장하지는 않습니다.
        </p>
      )}
    </>
  );
}
