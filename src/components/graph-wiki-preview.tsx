"use client";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import type { wikiDetails } from "@/server/services/wiki";

type Details = Awaited<ReturnType<typeof wikiDetails>>;
export function GraphWikiPreview({
  workspaceId: w,
  pageId,
  versionId,
  canWrite,
}: {
  workspaceId: string;
  pageId: string;
  versionId: string;
  canWrite: boolean;
}) {
  const id = useId();
  const [data, setData] = useState<Details | null>(null),
    [editing, setEditing] = useState(false),
    [body, setBody] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        const response = await fetch(
          `/api/workspaces/${w}/wiki/${pageId}?version=${versionId}`,
          { signal: abort.signal, cache: "no-store" },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (
          result.page.publishedVersionId !== versionId ||
          !result.evidenceValid
        )
          throw new Error(
            "게시 문서가 변경되었습니다. 그래프를 새로고침해 주세요.",
          );
        setData(result);
        setBody(result.version.body);
      } catch (error) {
        if (!abort.signal.aborted)
          setMessage(
            error instanceof Error ? error.message : "문서를 읽지 못했습니다.",
          );
      }
    }
    void load();
    return () => abort.abort();
  }, [w, pageId, versionId]);
  async function save() {
    if (!data) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${w}/wiki/${pageId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domainId: data.page.domainId,
          projectId: data.page.projectId,
          title: data.version.title,
          body,
          parentVersionId: data.page.latestVersionId,
          basePublishedVersionId: data.page.publishedVersionId,
          chunkIds: data.evidence.map((e) => e.id),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData({
        ...data,
        page: { ...data.page, latestVersionId: result.versionId },
        version: {
          ...data.version,
          id: result.versionId,
          body,
          state: "draft",
        },
      });
      setEditing(false);
      setMessage(
        "수정 내용을 초안으로 저장했습니다. 문서에서 게시 검토를 요청해 주세요.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "초안을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="graph-document-preview"
      aria-label="그래프 문서 미리보기"
    >
      <h3>문서 미리보기</h3>
      {!data && !message && <output>본문을 읽고 있습니다…</output>}
      {data && (
        <>
          {editing ? (
            <form
              className="stack-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <MarkdownEditor
                id={`${id}-body`}
                value={body}
                onChange={setBody}
                disabled={busy}
                workspaceId={w}
                selectionScope={{
                  domainId: data.page.domainId,
                  projectId: data.page.projectId,
                  pageId,
                  versionId: data.version.id,
                  latestVersionId: data.page.latestVersionId ?? null,
                }}
                linkDestinations={data.linkDestinations}
              />
              <p className="field-help">
                내용을 고친 뒤 초안을 저장해 주세요. 그래프에는 게시 검토를 마친
                내용이 표시됩니다.
              </p>
              <div className="inline-actions">
                <Button
                  type="submit"
                  disabled={busy || body === data.version.body}
                >
                  초안으로 저장
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setBody(data.version.body);
                    setEditing(false);
                  }}
                >
                  편집 취소
                </Button>
              </div>
            </form>
          ) : (
            <>
              <Markdown linkDestinations={data.linkDestinations}>
                {data.version.body}
              </Markdown>
              {canWrite && (
                <div className="inline-actions">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={data.page.latestVersionId !== data.version.id}
                    onClick={() => setEditing(true)}
                  >
                    미리보기에서 편집
                  </Button>
                  <Link href={`/w/${w}/wiki/${pageId}/edit`}>
                    전체 편집·검토 요청 →
                  </Link>
                </div>
              )}
            </>
          )}
          {canWrite && data.page.latestVersionId !== data.version.id && (
            <p className="field-help">
              저장된 새 초안이 있습니다. 전체 편집 화면에서 확인해 주세요.
            </p>
          )}
        </>
      )}
      <output aria-live="polite">{message}</output>
    </section>
  );
}
