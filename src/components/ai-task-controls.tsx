"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { aiTaskLabels } from "@/lib/ai-task";
export function AiTaskStart({
  workspaceId,
  sourceId,
  tasks,
}: {
  workspaceId: string;
  sourceId: string;
  tasks: { id: string; kind: string; state: string }[];
}) {
  const router = useRouter();
  const requestId = useRef<Partial<Record<"summary" | "analysis", string>>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="panel" aria-label="문서 AI 작업">
      <h2 className="content-subtitle">문서 AI 작업</h2>
      <p className="field-help">
        현재 공개 원문 전체의 핵심 내용과 조건을 분석합니다. 화면을 닫아도
        서버에서 계속 처리하며, 결과는 작성·검토 직원이 확인합니다.
      </p>
      <div className="form-actions">
        {(["analysis", "summary"] as const).map((kind) => (
          <Button
            key={kind}
            disabled={busy}
            variant="outline"
            onClick={async () => {
              setBusy(true);
              setError("");
              requestId.current[kind] ??= crypto.randomUUID();
              try {
                const r = await fetch(
                  `/api/workspaces/${workspaceId}/ai-tasks`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      requestId: requestId.current[kind],
                      sourceId,
                      kind,
                    }),
                  },
                );
                const d = await r.json();
                if (!r.ok) throw new Error(d.error);
                router.push(`/w/${workspaceId}/ai-tasks/${d.id}`);
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "작업을 시작하지 못했습니다.",
                );
                setBusy(false);
              }
            }}
          >
            {busy
              ? "작업 등록 중…"
              : kind === "analysis"
                ? "문서 전체 분석 시작"
                : "문서 요약 시작"}
          </Button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {tasks.length > 0 && (
        <ul className="ai-task-links">
          {tasks.map((t) => (
            <li key={t.id}>
              <Link href={`/w/${workspaceId}/ai-tasks/${t.id}`}>
                {aiTaskLabels[t.kind] ?? t.kind} ·{" "}
                {aiTaskLabels[t.state] ?? t.state}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
export function AiTaskControls({
  workspaceId,
  id,
  state,
  current,
}: {
  workspaceId: string;
  id: string;
  state: string;
  current: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = ["waiting", "queued", "running"].includes(state);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [active, router]);
  async function action(action: "cancel" | "retry") {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/ai-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "작업 상태를 바꾸지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ai-task-actions">
      <div className="form-actions">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => router.refresh()}
        >
          상태 새로고침
        </Button>
        {active && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => action("cancel")}
          >
            AI 작업 취소
          </Button>
        )}
        {["failed", "canceled"].includes(state) && current && (
          <Button disabled={busy} onClick={() => action("retry")}>
            완료한 단계부터 재시도
          </Button>
        )}
      </div>
      {active && (
        <output className="field-help">
          화면을 닫았다가 다시 열어도 작업 상태를 확인할 수 있습니다.
        </output>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function WikiGenerationStart({
  workspaceId,
  sourceId,
  analysisTaskId,
}: {
  workspaceId: string;
  sourceId: string;
  analysisTaskId: string;
}) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="panel" aria-label="분석에서 위키 생성">
      <h2 className="content-subtitle">분석을 위키로 정리</h2>
      <p className="field-help">
        전체 분석과 기존 위키를 대조하여 문서 요약·개념·절차 등의 변경안을
        만듭니다. 연관된 페이지를 함께 검토하고 승인하면 게시됩니다.
      </p>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          requestId.current ??= crypto.randomUUID();
          try {
            const response = await fetch(
              `/api/workspaces/${workspaceId}/ai-tasks`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  requestId: requestId.current,
                  sourceId,
                  analysisTaskId,
                  kind: "wiki-generation",
                }),
              },
            );
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            router.push(`/w/${workspaceId}/ai-tasks/${data.id}`);
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "위키 생성을 시작하지 못했습니다.",
            );
            setBusy(false);
          }
        }}
      >
        {busy ? "작업 등록 중…" : "분석으로 위키 생성"}
      </Button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
