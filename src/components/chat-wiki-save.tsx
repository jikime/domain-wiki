"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SaveAnswerToWiki({
  workspaceId,
  conversationId,
  runId,
}: {
  workspaceId: string;
  conversationId: string;
  runId: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [pageId, setPageId] = useState<string | null>(null);
  return (
    <div className="copy-answer">
      {pageId ? (
        <Link
          className="chat-feedback-link"
          href={`/w/${workspaceId}/wiki/${pageId}/edit`}
        >
          저장한 위키 초안 열기
        </Link>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          title="이 답변과 참고 근거를 위키 초안으로 저장합니다. 질문과 다른 대화는 포함하지 않습니다."
          onClick={async () => {
            setPending(true);
            setError("");
            try {
              const response = await fetch(
                `/api/workspaces/${workspaceId}/conversations/${conversationId}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "save-wiki", runId }),
                },
              );
              const data = await response.json();
              if (!response.ok) throw new Error(data.error);
              setPageId(data.pageId);
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "위키 초안을 저장하지 못했습니다.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? "저장 중…" : "위키 초안으로 저장"}
        </Button>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
