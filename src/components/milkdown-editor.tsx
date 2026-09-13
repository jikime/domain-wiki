"use client";
import {
  commandsCtx,
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import {
  history,
  redoCommand,
  undoCommand,
} from "@milkdown/kit/plugin/history";
import {
  commonmark,
  createCodeBlockCommand,
  imageSchema,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import {
  addColAfterCommand,
  addRowAfterCommand,
  columnResizingPlugin,
  exitTable,
  gfm,
  insertTableCommand,
  toggleStrikethroughCommand,
} from "@milkdown/kit/preset/gfm";
import { AllSelection, Plugin, Selection } from "@milkdown/kit/prose/state";
import {
  deleteColumn,
  deleteRow,
  deleteTable,
} from "@milkdown/kit/prose/tables";
import { $prose, $view, replaceAll } from "@milkdown/kit/utils";
import {
  Bold,
  Code,
  CodeXml,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { safeMarkdownImageSrc } from "@/lib/markdown-image";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "@milkdown/kit/prose/tables/style/tables.css";

type Props = {
  id: string;
  value: string;
  onChange: (markdown: string) => void;
  disabled: boolean;
  onFallback: () => void;
};
type Format = {
  heading: string;
  marks: string[];
  table: boolean;
  task: boolean | null;
  selectedText: string;
};
const initialFormat: Format = {
  heading: "0",
  marks: [],
  table: false,
  task: null,
  selectedText: "",
};

export default function MilkdownEditor(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  const latest = useRef(props);
  const emitted = useRef(props.value);
  const syncing = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [format, setFormat] = useState(initialFormat);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkHref, setLinkHref] = useState("");
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    latest.current = props;
    const instance = editor.current;
    if (!instance || !ready) return;
    instance.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.setProps({ editable: () => !props.disabled });
      if (props.value !== emitted.current) {
        syncing.current = true;
        try {
          instance.action(replaceAll(props.value, true));
          emitted.current = props.value;
        } finally {
          syncing.current = false;
        }
      }
    });
  }, [props, ready]);

  useEffect(() => {
    if (!host.current) return;
    // A separate root per mount also isolates React Strict Mode's async cleanup.
    const root = document.createElement("div");
    host.current.append(root);
    let disposed = false;
    const sync = $prose(
      (ctx) =>
        new Plugin({
          props: {
            handleKeyDown: (view, event) => {
              // Commit the collapse of Ctrl/Cmd+A immediately. Native DOM
              // selectionchange can arrive after a fast ArrowRight → Enter.
              if (
                view.composing ||
                event.shiftKey ||
                event.altKey ||
                event.metaKey ||
                event.ctrlKey ||
                !(view.state.selection instanceof AllSelection)
              )
                return false;
              const end = event.key === "ArrowRight" || event.key === "End";
              if (!end && event.key !== "ArrowLeft" && event.key !== "Home")
                return false;
              view.dispatch(
                view.state.tr
                  .setSelection(
                    end
                      ? Selection.atEnd(view.state.doc)
                      : Selection.atStart(view.state.doc),
                  )
                  .scrollIntoView(),
              );
              return true;
            },
          },
          view: () => ({
            update: (view, previous) => {
              if (disposed) return;
              const { state } = view;
              const marks = (
                state.storedMarks ?? state.selection.$from.marks()
              ).map((mark) => mark.type.name);
              const ancestors = Array.from(
                { length: state.selection.$from.depth + 1 },
                (_, depth) => state.selection.$from.node(depth),
              );
              const heading = ancestors.find(
                (node) => node.type.name === "heading",
              );
              const next = {
                heading: String(heading?.attrs.level ?? 0),
                marks,
                table: ancestors.some((node) => node.type.name === "table"),
                task:
                  [...ancestors]
                    .reverse()
                    .find((node) => node.type.name === "list_item")?.attrs
                    .checked ?? null,
                selectedText: state.doc.textBetween(
                  state.selection.from,
                  state.selection.to,
                  " ",
                ),
              };
              setFormat((old) =>
                JSON.stringify(old) === JSON.stringify(next) ? old : next,
              );
              // Serialize synchronously: a quick save, mode switch or navigation must
              // include the final transaction, without waiting for listener debounce.
              if (!syncing.current && !previous.doc.eq(state.doc)) {
                const markdown =
                  state.doc.childCount === 1 &&
                  state.doc.firstChild?.type.name === "paragraph" &&
                  state.doc.firstChild.content.size === 0
                    ? ""
                    : ctx.get(serializerCtx)(state.doc);
                emitted.current = markdown;
                latest.current.onChange(markdown);
              }
            },
          }),
        }),
    );
    const imagePreview = $view(imageSchema.node, () => (node) => {
      const dom = document.createElement("img");
      dom.className = "editor-image-preview";
      const url = safeMarkdownImageSrc(String(node.attrs.src ?? ""));
      if (url) dom.src = url;
      dom.alt = String(node.attrs.alt ?? "");
      dom.referrerPolicy = "no-referrer";
      dom.loading = "lazy";
      return { dom };
    });
    const instance = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, latest.current.value);
        emitted.current = latest.current.value;
        ctx.set(editorViewOptionsCtx, {
          editable: () => !latest.current.disabled,
          attributes: {
            id: latest.current.id,
            "aria-label": "마크다운 본문",
            "aria-multiline": "true",
            "aria-describedby": `${latest.current.id}-help`,
            "data-placeholder": "확인한 내용과 적용 범위를 작성해 주세요.",
            spellcheck: "true",
          },
          handleClick: (_view, _pos, event) => {
            if ((event.target as HTMLElement).closest("a")) {
              event.preventDefault();
              return true;
            }
            return false;
          },
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(columnResizingPlugin)
      .use(history)
      .use(clipboard)
      .use(sync)
      .use(imagePreview);
    const creation = instance.create();
    creation
      .then(() => {
        if (disposed) return;
        editor.current = instance;
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      if (editor.current === instance) editor.current = null;
      void creation
        .then(() => instance.destroy())
        .catch(() => {})
        .finally(() => root.remove());
    };
  }, []);

  function act(action: (ctx: Ctx) => void) {
    if (!ready || props.disabled) return;
    editor.current?.action((ctx) => {
      action(ctx);
      ctx.get(editorViewCtx).focus();
    });
  }
  const tools = [
    {
      label: "실행 취소",
      Icon: Undo2,
      action: (ctx: Ctx) => ctx.get(commandsCtx).call(undoCommand.key),
    },
    {
      label: "다시 실행",
      Icon: Redo2,
      action: (ctx: Ctx) => ctx.get(commandsCtx).call(redoCommand.key),
    },
    {
      label: "굵게",
      Icon: Bold,
      mark: "strong",
      action: (ctx: Ctx) => ctx.get(commandsCtx).call(toggleStrongCommand.key),
    },
    {
      label: "기울임",
      Icon: Italic,
      mark: "emphasis",
      action: (ctx: Ctx) =>
        ctx.get(commandsCtx).call(toggleEmphasisCommand.key),
    },
    {
      label: "취소선",
      Icon: Strikethrough,
      mark: "strike_through",
      action: (ctx: Ctx) =>
        ctx.get(commandsCtx).call(toggleStrikethroughCommand.key),
    },
    {
      label: "인라인 코드",
      Icon: Code,
      mark: "inlineCode",
      action: (ctx: Ctx) =>
        ctx.get(commandsCtx).call(toggleInlineCodeCommand.key),
    },
    {
      label: "글머리 목록",
      Icon: List,
      action: (ctx: Ctx) =>
        ctx.get(commandsCtx).call(wrapInBulletListCommand.key),
    },
    {
      label: "번호 목록",
      Icon: ListOrdered,
      action: (ctx: Ctx) =>
        ctx.get(commandsCtx).call(wrapInOrderedListCommand.key),
    },
    {
      label: "인용문",
      Icon: Quote,
      action: (ctx: Ctx) =>
        ctx.get(commandsCtx).call(wrapInBlockquoteCommand.key),
    },
    {
      label: "할 일 목록",
      Icon: ListChecks,
      action: (ctx: Ctx) => {
        const view = ctx.get(editorViewCtx);
        let selection = view.state.selection.$from;
        if (
          !Array.from({ length: selection.depth + 1 }, (_, depth) =>
            selection.node(depth),
          ).some((node) => node.type.name === "list_item")
        )
          ctx.get(commandsCtx).call(wrapInBulletListCommand.key);
        selection = view.state.selection.$from;
        for (let depth = selection.depth; depth > 0; depth--) {
          const node = selection.node(depth);
          if (node.type.name !== "list_item") continue;
          view.dispatch(
            view.state.tr.setNodeMarkup(selection.before(depth), undefined, {
              ...node.attrs,
              checked: node.attrs.checked == null ? false : null,
            }),
          );
          break;
        }
      },
    },
    {
      label: "코드 블록",
      Icon: CodeXml,
      action: (ctx: Ctx) =>
        ctx.get(commandsCtx).call(createCodeBlockCommand.key),
    },
    {
      label: "표 삽입",
      Icon: Table2,
      action: (ctx: Ctx) =>
        ctx.get(commandsCtx).call(insertTableCommand.key, { row: 3, col: 3 }),
    },
  ];
  if (failed)
    return (
      <div className="notice-box" role="alert">
        <p>
          서식 편집기를 불러오지 못했습니다. 마크다운 편집으로 계속 작성할 수
          있습니다.
        </p>
        <Button type="button" variant="outline" onClick={props.onFallback}>
          마크다운으로 편집
        </Button>
      </div>
    );
  return (
    <div className="milkdown-field" aria-busy={!ready}>
      <FieldSet
        className="editor-toolbar"
        aria-label="본문 서식 도구"
        disabled={!ready || props.disabled}
      >
        <Select
          value={format.heading}
          disabled={!ready || props.disabled}
          onValueChange={(level) =>
            editor.current?.action((ctx) =>
              level === "0"
                ? ctx.get(commandsCtx).call(turnIntoTextCommand.key)
                : ctx
                    .get(commandsCtx)
                    .call(wrapInHeadingCommand.key, Number(level)),
            )
          }
        >
          <SelectTrigger
            className="editor-heading-select"
            aria-label="문단 서식"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              act(() => {});
            }}
          >
            {[
              ["0", "본문"],
              ["1", "제목 1"],
              ["2", "제목 2"],
              ["3", "제목 3"],
              ["4", "제목 4"],
              ["5", "제목 5"],
              ["6", "제목 6"],
            ].map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tools.map(({ label, Icon, mark, action }) => (
          <Button
            key={label}
            type="button"
            variant="ghost"
            size="icon"
            title={label}
            aria-label={label}
            aria-pressed={mark ? format.marks.includes(mark) : undefined}
            disabled={!ready || props.disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => act(action)}
          >
            <Icon aria-hidden="true" />
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="링크 삽입"
          aria-label="링크 삽입"
          disabled={!ready || props.disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setLinkText(format.selectedText);
            setLinkHref("");
            setLinkError("");
            setLinkOpen(true);
          }}
        >
          <LinkIcon aria-hidden="true" />
        </Button>
      </FieldSet>
      {format.task !== null && (
        <FieldSet className="editor-table-tools" disabled={props.disabled}>
          <Checkbox
            id={`${props.id}-task-done`}
            checked={format.task}
            onCheckedChange={(checked) =>
              act((ctx) => {
                const view = ctx.get(editorViewCtx),
                  pos = view.state.selection.$from;
                for (let depth = pos.depth; depth > 0; depth--) {
                  const node = pos.node(depth);
                  if (node.type.name !== "list_item") continue;
                  view.dispatch(
                    view.state.tr.setNodeMarkup(pos.before(depth), undefined, {
                      ...node.attrs,
                      checked: checked === true,
                    }),
                  );
                  break;
                }
              })
            }
          />
          <FieldLabel htmlFor={`${props.id}-task-done`}>
            현재 할 일 완료
          </FieldLabel>
        </FieldSet>
      )}
      {format.table && (
        <FieldSet
          className="editor-table-tools"
          disabled={props.disabled}
          aria-label="표 편집 도구"
        >
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              act((ctx) => ctx.get(commandsCtx).call(addRowAfterCommand.key))
            }
          >
            행 추가
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              act((ctx) => ctx.get(commandsCtx).call(addColAfterCommand.key))
            }
          >
            열 추가
          </Button>
          {[
            { label: "행 삭제", command: deleteRow },
            { label: "열 삭제", command: deleteColumn },
            { label: "표 삭제", command: deleteTable },
          ].map(({ label, command }) => (
            <Button
              key={label}
              type="button"
              size="sm"
              variant="ghost"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                act((ctx) => {
                  const view = ctx.get(editorViewCtx);
                  command(view.state, view.dispatch);
                })
              }
            >
              {label}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              act((ctx) => ctx.get(commandsCtx).call(exitTable.key))
            }
          >
            표 아래로
          </Button>
        </FieldSet>
      )}
      {!ready && (
        <output className="editor-loading">편집기를 준비하고 있습니다…</output>
      )}
      <div className="wiki-markdown milkdown-host" ref={host} />
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (ready)
              editor.current?.action((ctx) => ctx.get(editorViewCtx).focus());
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.stopPropagation();
          }}
        >
          <DialogHeader>
            <DialogTitle>링크 삽입</DialogTitle>
            <DialogDescription>
              표시할 문구와 연결할 주소를 입력해 주세요.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`${props.id}-link-text`}>표시 문구</FieldLabel>
            <Input
              id={`${props.id}-link-text`}
              value={linkText}
              onChange={(event) => setLinkText(event.target.value)}
              maxLength={500}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${props.id}-link-href`}>링크 주소</FieldLabel>
            <Input
              id={`${props.id}-link-href`}
              value={linkHref}
              onChange={(event) => setLinkHref(event.target.value)}
              placeholder="https:// 또는 /w/…"
              maxLength={2000}
            />
          </Field>
          {linkError && (
            <p className="form-error" role="alert">
              {linkError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLinkOpen(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              onClick={() => {
                const href = linkHref.trim();
                if (
                  !linkText.trim() ||
                  !/^(https?:\/\/|mailto:|\/[^/]|#)/i.test(href) ||
                  [...href].some((char) => char.charCodeAt(0) <= 32)
                ) {
                  setLinkError(
                    "표시 문구와 올바른 웹·메일·위키 주소를 입력해 주세요.",
                  );
                  return;
                }
                act((ctx) => {
                  const view = ctx.get(editorViewCtx);
                  const mark = view.state.schema.marks.link.create({ href });
                  view.dispatch(
                    view.state.tr.replaceSelectionWith(
                      view.state.schema.text(linkText.trim(), [mark]),
                      false,
                    ),
                  );
                });
                setLinkOpen(false);
              }}
            >
              링크 적용
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
