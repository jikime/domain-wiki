"use client";
import { useEffect, useState } from "react";
import type { draftEvidence } from "@/server/services/draft-evidence";
import type { SearchResult } from "@/server/services/search";

export function useSelectedEvidence(
  workspaceId: string,
  domainId: string,
  projectId: string | null,
  ids: string[],
) {
  const selection = [...new Set(ids)].sort().join(",");
  const [items, setItems] = useState<Awaited<ReturnType<typeof draftEvidence>>>(
    [],
  );
  const [error, setError] = useState("");
  useEffect(() => {
    setItems([]);
    setError("");
    if (!selection || !domainId) return;
    const abort = new AbortController();
    const query = new URLSearchParams({
      domainId,
      ids: selection,
      ...(projectId ? { projectId } : {}),
    });
    fetch(`/api/workspaces/${workspaceId}/draft-evidence?${query}`, {
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("선택한 근거를 다시 불러오지 못했습니다.");
        const rows: Awaited<ReturnType<typeof draftEvidence>> =
          await response.json();
        if (abort.signal.aborted) return;
        setItems(rows);
        if (rows.length !== selection.split(",").length)
          setError(
            "선택한 근거 중 현재 사용할 수 없는 문단이 있습니다. 근거 선택을 지운 뒤 공개 원문에서 다시 골라주세요.",
          );
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [workspaceId, domainId, projectId, selection]);
  const results: SearchResult[] = items.map((item) => ({
    kind: "source",
    id: item.sourceId,
    chunkId: item.id,
    versionId: item.versionId,
    title: item.title,
    category: item.category,
    excerpt: item.text,
    locator: item.locator,
    domainId: item.domainId,
    projectId: item.projectId,
    href: `/w/${workspaceId}/sources/${item.sourceId}?version=${item.versionId}#chunk-${item.id}`,
  }));
  return { items, results, error };
}
