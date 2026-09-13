"use client";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
export function GenerateSource({
  workspaceId,
  sourceId,
  chunks,
  wikis,
}: {
  workspaceId: string;
  sourceId: string;
  chunks: { id: string; text: string }[];
  wikis: { id: string; title: string }[];
}) {
  const fid = useId();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState("new");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <details className="panel">
      <summary>이 원문으로 AI 위키 변경안 만들기</summary>
      <p className="field-help">
        공개 원문의 선택한 문단을 모델에 전달합니다. 선택하지 않으면 전체 문단을
        사용하며, 20개·18,000자를 넘으면 나누어 선택해 주세요.
      </p>
      <Field>
        <FieldLabel htmlFor={`${fid}-target`}>변경할 위키</FieldLabel>
        <Select value={target} onValueChange={setTarget} disabled={pending}>
          <SelectTrigger id={`${fid}-target`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">새 위키 제안</SelectItem>
            {wikis.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="evidence-picker">
        {chunks.map((c, i) => (
          <Field orientation="horizontal" key={c.id}>
            <Checkbox
              id={`${fid}-${c.id}`}
              checked={selected.includes(c.id)}
              disabled={pending}
              onCheckedChange={(value) =>
                setSelected(
                  value
                    ? [...selected, c.id]
                    : selected.filter((id) => id !== c.id),
                )
              }
            />
            <FieldContent>
              <FieldLabel htmlFor={`${fid}-${c.id}`}>
                문단 {i + 1} · {c.text.slice(0, 130)}
              </FieldLabel>
            </FieldContent>
          </Field>
        ))}
      </div>
      <Button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setMessage("");
          try {
            const response = await fetch(
              `/api/workspaces/${workspaceId}/generations`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "source",
                  requestId: crypto.randomUUID(),
                  sourceId,
                  targetPageId: target === "new" ? null : target,
                  chunkIds: selected,
                }),
              },
            );
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            router.push(`/w/${workspaceId}/proposals/${data.batchId}`);
            router.refresh();
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "초안을 생성하지 못했습니다.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "변경안 생성 중…" : "AI 변경안 생성"}
      </Button>
      {message && (
        <p role="alert" className="form-error">
          {message}
        </p>
      )}
    </details>
  );
}
export function ProposeAnswer({
  workspaceId,
  conversationId,
  runId,
}: {
  workspaceId: string;
  conversationId: string;
  runId: string;
}) {
  const fid = useId();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <details className="answer-proposal">
      <summary>이 답변을 지식 제안으로 남기기</summary>
      <p className="field-help">
        이 답변의 본문과 원문 근거가 검토자에게 전달됩니다. 질문과 나머지 개인
        대화는 포함하지 않습니다.
      </p>
      <Field>
        <FieldLabel htmlFor={fid}>제안 제목</FieldLabel>
        <Input
          id={fid}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={160}
          disabled={pending}
        />
      </Field>
      <Button
        type="button"
        variant="outline"
        disabled={!title.trim() || pending}
        onClick={async () => {
          setPending(true);
          setMessage("");
          try {
            const response = await fetch(
              `/api/workspaces/${workspaceId}/generations`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "answer",
                  requestId: crypto.randomUUID(),
                  conversationId,
                  runId,
                  title,
                }),
              },
            );
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            router.push(`/w/${workspaceId}/proposals/${data.batchId}`);
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "제안을 저장하지 못했습니다.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "저장 중…" : "지식 제안 저장"}
      </Button>
      {message && (
        <p role="alert" className="form-error">
          {message}
        </p>
      )}
    </details>
  );
}
