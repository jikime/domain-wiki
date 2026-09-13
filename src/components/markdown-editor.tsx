"use client";
import dynamic from "next/dynamic";
import { Component, type ReactNode, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { useSelectionAssistant } from "@/components/selection-assistant";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel, FieldSet } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { SelectionScope } from "@/lib/selection-assistance";

const MilkdownEditor = dynamic(() => import("./milkdown-editor"), {
  ssr: false,
  loading: () => (
    <output className="editor-loading">편집기를 준비하고 있습니다…</output>
  ),
});

class EditorBoundary extends Component<
  { children: ReactNode; onFallback: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="notice-box" role="alert">
        <p>
          서식 편집기를 불러오지 못했습니다. 작성한 본문은 마크다운으로 계속
          편집할 수 있습니다.
        </p>
        <Button type="button" variant="outline" onClick={this.props.onFallback}>
          마크다운으로 편집
        </Button>
      </div>
    );
  }
}

export function MarkdownEditor({
  id,
  value,
  onChange,
  disabled = false,
  maxLength = 40000,
  workspaceId,
  selectionScope,
  linkDestinations,
}: {
  id: string;
  value: string;
  onChange: (markdown: string) => void;
  disabled?: boolean;
  maxLength?: number;
  workspaceId?: string;
  selectionScope?: SelectionScope;
  linkDestinations?: Record<string, string>;
}) {
  const preview = useRef<HTMLElement>(null);
  const assistance = useSelectionAssistant({
    workspaceId,
    scope: selectionScope,
    value,
    onChange,
    disabled,
    maxLength,
  });
  const [mode, setMode] = useState<"visual" | "source" | "preview">("visual");
  const preserveSource =
    /^---\r?\n/.test(value) ||
    value.includes("[[") ||
    /\$\$|\$[^$\n]+\$/.test(value);
  const shownMode = preserveSource && mode === "visual" ? "source" : mode;
  const tooLong = value.length > maxLength;
  return (
    <Field className="markdown-editor-field">
      <div className="editor-heading">
        <FieldLabel htmlFor={shownMode === "preview" ? undefined : id}>
          마크다운 본문
        </FieldLabel>
        <FieldSet className="editor-modes" aria-label="본문 편집 방식">
          {(
            [
              ["visual", "서식 편집"],
              ["source", "마크다운"],
              ["preview", "미리보기"],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={shownMode === key}
              disabled={disabled || (preserveSource && key === "visual")}
              onClick={() => setMode(key)}
            >
              {label}
            </Button>
          ))}
        </FieldSet>
      </div>
      {shownMode === "visual" ? (
        <EditorBoundary onFallback={() => setMode("source")}>
          <MilkdownEditor
            id={id}
            value={value}
            onChange={onChange}
            disabled={disabled}
            onFallback={() => setMode("source")}
          />
        </EditorBoundary>
      ) : shownMode === "source" ? (
        <Textarea
          id={id}
          className="wiki-body-input"
          onSelect={assistance.captureTextarea}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          maxLength={maxLength}
          aria-describedby={`${id}-help`}
          aria-invalid={tooLong}
          placeholder="# 업무 개요\n\n확인한 내용과 적용 범위를 작성해 주세요."
        />
      ) : (
        <section
          ref={preview}
          className="markdown-preview"
          aria-label="본문 미리보기"
          onMouseUp={() => assistance.captureRendered(preview.current)}
          onKeyUp={() => assistance.captureRendered(preview.current)}
        >
          <Markdown linkDestinations={linkDestinations}>
            {value || "아직 작성한 내용이 없습니다."}
          </Markdown>
        </section>
      )}
      <div className="editor-footnote" id={`${id}-help`}>
        <p className="field-help">
          {preserveSource
            ? "문서 속성·위키 링크·수식의 원문을 보존하며 마크다운으로 편집합니다."
            : "서식을 선택해 작성하거나 마크다운으로 직접 편집할 수 있습니다."}
        </p>
        <span className={tooLong ? "form-error" : "field-help"}>
          {value.length.toLocaleString("ko-KR")} /{" "}
          {maxLength.toLocaleString("ko-KR")}자
        </span>
      </div>
      {workspaceId && (
        <p className="field-help">
          마크다운이나 미리보기에서 문장을 선택하면 AI에게 질문하거나 수정을
          요청할 수 있습니다.
        </p>
      )}
      {assistance.panel}
      {tooLong && (
        <p className="form-error" role="alert">
          본문이 저장 한도를 넘었습니다. 내용을 줄여 주세요.
        </p>
      )}
    </Field>
  );
}
