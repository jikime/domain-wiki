"use client";
import { Copy } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { chatWebAppendix } from "@/lib/chat-web";
import type { conversationDetails } from "@/server/services/chat";

type Detail = Awaited<ReturnType<typeof conversationDetails>>;
export function RenameConversation({
  workspaceId,
  conversation,
  disabled,
  onRenamed,
}: {
  workspaceId: string;
  conversation: Detail["conversation"];
  disabled: boolean;
  onRenamed: (conversation: Detail["conversation"]) => void;
}) {
  const id = useId();
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        const title = String(
          new FormData(event.currentTarget).get("title") ?? "",
        ).trim();
        if (!title) {
          setMessage("대화 제목을 입력해 주세요.");
          return;
        }
        setPending(true);
        setMessage("");
        try {
          const response = await fetch(
            `/api/workspaces/${workspaceId}/conversations/${conversation.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title, scope: conversation.scope }),
            },
          );
          const data = await response.json();
          if (!response.ok)
            throw new Error(data.error ?? "제목을 변경하지 못했습니다.");
          onRenamed(data);
          setMessage("대화 제목을 변경했습니다.");
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "제목을 변경하지 못했습니다.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor={id}>대화 제목</FieldLabel>
        <Input
          id={id}
          name="title"
          defaultValue={conversation.title}
          required
          maxLength={160}
          disabled={pending || disabled}
        />
      </Field>
      <Button type="submit" variant="outline" disabled={pending || disabled}>
        {pending ? "저장 중…" : "대화 제목 저장"}
      </Button>
      <output>{message}</output>
    </form>
  );
}
export function CopyAnswer({
  workspaceId,
  conversationId,
  runId,
}: {
  workspaceId: string;
  conversationId: string;
  runId: string;
}) {
  const id = useId();
  const [pending, setPending] = useState(false),
    [copied, setCopied] = useState(false),
    [error, setError] = useState(""),
    [manual, setManual] = useState("");
  return (
    <div className="copy-answer">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError("");
          setCopied(false);
          setManual("");
          try {
            const response = await fetch(
              `/api/workspaces/${workspaceId}/conversations/${conversationId}`,
            );
            if (!response.ok)
              throw new Error(
                "현재 답변을 확인하지 못했습니다. 대화를 다시 열어주세요.",
              );
            const detail: Detail = await response.json(),
              run = detail.runs.find((r) => r.id === runId);
            if (!run || run.state !== "completed")
              throw new Error(
                "현재 확인할 수 있는 완료 답변만 복사할 수 있습니다.",
              );
            const answer = run.messages
              .filter((m) => m.role === "assistant")
              .map((m) => m.body)
              .join("\n\n");
            if (!answer) throw new Error("복사할 답변이 없습니다.");
            const sources = run.citations
              .filter((c) => c.used)
              .map(
                (c) =>
                  `${c.key}: ${c.snapshot.title} — ${new URL(c.snapshot.href, location.origin).href}`,
              )
              .join("\n");
            const text =
              answer +
              (sources ? `\n\n참고 자료\n${sources}` : "") +
              chatWebAppendix(run.webReferences);
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              setManual(text);
              setError(
                "자동 복사가 허용되지 않았습니다. 아래 내용을 선택해서 복사해 주세요.",
              );
            }
          } catch (error) {
            setError(
              error instanceof Error ? error.message : "복사하지 못했습니다.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <Copy size={14} />
        {pending ? "확인 중…" : copied ? "복사했습니다" : "답변 복사"}
      </Button>
      {error && <p role="alert">{error}</p>}
      {manual && (
        <Field>
          <FieldLabel htmlFor={id}>복사할 답변과 출처</FieldLabel>
          <Textarea
            id={id}
            value={manual}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
          />
        </Field>
      )}
    </div>
  );
}
