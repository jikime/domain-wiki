"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { activitySummary } from "@/server/services/activity";

export function useActivitySummary(workspaceId: string) {
  const pathname = usePathname();
  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof activitySummary>
  > | null>(null);
  useEffect(() => {
    if (!pathname.startsWith(`/w/${workspaceId}`)) return;
    const abort = new AbortController();
    const update = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(
          `/api/workspaces/${workspaceId}/activity-summary`,
          { signal: abort.signal },
        );
        if (response.ok && !abort.signal.aborted)
          setSummary(await response.json());
        else if (!response.ok) setSummary(null);
      } catch {
        /* 다음 방문 또는 갱신에서 다시 확인한다. */
      }
    };
    void update();
    const timer = setInterval(() => void update(), 30_000);
    window.addEventListener("wiki:activity-read", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("wiki:activity-read", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [workspaceId, pathname]);
  return summary;
}
export function ActivityReadButton({
  workspaceId,
  keys,
  all = false,
}: {
  workspaceId: string;
  keys: string[];
  all?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <span className="activity-read-action">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || !keys.length}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const response = await fetch(
              `/api/workspaces/${workspaceId}/activity`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ keys }),
              },
            );
            if (!response.ok)
              throw new Error("확인 상태를 저장하지 못했습니다.");
            router.refresh();
            window.dispatchEvent(new Event("wiki:activity-read"));
          } catch (e) {
            setError(e instanceof Error ? e.message : "다시 시도해 주세요.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "저장 중…" : all ? "이 페이지 결과 모두 확인" : "확인했습니다"}
      </Button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
