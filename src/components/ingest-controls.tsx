"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { type IngestSummary, ingestLabels } from "@/lib/ingest";
import { batchLabels } from "@/lib/proposals";

export function IngestControls({
  workspaceId,
  sourceId,
  enabled,
  canStart,
  items,
}: {
  workspaceId: string;
  sourceId: string;
  enabled: boolean;
  canStart: boolean;
  items: IngestSummary[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false),
    [refreshing, refresh] = useTransition(),
    [message, setMessage] = useState("");
  const busy = pending || refreshing;
  const active = items.some((r) =>
    ["waiting", "analysis", "generation"].includes(r.state),
  );
  const awaitingAutomatic = enabled && canStart && items.length === 0;
  useEffect(() => {
    if (!active && !awaitingAutomatic) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        refresh(() => router.refresh());
    }, 3000);
    return () => clearInterval(timer);
  }, [active, awaitingAutomatic, router]);
  async function act(id?: string, action?: "cancel" | "retry") {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/ingest-runs${id ? `/${id}` : ""}`,
        {
          method: id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(id ? { action } : { sourceId }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(
        result.replay
          ? "같은 기준의 정리 이력이 있습니다. 아래 상태와 결과를 확인해 주세요."
          : action === "cancel"
            ? "정리를 중지했습니다."
            : "정리 작업을 등록했습니다.",
      );
      refresh(() => router.refresh());
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "정리 작업을 처리하지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel" id="source-ingest" aria-label="자료 자동 정리">
      <h2 className="content-subtitle">자료 자동 정리</h2>
      <p className="field-help">
        도메인 자동 정리 {enabled ? "켜짐" : "꺼짐"}. 전체 분석부터 위키
        변경안까지 이어 처리합니다. 같은 기준의 유효한 결과와 바뀌지 않은 분석
        구간은 재사용합니다.
      </p>
      {canStart && (
        <Button disabled={busy || active} onClick={() => act()}>
          자료 정리 실행
        </Button>
      )}
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => refresh(() => router.refresh())}
      >
        정리 상태 새로고침
      </Button>
      {message && <output className="notice-box">{message}</output>}
      {items.map((run) => (
        <article className="decision-row" key={run.id}>
          <strong>{ingestLabels[run.state]}</strong>
          <p className="field-help">
            {run.origin === "automatic"
              ? "공개 승인 후 자동 실행"
              : "직원 실행"}{" "}
            ·{" "}
            <time dateTime={run.createdAt}>
              {new Date(Date.parse(run.createdAt) + 9 * 60 * 60 * 1000)
                .toISOString()
                .slice(0, 16)
                .replace("T", " ")}{" "}
              (한국 시간)
            </time>
          </p>
          {run.errorMessage && <p className="notice-box">{run.errorMessage}</p>}
          {run.reusedAnalysis && (
            <p className="field-help">완료된 전체 분석 재사용</p>
          )}
          {(run.reusedUnits > 0 || run.reusedPages > 0) && (
            <p className="field-help">
              분석 {run.reusedUnits}구간 · 위키 본문 {run.reusedPages}개 재사용
            </p>
          )}
          {!run.manageable && (
            <p className="field-help">
              다른 직원이 진행한 정리입니다. 상세 결과는 작성자와 검토 직원이
              확인합니다.
            </p>
          )}
          <div className="form-actions">
            {run.analysisTaskId && (
              <Link href={`/w/${workspaceId}/ai-tasks/${run.analysisTaskId}`}>
                전체 분석 보기 →
              </Link>
            )}
            {run.generationTaskId && (
              <Link href={`/w/${workspaceId}/ai-tasks/${run.generationTaskId}`}>
                위키 생성 보기 →
              </Link>
            )}
            {run.manageable &&
              ["waiting", "analysis", "generation"].includes(run.state) && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => act(run.id, "cancel")}
                >
                  정리 중지
                </Button>
              )}
            {run.manageable &&
              run.current &&
              ["failed", "canceled"].includes(run.state) && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => act(run.id, "retry")}
                >
                  정리 재시도
                </Button>
              )}
          </div>
          {run.groups.length > 0 && (
            <ul className="ai-task-links">
              {run.groups.map((group) => (
                <li key={group.id}>
                  <Link href={`/w/${workspaceId}/proposals/${group.id}`}>
                    변경 묶음 {group.ordinal} ·{" "}
                    {batchLabels[group.state] ?? group.state}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}
