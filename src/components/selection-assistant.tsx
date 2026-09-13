"use client";
import {
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ChatMarkdown } from "@/components/chat-markdown";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { sseRecords } from "@/lib/chat";
import {
  buildWordDiff,
  findDomTextSelection,
  findUniqueTextSelection,
  normalizeEditableMarkdown,
  normalizeSelectionReplacement,
  type TextSelectionSnapshot,
} from "@/lib/reference/selection-edit";
import type {
  SelectionInput,
  SelectionReference,
  SelectionScope,
  SelectionTurn,
} from "@/lib/selection-assistance";

type Snapshot = TextSelectionSnapshot & {
  body: string;
  sourceMapped: boolean;
  scope: SelectionScope;
};
export function useSelectionAssistant({
  workspaceId,
  scope,
  value,
  onChange,
  disabled = false,
  maxLength = 40000,
}: {
  workspaceId?: string;
  scope?: SelectionScope;
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  maxLength?: number;
}) {
  const id = useId();
  const [selection, setSelection] = useState<Snapshot | null>(null);
  const [instruction, setInstruction] = useState("");
  const [mode, setMode] = useState<"ask" | "edit" | null>(null);
  const [turns, setTurns] = useState<SelectionTurn[]>([]);
  const [result, setResult] = useState("");
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [references, setReferences] = useState<SelectionReference[]>([]);
  const [preview, setPreview] = useState<SelectionReference | null>(null);
  const abort = useRef<AbortController | null>(null),
    runId = useRef(0);
  const current = useRef({ value, scope, disabled });
  current.current = { value, scope, disabled };
  useEffect(
    () => () => {
      runId.current++;
      abort.current?.abort();
    },
    [],
  );
  const stop = () => {
    runId.current++;
    abort.current?.abort();
    setRunning(false);
    setReady(false);
    setResult("");
  };
  const close = () => {
    stop();
    setSelection(null);
    setTurns([]);
    setMode(null);
    setError("");
    setInstruction("");
    setPreview(null);
  };
  const capture = (snapshot: TextSelectionSnapshot, sourceMapped: boolean) => {
    if (
      !scope ||
      !workspaceId ||
      disabled ||
      !snapshot.selectedText.trim() ||
      snapshot.selectedText.length > 40000
    )
      return;
    stop();
    setSelection({
      ...snapshot,
      sourceMapped,
      body: normalizeEditableMarkdown(value),
      scope,
    });
    setMode(null);
    setTurns([]);
    setInstruction("");
    setError("");
    setReferences([]);
    setPreview(null);
  };
  const captureTextarea = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
    if (start === end) return;
    const body = normalizeEditableMarkdown(value);
    capture(
      {
        prefix: body.slice(0, start),
        selectedText: body.slice(start, end),
        suffix: body.slice(end),
      },
      true,
    );
  };
  const captureRendered = (root: HTMLElement | null) => {
    const selected = window.getSelection();
    if (!root || !selected || !selected.rangeCount || selected.isCollapsed)
      return;
    const range = selected.getRangeAt(0);
    if (
      !root.contains(range.startContainer) ||
      !root.contains(range.endContainer)
    )
      return;
    const text = selected.toString().trim();
    const body = normalizeEditableMarkdown(value);
    const found =
      findDomTextSelection(body, selected, root) ??
      findUniqueTextSelection(body, text);
    capture(
      found ?? { prefix: "", selectedText: text, suffix: "" },
      Boolean(found),
    );
  };
  const changed =
    !selection ||
    normalizeEditableMarkdown(value) !== selection.body ||
    JSON.stringify(scope) !== JSON.stringify(selection.scope);
  const payload = (
    intent: "ask" | "edit",
    action: "generate" | "validate",
  ): SelectionInput => {
    if (!selection) throw new Error("문장을 다시 선택해 주세요.");
    return {
      action,
      requestId: crypto.randomUUID(),
      intent,
      instruction,
      scope: selection.scope,
      ...(onChange ? { body: selection.body } : {}),
      selection: {
        start: selection.prefix.length,
        end: selection.prefix.length + selection.selectedText.length,
        selectedText: selection.selectedText,
        sourceMapped: selection.sourceMapped,
      },
      history: turns.slice(-6).map((turn) => ({
        id: turn.id,
        question: turn.question,
        answer: turn.answer.slice(-6000),
      })),
    };
  };
  const send = async (data: SelectionInput, signal?: AbortSignal) => {
    const response = await fetch(
      `/api/workspaces/${workspaceId}/selection-assistance`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal,
      },
    );
    if (!response.ok)
      throw new Error(
        (await response.json()).error ?? "요청을 처리하지 못했습니다.",
      );
    return response;
  };
  const generate = async (intent: "ask" | "edit") => {
    if (
      !selection ||
      !instruction.trim() ||
      changed ||
      disabled ||
      running ||
      (mode && mode !== intent)
    )
      return;
    const token = ++runId.current;
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    setMode(intent);
    setRunning(true);
    setReady(false);
    setError("");
    setResult("");
    setPreview(null);
    const question = instruction.trim();
    let content = "",
      refs: SelectionReference[] = [],
      completed = false;
    try {
      const response = await send(
        payload(intent, "generate"),
        controller.signal,
      );
      if (!response.body) throw new Error("답변 연결을 확인하지 못했습니다.");
      for await (const record of sseRecords(response.body)) {
        if (token !== runId.current) return;
        const event = JSON.parse(record);
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "references") {
          refs = event.references;
          setReferences(refs);
        }
        if (event.type === "token") {
          content += event.text;
          setResult(content);
        }
        if (event.type === "done") {
          completed = true;
          if (intent === "ask") {
            setTurns((old) => [
              ...old,
              {
                id: event.id,
                question,
                answer: content,
                references: refs,
                linkDestinations: event.linkDestinations,
              },
            ]);
            setInstruction("");
            setResult("");
          } else {
            setResult(normalizeSelectionReplacement(content));
            setReady(true);
          }
        }
      }
      if (!completed)
        throw new Error("답변이 완성되기 전에 연결이 끊어졌습니다.");
    } catch (reason) {
      if (token === runId.current) {
        setResult("");
        setReady(false);
        setTurns([]);
        setError(
          reason instanceof Error
            ? reason.message
            : "답변을 완성하지 못했습니다.",
        );
      }
    } finally {
      if (token === runId.current) setRunning(false);
    }
  };
  const apply = async () => {
    if (!selection || !ready || !onChange || changed || disabled) return;
    setApplying(true);
    setError("");
    const token = runId.current;
    try {
      await send(payload("edit", "validate"));
      if (token !== runId.current) return;
      if (
        current.current.disabled ||
        normalizeEditableMarkdown(current.current.value) !== selection.body ||
        JSON.stringify(current.current.scope) !==
          JSON.stringify(selection.scope)
      )
        throw new Error("선택한 뒤 본문이 바뀌었습니다. 다시 선택해 주세요.");
      const next = selection.prefix + result + selection.suffix;
      if (next.length > maxLength)
        throw new Error(
          `수정한 본문이 ${maxLength.toLocaleString("ko-KR")}자 저장 한도를 넘습니다.`,
        );
      onChange(next);
      close();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "수정안을 적용하지 못했습니다.",
      );
    } finally {
      setApplying(false);
    }
  };
  const showAnswer = (
    content: string,
    refs: SelectionReference[],
    linkDestinations?: Record<string, string>,
  ) => (
    <ChatMarkdown
      citations={refs}
      linkDestinations={linkDestinations}
      onCitationClick={(key) =>
        setPreview(refs.find((r) => r.key === key) ?? null)
      }
    >
      {content}
    </ChatMarkdown>
  );
  const panel: ReactNode = selection ? (
    <section className="selection-assistant" aria-label="선택 문장 AI 도우미">
      <div className="section-heading">
        <h3>선택 문장 AI 도우미</h3>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={close}
          disabled={applying}
        >
          닫기
        </Button>
      </div>
      <blockquote className="selection-quote">
        {selection.selectedText}
      </blockquote>
      {changed && (
        <p role="alert" className="form-error">
          선택한 뒤 본문이나 범위가 바뀌었습니다. 문장을 다시 선택해 주세요.
        </p>
      )}
      {!selection.sourceMapped && onChange && (
        <p className="field-help">
          선택한 문장의 원문 위치가 겹치거나 서식으로 바뀌어 질문만 할 수
          있습니다. 수정하려면 마크다운에서 다시 선택해 주세요.
        </p>
      )}
      {turns.map((turn) => (
        <div className="selection-turn" key={turn.id}>
          <p className="selection-question">{turn.question}</p>
          {showAnswer(turn.answer, turn.references, turn.linkDestinations)}
        </div>
      ))}
      <Field>
        <FieldLabel htmlFor={`${id}-instruction`}>
          {mode === "ask" && turns.length
            ? "이어서 질문"
            : "선택 문장에 요청할 내용"}
        </FieldLabel>
        <Textarea
          id={`${id}-instruction`}
          value={instruction}
          maxLength={4000}
          disabled={disabled || running || applying || changed}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="이 문장을 설명해 주세요. 또는 더 간결하게 고쳐 주세요."
        />
      </Field>
      <div className="selection-actions">
        {mode !== "edit" && (
          <Button
            type="button"
            onClick={() => generate("ask")}
            disabled={
              disabled || running || applying || changed || !instruction.trim()
            }
          >
            질문하기
          </Button>
        )}
        {onChange && mode !== "ask" && (
          <Button
            type="button"
            variant="outline"
            onClick={() => generate("edit")}
            disabled={
              disabled ||
              running ||
              applying ||
              changed ||
              !selection.sourceMapped ||
              !instruction.trim()
            }
          >
            수정안 만들기
          </Button>
        )}
        {running && (
          <Button type="button" variant="outline" onClick={stop}>
            생성 중지
          </Button>
        )}
      </div>
      {running && (
        <output>
          {mode === "edit"
            ? "수정안을 작성하고 있습니다…"
            : "답변을 작성하고 있습니다…"}
        </output>
      )}
      {result && mode === "ask" && showAnswer(result, references)}
      {mode === "edit" && (result || ready) && (
        <>
          <Field>
            <FieldLabel htmlFor={`${id}-candidate`}>검토할 수정안</FieldLabel>
            <Textarea
              id={`${id}-candidate`}
              value={result}
              maxLength={maxLength}
              disabled={!ready || disabled || applying}
              onChange={(event) => setResult(event.target.value)}
            />
          </Field>
          {ready && (
            <>
              <section
                className="selection-diff"
                aria-label="선택 문장 변경 비교"
              >
                {buildWordDiff(selection.selectedText, result)
                  .map((part, index) => ({
                    ...part,
                    key: `${part.type}-${index}-${part.value}`,
                  }))
                  .map((part) =>
                    part.type === "insert" ? (
                      <ins key={part.key}>{part.value}</ins>
                    ) : part.type === "delete" ? (
                      <del key={part.key}>{part.value}</del>
                    ) : (
                      <span key={part.key}>{part.value}</span>
                    ),
                  )}
              </section>
              <Button
                type="button"
                onClick={apply}
                disabled={disabled || applying || changed}
              >
                {applying ? "문서 확인 중…" : "편집 중인 본문에 적용"}
              </Button>
              <p className="field-help">
                적용 후 초안을 저장하면 새 버전으로 검토를 요청할 수 있습니다.
              </p>
            </>
          )}
        </>
      )}
      {preview && (
        <aside className="selection-citation" aria-label="선택 문장 답변 출처">
          <a href={preview.href}>
            [{preview.key}] {preview.title}
          </a>
          <p>{preview.text}</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setPreview(null)}
          >
            출처 닫기
          </Button>
        </aside>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  ) : null;
  return { panel, captureTextarea, captureRendered };
}
export function SelectionReader({
  workspaceId,
  scope,
  value,
  linkDestinations,
}: {
  workspaceId: string;
  scope: SelectionScope;
  value: string;
  linkDestinations?: Record<string, string>;
}) {
  const assistant = useSelectionAssistant({ workspaceId, scope, value });
  const root = useRef<HTMLDivElement>(null);
  return (
    <>
      <p className="field-help">
        본문에서 문장을 선택하면 AI에게 질문할 수 있습니다.
      </p>
      <section
        aria-label="선택하여 질문할 본문"
        ref={root}
        onMouseUp={() => assistant.captureRendered(root.current)}
        onKeyUp={() => assistant.captureRendered(root.current)}
      >
        <Markdown linkDestinations={linkDestinations}>{value}</Markdown>
      </section>
      {assistant.panel}
    </>
  );
}
