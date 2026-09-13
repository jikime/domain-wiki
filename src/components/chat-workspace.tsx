"use client";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  FileText,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeft,
  Search,
  Square,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  ChatImagePicker,
  ChatImages,
  useChatImages,
} from "@/components/chat-images";
import { CopyAnswer, RenameConversation } from "@/components/chat-management";
import { ChatMarkdown } from "@/components/chat-markdown";
import { ChatToolEvents } from "@/components/chat-tool-events";
import { ChatWebPicker } from "@/components/chat-web-picker";
import { SaveAnswerToWiki } from "@/components/chat-wiki-save";
import { ProposeAnswer } from "@/components/generation-controls";
import { DeleteConversation } from "@/components/operations-controls";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceClient } from "@/components/workspace-client";
import { runLabels, sseRecords } from "@/lib/chat";
import type { AgentToolEvent } from "@/lib/chat-agent";
import {
  type ChatImageInfo,
  fileToMessageImage,
  type MessageImage,
  messageImageToDataUrl,
} from "@/lib/chat-images";
import type { ChatWebReference } from "@/lib/chat-web";
import { locatorLabel, sourceCategories } from "@/lib/content";
import type { PageResult } from "@/lib/pagination";
import type { ChatScope, CitationSnapshot } from "@/server/db/schema";
import type {
  conversationDetails,
  listConversations,
} from "@/server/services/chat";

type Detail = Awaited<ReturnType<typeof conversationDetails>>;
type Props = {
  canWrite: boolean;
  workspaceId: string;
  workspace: {
    domains: { id: string; name: string }[];
    projects: { id: string; domainId: string; name: string }[];
  };
  conversations: Awaited<ReturnType<typeof listConversations>>;
  conversationTotal: number;
  detail: Detail | null;
  scope: ChatScope;
  scopeDocument: { title: string; href: string } | null;
  model: Detail["model"];
};
const emptyScope: ChatScope = {
  domainId: null,
  projectId: null,
  sourceId: null,
  wikiId: null,
};
async function jsonRequest(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "요청을 처리하지 못했습니다.");
  return data;
}
export function ChatWorkspace(props: Props) {
  const router = useRouter();
  const formId = useId();
  const base = `/api/workspaces/${props.workspaceId}/conversations`;
  const chatUrl = `/w/${props.workspaceId}/chat`;
  const [detail, setDetail] = useState(props.detail);
  const [scope, setScope] = useState(props.scope);
  const [prompt, setPrompt] = useState("");
  const imageInput = useChatImages();
  const [pendingImages, setPendingImages] = useState<MessageImage[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState("");
  const [liveRefs, setLiveRefs] = useState<CitationSnapshot[]>([]);
  const [liveWebRefs, setLiveWebRefs] = useState<ChatWebReference[]>([]);
  const [liveTools, setLiveTools] = useState<AgentToolEvent[]>([]);
  const [notice, setNotice] = useState("");
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [referenceRunId, setReferenceRunId] = useState<string | null>(null);
  const [referenceKey, setReferenceKey] = useState<string | null>(null);
  const [compact, setCompact] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const requestPending = useRef(false);
  const scopePending = useRef(false);
  const composing = useRef(false);
  const history = useRef<HTMLDivElement | null>(null);
  const historyContent = useRef<HTMLDivElement | null>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const followLatest = useRef(true);
  const referenceTrigger = useRef<HTMLElement | null>(null);
  const referencePanel = useRef<HTMLElement | null>(null);
  const mobileReferencePanel = useRef<HTMLDivElement | null>(null);
  const layout = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useLayoutEffect(() => {
    const focusAnswer = () => {
      if (!/^#run-[0-9a-f-]{36}$/.test(location.hash)) return;
      const target = document.getElementById(location.hash.slice(1));
      if (!target) return;
      followLatest.current = false;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start" });
      setShowJump(true);
    };
    focusAnswer();
    window.addEventListener("hashchange", focusAnswer);
    return () => window.removeEventListener("hashchange", focusAnswer);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1100px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const shell = layout.current?.closest<HTMLElement>(".app-shell");
    const viewport = window.visualViewport;
    if (!shell || !viewport) return;
    const update = () =>
      shell.style.setProperty("--chat-viewport-height", `${viewport.height}px`);
    update();
    viewport.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("resize", update);
      shell.style.removeProperty("--chat-viewport-height");
    };
  }, []);
  useLayoutEffect(() => {
    const input = textarea.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 60), 160)}px`;
  }, []);
  useEffect(() => {
    const content = historyContent.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (followLatest.current && history.current)
        history.current.scrollTop = history.current.scrollHeight;
    });
    observer.observe(content);
    if (history.current) observer.observe(history.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!detail?.runs.some((r) => r.state === "running") || busy) return;
    const timer = setInterval(() => {
      void jsonRequest(`${base}/${detail.conversation.id}`, "GET")
        .then(setDetail)
        .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [detail, busy, base]);
  useEffect(() => {
    if (!referencesOpen || compact) return;
    const target = referenceKey
      ? referencePanel.current?.querySelector<HTMLElement>(
          `[data-citation="${referenceKey}"]`,
        )
      : referencePanel.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  }, [referencesOpen, referenceKey, compact]);

  const busyElsewhere =
    detail?.runs.some((r) => r.state === "running") ?? false;
  const locked = busy || busyElsewhere || scopeSaving || imageInput.reading;
  const referenceRun = detail?.runs.find((r) => r.id === referenceRunId);
  const referenceRefs =
    referenceRunId === "live"
      ? liveRefs
      : (referenceRun?.citations.filter((c) => c.used).map((c) => c.snapshot) ??
        []);
  const referenceWebRefs =
    referenceRunId === "live"
      ? liveWebRefs
      : (referenceRun?.webReferences.filter((ref) => ref.used) ?? []);
  const isEmpty = !detail?.runs.length && !pendingPrompt;
  const showPending =
    busy &&
    !detail?.runs.some((r) => r.id === activeRun && r.state !== "running");
  const conversations =
    detail && !props.conversations.some((c) => c.id === detail.conversation.id)
      ? [detail.conversation, ...props.conversations]
      : props.conversations;
  const restoreReferenceFocus = () => {
    requestAnimationFrame(() =>
      referenceTrigger.current?.focus({ preventScroll: true }),
    );
  };
  const openReferences = (runId: string, key?: string) => {
    referenceTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setReferenceRunId(runId);
    setReferenceKey(key ?? null);
    setReferencesOpen(true);
  };
  const jumpToLatest = () => {
    followLatest.current = true;
    setShowJump(false);
    if (history.current)
      history.current.scrollTop = history.current.scrollHeight;
  };
  const startNew = () => {
    if (locked) return;
    setDetail(null);
    setScope(emptyScope);
    setPrompt("");
    imageInput.clear();
    setError("");
    setNotice("");
    setReferencesOpen(false);
    setConversationsOpen(false);
    followLatest.current = true;
    setShowJump(false);
    router.push(chatUrl, { scroll: false });
    textarea.current?.focus();
  };
  const changeScope = async (next: ChatScope) => {
    if (locked || scopePending.current) return;
    const previous = scope;
    setScope(next);
    setError("");
    if (!detail) {
      setNotice("선택한 범위로 질문합니다.");
      return;
    }
    scopePending.current = true;
    setScopeSaving(true);
    try {
      const saved = await jsonRequest(
        `${base}/${detail.conversation.id}`,
        "PATCH",
        {
          title: detail.conversation.title,
          scope: next,
        },
      );
      setDetail((current) =>
        current ? { ...current, conversation: saved } : current,
      );
      setNotice("다음 질문부터 변경한 범위를 사용합니다.");
    } catch (e) {
      setScope(previous);
      setError(e instanceof Error ? e.message : "범위를 저장하지 못했습니다.");
    } finally {
      scopePending.current = false;
      setScopeSaving(false);
    }
  };
  const saveEmptyConversation = async () => {
    if (locked || detail || scopePending.current) return;
    scopePending.current = true;
    setScopeSaving(true);
    setError("");
    try {
      const created = await jsonRequest(base, "POST", { scope });
      setManagementOpen(false);
      router.push(`${chatUrl}?conversation=${created.id}`, { scroll: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      scopePending.current = false;
      setScopeSaving(false);
    }
  };
  const ask = async (value = prompt, retryImages?: ChatImageInfo[]) => {
    if (
      (!value.trim() && !imageInput.images.length && !retryImages?.length) ||
      value.length > 4000 ||
      locked ||
      requestPending.current ||
      scopePending.current
    )
      return;
    requestPending.current = true;
    setBusy(true);
    setPendingPrompt(value || "첨부한 이미지를 살펴보고 설명해 주세요.");
    setReferencesOpen(false);
    setReferenceRunId(null);
    setError("");
    setLive("");
    setLiveRefs([]);
    setLiveWebRefs([]);
    setNotice("");
    jumpToLatest();
    const abort = new AbortController();
    controller.current = abort;
    let id = detail?.conversation.id;
    try {
      const outgoingImages = retryImages
        ? await Promise.all(
            retryImages.map(async (image) => {
              const response = await fetch(image.href, {
                signal: abort.signal,
              });
              if (!response.ok)
                throw new Error("다시 보낼 첨부 이미지를 불러오지 못했습니다.");
              return fileToMessageImage(
                new File([await response.blob()], image.name, {
                  type: image.mediaType,
                }),
              );
            }),
          )
        : imageInput.images;
      setPendingImages(outgoingImages);
      if (!id) {
        const created = await jsonRequest(base, "POST", {
          scope,
          title: value.trim().slice(0, 60) || "이미지 질문",
        });
        id = created.id as string;
        setDetail(await jsonRequest(`${base}/${id}`, "GET"));
        window.history.replaceState(null, "", `${chatUrl}?conversation=${id}`);
      }
      const response = await fetch(`${base}/${id}/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          prompt: value,
          images: outgoingImages,
        }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json();
        throw new Error(data.error ?? "답변 요청에 실패했습니다.");
      }
      setPrompt("");
      if (!retryImages) imageInput.clear();
      for await (const record of sseRecords(response.body)) {
        const event = JSON.parse(record);
        if (event.type === "run") {
          setActiveRun(event.runId);
          setLiveTools([]);
        }
        if (event.type === "tool")
          setLiveTools((events) => [...events, event.event]);
        if (event.type === "sources") {
          setLiveRefs(event.citations);
          setLiveWebRefs(event.webReferences ?? []);
          setNotice(event.notice);
        }
        if (event.type === "token") setLive((v) => v + event.text);
        if (event.type === "error") {
          setLive("");
          setError(event.error);
        }
        if (event.type === "done") {
          setDetail(event);
          setLive("");
          setLiveRefs([]);
          setLiveWebRefs([]);
          setReferenceRunId((current) =>
            current === "live" ? (event.runs.at(-1)?.id ?? null) : current,
          );
        }
      }
    } catch (e) {
      if (!abort.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "연결이 끊어졌습니다. 대화를 다시 열어주세요.",
        );
    } finally {
      setActiveRun(null);
      controller.current = null;
      if (id) {
        try {
          const refreshed = await jsonRequest(`${base}/${id}`, "GET");
          setDetail(refreshed);
          setReferenceRunId((current) =>
            current === "live" ? (refreshed.runs.at(-1)?.id ?? null) : current,
          );
          setLive("");
          setLiveRefs([]);
          setLiveWebRefs([]);
        } catch {
          setError(
            "대화 상태를 불러오지 못했습니다. 새로고침 후 확인해주세요.",
          );
        }
      }
      setPendingPrompt("");
      setPendingImages([]);
      requestPending.current = false;
      setBusy(false);
      router.refresh();
    }
  };
  const stop = async (runId = activeRun) => {
    try {
      if (detail && runId) {
        await jsonRequest(`${base}/${detail.conversation.id}`, "POST", {
          action: "cancel",
          runId,
        });
      }
      controller.current?.abort();
      if (detail)
        setDetail(
          await jsonRequest(`${base}/${detail.conversation.id}`, "GET"),
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "중지 요청에 실패했습니다.");
    }
  };
  const historyProps = {
    conversations,
    total: props.conversationTotal,
    apiUrl: base,
    currentId: detail?.conversation.id,
    chatUrl,
    disabled: locked,
    onNew: startNew,
    onNavigate: () => setConversationsOpen(false),
  };
  const scopeDescription = (s: ChatScope) =>
    (props.workspace.domains.find((d) => d.id === s.domainId)?.name ??
      "모든 도메인") +
    (s.projectId
      ? " · " +
        (props.workspace.projects.find((p) => p.id === s.projectId)?.name ??
          "프로젝트")
      : "") +
    (s.sourceId ? " · 선택 자료" : s.wikiId ? " · 선택 위키" : "") +
    (s.sourceOnly ? " · 원문만 사용" : "") +
    (s.webProvider ? " · 웹 검색" : "");

  return (
    <div
      className="chat-layout"
      ref={layout}
      data-references={referencesOpen && !compact}
    >
      <aside className="conversation-sidebar" aria-label="내 대화">
        <ConversationHistory {...historyProps} />
      </aside>
      <section className="chat-main" aria-label="업무 지식 채팅">
        <header className="chat-toolbar">
          <Sheet open={conversationsOpen} onOpenChange={setConversationsOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="conversation-toggle"
                aria-label="내 대화 열기"
              >
                <PanelLeft size={19} />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="chat-history-sheet">
              <SheetHeader>
                <SheetTitle>내 대화</SheetTitle>
                <SheetDescription>
                  본인에게만 보이는 대화 기록입니다.
                </SheetDescription>
              </SheetHeader>
              <ConversationHistory {...historyProps} />
            </SheetContent>
          </Sheet>
          <h1 title={detail?.conversation.title}>
            {detail?.conversation.title ?? "새 대화"}
          </h1>
          <span className="chat-private">나만의 대화</span>
          <Button
            variant="ghost"
            size="icon"
            className="conversation-toggle"
            onClick={startNew}
            disabled={locked}
            aria-label="새 대화"
          >
            <MessageSquarePlus size={19} />
          </Button>
          <Dialog open={managementOpen} onOpenChange={setManagementOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="대화 관리">
                <MoreHorizontal size={20} />
              </Button>
            </DialogTrigger>
            <DialogContent className="chat-management">
              <DialogHeader>
                <DialogTitle>대화 관리</DialogTitle>
                <DialogDescription>
                  대화는 본인에게만 보입니다. 제목·답변 의견·삭제를 관리합니다.
                </DialogDescription>
              </DialogHeader>
              <Link
                className="text-link"
                href={`/w/${props.workspaceId}/issues`}
              >
                내 신고·답변 의견 →
              </Link>
              {detail ? (
                <>
                  <RenameConversation
                    workspaceId={props.workspaceId}
                    conversation={detail.conversation}
                    disabled={locked}
                    onRenamed={(conversation) => {
                      setDetail((current) =>
                        current ? { ...current, conversation } : current,
                      );
                      router.refresh();
                    }}
                  />
                  <DeleteConversation
                    key={detail.conversation.id}
                    workspaceId={props.workspaceId}
                    conversationId={detail.conversation.id}
                    disabled={locked}
                  />
                </>
              ) : (
                <Button
                  variant="outline"
                  disabled={locked}
                  onClick={() => void saveEmptyConversation()}
                >
                  현재 범위로 빈 대화 저장
                </Button>
              )}
            </DialogContent>
          </Dialog>
        </header>
        <div className="chat-body" data-empty={isEmpty}>
          <div className="chat-transcript">
            <section
              className="chat-history"
              aria-label="대화 내용"
              ref={history}
              onScroll={(e) => {
                const el = e.currentTarget;
                const nearBottom =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                followLatest.current = nearBottom;
                setShowJump(!nearBottom);
              }}
            >
              <div className="chat-history-content" ref={historyContent}>
                {isEmpty && (
                  <div className="chat-welcome">
                    <BookOpen size={27} aria-hidden="true" />
                    <h2>팀의 지식에 질문하세요</h2>
                    <p>업무 자료에서 답을 찾고, 출처를 함께 확인하세요.</p>
                  </div>
                )}
                {detail?.runs
                  .filter(
                    (r) =>
                      !(busy && r.id === activeRun && r.state === "running"),
                  )
                  .map((r) => {
                    const refs = r.citations
                      .filter((c) => c.used)
                      .map((c) => c.snapshot);
                    const webRefs = r.webReferences.filter((ref) => ref.used);
                    return (
                      <article
                        className="chat-turn"
                        key={r.id}
                        id={`run-${r.id}`}
                        tabIndex={-1}
                      >
                        <div className="chat-question">
                          <span className="sr-only">나</span>
                          <p>{r.prompt}</p>
                          <ChatImages images={r.images} />
                        </div>
                        <div className="chat-answer">
                          <div className="chat-answer-heading">
                            <BookOpen size={16} aria-hidden="true" />
                            <span>업무 위키</span>
                            <small>{scopeDescription(r.scope)}</small>
                          </div>
                          {r.state !== "completed" && (
                            <span className="state-label">
                              {runLabels[r.state] ?? r.state}
                            </span>
                          )}
                          <ChatToolEvents events={r.toolEvents} />
                          {r.messages
                            .filter((m) => m.role === "assistant")
                            .map((m) => (
                              <ChatMarkdown
                                key={m.id}
                                citations={[...refs, ...webRefs]}
                                linkDestinations={r.linkDestinations}
                                onCitationClick={(key) =>
                                  openReferences(r.id, key)
                                }
                              >
                                {m.body}
                              </ChatMarkdown>
                            ))}
                          {r.errorMessage && (
                            <p className="form-error">{r.errorMessage}</p>
                          )}
                          {refs.length + webRefs.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="chat-sources-button"
                              onClick={() => openReferences(r.id)}
                            >
                              <FileText size={15} />
                              참고 자료 {refs.length + webRefs.length}개
                            </Button>
                          )}
                          {r.state === "completed" && (
                            <div className="chat-answer-tools">
                              <CopyAnswer
                                workspaceId={props.workspaceId}
                                conversationId={detail.conversation.id}
                                runId={r.id}
                              />
                              <FeedbackForm
                                endpoint={`${base}/${detail.conversation.id}`}
                                runId={r.id}
                                current={r.feedback}
                                feedbackHref={`/w/${props.workspaceId}/issues#answer-feedback`}
                              />
                              {props.canWrite && (
                                <SaveAnswerToWiki
                                  workspaceId={props.workspaceId}
                                  conversationId={detail.conversation.id}
                                  runId={r.id}
                                />
                              )}
                              {props.canWrite && (
                                <ProposeAnswer
                                  workspaceId={props.workspaceId}
                                  conversationId={detail.conversation.id}
                                  runId={r.id}
                                />
                              )}
                            </div>
                          )}
                          {[
                            "failed",
                            "canceled",
                            "interrupted",
                            "restricted",
                          ].includes(r.state) && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={locked}
                              onClick={() => void ask(r.prompt, r.images)}
                            >
                              다시 질문
                            </Button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                {showPending && (
                  <article className="chat-turn chat-pending">
                    <div className="chat-question">
                      <span className="sr-only">나</span>
                      <p>{pendingPrompt}</p>
                      <ChatImages
                        images={pendingImages.map((image) => ({
                          name: image.name,
                          href: messageImageToDataUrl(image),
                        }))}
                      />
                    </div>
                    <div className="chat-answer">
                      <output className="chat-progress">
                        <span className="chat-progress-dot" />
                        {live
                          ? "답변을 작성하고 있습니다…"
                          : "업무 자료에서 근거를 찾고 있습니다…"}
                      </output>
                      <ChatToolEvents events={liveTools} />
                      <ChatMarkdown
                        citations={[...liveRefs, ...liveWebRefs]}
                        onCitationClick={(key) => openReferences("live", key)}
                      >
                        {live}
                      </ChatMarkdown>
                      {liveRefs.length + liveWebRefs.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="chat-sources-button"
                          onClick={() => openReferences("live")}
                        >
                          <FileText size={15} />
                          찾은 자료 {liveRefs.length + liveWebRefs.length}개
                        </Button>
                      )}
                    </div>
                  </article>
                )}
              </div>
            </section>
            {showJump && !isEmpty && (
              <Button
                variant="outline"
                size="sm"
                className="chat-jump"
                onClick={jumpToLatest}
              >
                <ArrowDown size={15} />
                최신 답변으로
              </Button>
            )}
          </div>
          <div className="chat-compose-area">
            {!props.model.chatConfigured && (
              <output className="chat-model-notice">
                AI 모델 연결이 필요합니다. 관리자에게 연결을 요청해주세요.
              </output>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <form
              className="chat-composer"
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files"))
                  event.preventDefault();
              }}
              onDrop={(event) => {
                if (!event.dataTransfer.types.includes("Files")) return;
                event.preventDefault();
                if (!locked)
                  void imageInput.add(Array.from(event.dataTransfer.files));
              }}
              onSubmit={(e) => {
                e.preventDefault();
                void ask();
              }}
            >
              <ChatImagePicker input={imageInput} disabled={locked} />
              <ChatWebPicker
                workspaceId={props.workspaceId}
                scope={scope}
                disabled={locked}
                onChange={changeScope}
              />
              <Field className="chat-prompt-field">
                <FieldLabel className="sr-only" htmlFor={`${formId}-question`}>
                  업무 질문
                </FieldLabel>
                <Textarea
                  ref={textarea}
                  id={`${formId}-question`}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onPaste={(event) => {
                    const files = Array.from(event.clipboardData.files);
                    if (files.length) {
                      event.preventDefault();
                      if (!locked) void imageInput.add(files);
                    }
                  }}
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !composing.current &&
                      !e.nativeEvent.isComposing &&
                      e.nativeEvent.keyCode !== 229
                    ) {
                      e.preventDefault();
                      if (!e.repeat) e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  disabled={busy || busyElsewhere}
                  required={!imageInput.images.length}
                  maxLength={4000}
                  rows={2}
                  aria-describedby={`${formId}-input-help`}
                  placeholder={
                    isEmpty
                      ? "궁금한 업무를 질문해보세요."
                      : "이어서 질문해보세요."
                  }
                />
              </Field>
              <div className="chat-composer-bottom">
                <section className="chat-scope" aria-label="질문 범위">
                  <Field>
                    <FieldLabel
                      className="sr-only"
                      htmlFor={`${formId}-domain`}
                    >
                      질문할 도메인
                    </FieldLabel>
                    <Select
                      value={scope.domainId ?? "all"}
                      disabled={locked}
                      onValueChange={(v) =>
                        void changeScope({
                          ...emptyScope,
                          sourceOnly: scope.sourceOnly,
                          agentMode: scope.agentMode,
                          domainId: v === "all" ? null : v,
                        })
                      }
                    >
                      <SelectTrigger id={`${formId}-domain`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">모든 도메인</SelectItem>
                        {props.workspace.domains.map((d) => (
                          <SelectItem value={d.id} key={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {scope.domainId && (
                    <Field>
                      <FieldLabel
                        className="sr-only"
                        htmlFor={`${formId}-project`}
                      >
                        프로젝트
                      </FieldLabel>
                      <Select
                        value={scope.projectId ?? "all"}
                        disabled={locked}
                        onValueChange={(v) =>
                          void changeScope({
                            ...scope,
                            projectId: v === "all" ? null : v,
                            sourceId: null,
                            wikiId: null,
                          })
                        }
                      >
                        <SelectTrigger id={`${formId}-project`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">프로젝트 전체</SelectItem>
                          {props.workspace.projects
                            .filter((p) => p.domainId === scope.domainId)
                            .map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                  <Field>
                    <FieldLabel
                      className="sr-only"
                      htmlFor={`${formId}-agent-mode`}
                    >
                      자료 탐색 깊이
                    </FieldLabel>
                    <Select
                      value={scope.agentMode ?? "standard"}
                      disabled={locked}
                      onValueChange={(value) =>
                        void changeScope({
                          ...scope,
                          agentMode: value as ChatScope["agentMode"],
                        })
                      }
                    >
                      <SelectTrigger id={`${formId}-agent-mode`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fast">빠른 탐색</SelectItem>
                        <SelectItem value="standard">기본 탐색</SelectItem>
                        <SelectItem value="deep">깊은 탐색</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field orientation="horizontal" className="chat-source-only">
                    <Checkbox
                      id={`${formId}-source-only`}
                      checked={!!scope.sourceOnly}
                      disabled={locked}
                      onCheckedChange={(checked) =>
                        void changeScope({
                          ...scope,
                          sourceOnly: checked === true,
                          webProvider:
                            checked === true ? undefined : scope.webProvider,
                        })
                      }
                      aria-describedby={`${formId}-source-only-help`}
                    />
                    <FieldLabel htmlFor={`${formId}-source-only`}>
                      원문만 사용
                    </FieldLabel>
                    <FieldDescription
                      id={`${formId}-source-only-help`}
                      className="sr-only"
                    >
                      공개 원문에서만 검색합니다. 위키·관계 탐색과 웹 검색을
                      해제합니다.
                    </FieldDescription>
                  </Field>
                </section>
                {busy || busyElsewhere ? (
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    disabled={busy && !activeRun}
                    onClick={() =>
                      void stop(
                        activeRun ??
                          detail?.runs.find((r) => r.state === "running")?.id,
                      )
                    }
                    aria-label="답변 중지"
                  >
                    <Square size={17} />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    type="submit"
                    disabled={
                      (!prompt.trim() && !imageInput.images.length) ||
                      scopeSaving ||
                      imageInput.reading
                    }
                    aria-label="질문 보내기"
                  >
                    <ArrowUp size={19} />
                  </Button>
                )}
              </div>
              {(scope.sourceId || scope.wikiId) && (
                <div className="chat-document-scope">
                  <FileText size={15} aria-hidden="true" />
                  {props.scopeDocument ? (
                    <a
                      href={props.scopeDocument.href}
                      title={props.scopeDocument.title}
                    >
                      {props.scopeDocument.title}
                    </a>
                  ) : (
                    <span>
                      {scope.sourceId ? "선택한 자료" : "선택한 위키"}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    disabled={locked}
                    aria-label="자료 한정 해제"
                    onClick={() =>
                      void changeScope({
                        ...scope,
                        sourceId: null,
                        wikiId: null,
                      })
                    }
                  >
                    <X size={14} />
                  </Button>
                </div>
              )}
            </form>
            <div className="chat-input-help" id={`${formId}-input-help`}>
              <span>
                {scopeSaving
                  ? "질문 범위 저장 중…"
                  : notice || "답변의 출처에서 적용 조건을 확인하세요."}
              </span>
              <span className="chat-keyboard-help">
                Enter 전송 · Shift+Enter 줄바꿈
              </span>
              {prompt.length >= 3600 && <span>{prompt.length}/4000</span>}
            </div>
            {isEmpty && (
              <section className="chat-suggestions" aria-label="예시 질문">
                {[
                  "관제 화면 갱신 주기는 어떻게 정하나요?",
                  "이 업무에 적용되는 기준을 찾아주세요.",
                  "프로젝트에서 확인할 주의사항은 무엇인가요?",
                ].map((example) => (
                  <Button
                    variant="outline"
                    size="sm"
                    key={example}
                    onClick={() => {
                      setPrompt(example);
                      textarea.current?.focus();
                    }}
                  >
                    {example}
                  </Button>
                ))}
              </section>
            )}
          </div>
        </div>
      </section>
      {referencesOpen && !compact && (
        <aside
          className="chat-reference"
          aria-label="답변의 원문 근거"
          ref={referencePanel}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setReferencesOpen(false);
              restoreReferenceFocus();
            }
          }}
        >
          <header className="chat-reference-heading">
            <h2>답변의 원문 근거</h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label="근거 패널 닫기"
              onClick={() => {
                setReferencesOpen(false);
                restoreReferenceFocus();
              }}
            >
              <X size={18} />
            </Button>
          </header>
          <p className="chat-reference-question">
            {referenceRunId === "live" ? pendingPrompt : referenceRun?.prompt}
          </p>
          {referenceRunId === "live" && (
            <p className="field-help">
              검색한 후보 자료입니다. 답변이 완료되면 사용한 근거만 표시합니다.
            </p>
          )}
          <EvidencePanel
            refs={referenceRefs}
            webRefs={referenceWebRefs}
            selectedKey={referenceKey}
          />
        </aside>
      )}
      <Sheet open={referencesOpen && compact} onOpenChange={setReferencesOpen}>
        <SheetContent
          className="chat-reference-sheet"
          ref={mobileReferencePanel}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            restoreReferenceFocus();
          }}
          onOpenAutoFocus={(e) => {
            if (!referenceKey) return;
            const target =
              mobileReferencePanel.current?.querySelector<HTMLElement>(
                `[data-citation="${referenceKey}"]`,
              );
            if (target) {
              e.preventDefault();
              target.focus();
            }
          }}
        >
          <SheetHeader>
            <SheetTitle>답변의 원문 근거</SheetTitle>
            <SheetDescription>
              {referenceRunId === "live"
                ? "검색한 후보 자료입니다. 완료 후 사용한 근거만 표시합니다."
                : referenceRun?.prompt ||
                  "답변에 사용한 자료와 원문을 확인하세요."}
            </SheetDescription>
          </SheetHeader>
          <EvidencePanel
            refs={referenceRefs}
            webRefs={referenceWebRefs}
            selectedKey={referenceKey}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
function ConversationHistory({
  conversations,
  total,
  apiUrl,
  currentId,
  chatUrl,
  disabled,
  onNew,
  onNavigate,
}: {
  conversations: Props["conversations"];
  total: number;
  apiUrl: string;
  currentId?: string;
  chatUrl: string;
  disabled: boolean;
  onNew: () => void;
  onNavigate: () => void;
}) {
  const id = useId();
  const { conversationSearch, setConversationSearch } = useWorkspaceClient();
  const { q: query, page } = conversationSearch;
  const setPage = (page: number) => setConversationSearch({ q: query, page });
  const [result, setResult] = useState<
    (PageResult<Props["conversations"][number]> & { query: string }) | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          q: query,
          page: String(page),
          pageSize: "30",
        });
        const response = await fetch(`${apiUrl}?${params}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error ?? "대화를 불러오지 못했습니다.");
        if (!controller.signal.aborted) setResult({ ...data, query });
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "대화를 불러오지 못했습니다.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [apiUrl, page, query]);
  const current =
    result?.query === query && result.page === page ? result : null;
  const matches = current?.items ?? (!query && page === 1 ? conversations : []);
  const count = current?.total ?? (!query ? total : 0);
  const totalPages = current?.totalPages ?? Math.max(1, Math.ceil(count / 30));
  return (
    <div className="conversation-list">
      <Button
        className="chat-new-conversation"
        onClick={onNew}
        disabled={disabled}
      >
        <MessageSquarePlus size={17} />새 대화
      </Button>
      <Field className="conversation-search">
        <FieldLabel className="sr-only" htmlFor={id}>
          최근 대화 검색
        </FieldLabel>
        <Search size={16} aria-hidden="true" />
        <Input
          id={id}
          type="search"
          value={query}
          onChange={(e) => {
            setConversationSearch({ q: e.target.value, page: 1 });
          }}
          placeholder="전체 대화 제목 검색"
          maxLength={100}
          autoComplete="off"
        />
      </Field>
      <h2>
        {query ? "검색한 대화" : "최근 대화"} <span>{count}</span>
      </h2>
      <nav className="conversation-links" aria-label="최근 대화 목록">
        {matches.map((c) => (
          <Link
            aria-current={currentId === c.id ? "page" : undefined}
            href={`${chatUrl}?conversation=${c.id}`}
            key={c.id}
            onClick={onNavigate}
            scroll={false}
          >
            <span>{c.title}</span>
            <small>
              {new Date(c.updatedAt).toLocaleDateString("ko-KR", {
                timeZone: "Asia/Seoul",
                month: "long",
                day: "numeric",
              })}
            </small>
          </Link>
        ))}
        {!matches.length && !loading && !error && current && (
          <p className="conversation-empty">
            {query
              ? "검색 결과가 없습니다."
              : "첫 질문으로 대화를 시작해보세요."}
          </p>
        )}
      </nav>
      {loading && <output className="field-help">대화를 찾고 있습니다.</output>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="conversation-pagination">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || loading}
          onClick={() => setPage(page - 1)}
        >
          이전
        </Button>
        <span>
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages || loading}
          onClick={() => setPage(page + 1)}
        >
          다음
        </Button>
      </div>
      <p className="conversation-privacy">
        본인의 전체 대화 제목에서 검색합니다. 대화는 본인에게만 보입니다.
      </p>
    </div>
  );
}
function EvidencePanel({
  refs,
  webRefs,
  selectedKey,
}: {
  refs: CitationSnapshot[];
  webRefs: ChatWebReference[];
  selectedKey: string | null;
}) {
  return (
    <div className="chat-evidence">
      {!refs.length && !webRefs.length && (
        <p className="field-help">이 답변에 연결된 원문 근거가 없습니다.</p>
      )}
      {refs.map((r) => (
        <article
          key={r.key}
          data-citation={r.key}
          data-selected={r.key === selectedKey}
          tabIndex={-1}
        >
          <span className="chat-evidence-number">[{r.key}]</span>
          <a href={r.href}>{r.title}</a>
          <small>
            {r.category === "wiki"
              ? "게시 위키"
              : (sourceCategories[
                  r.category as keyof typeof sourceCategories
                ] ?? "원본")}
            {r.locator ? ` · ${locatorLabel(r.locator)}` : ""}
          </small>
          <p>{r.text}</p>
          {r.omittedLinks && (
            <small>질문 범위 밖 위키의 연결 문구를 생략했습니다.</small>
          )}
          {r.excerpt && (
            <small>
              일부 발췌{r.omittedLinks ? " (연결 생략 후 기준)" : ""} ·{" "}
              {r.excerpt.start + 1}~{r.excerpt.end}번째 문자 / 전체{" "}
              {r.excerpt.total}자
            </small>
          )}
          {r.graph && (
            <small>
              위키 관계를 통해 찾은 원문 · 연결 자체는 사실 근거가 아닙니다.
            </small>
          )}
          <a className="chat-original-link" href={r.href}>
            해당 원문 열기 ↗
          </a>
        </article>
      ))}
      {webRefs.map((ref) => (
        <article
          key={ref.key}
          data-citation={ref.key}
          data-selected={ref.key === selectedKey}
          tabIndex={-1}
        >
          <span className="chat-evidence-number">[{ref.key}]</span>
          <a href={ref.url} target="_blank" rel="noopener noreferrer">
            {ref.title}
          </a>
          <small>
            웹 검색 발췌 · {new Date(ref.searchedAt).toLocaleString("ko-KR")}{" "}
            검색
          </small>
          <p>{ref.snippet}</p>
          <small>
            검색 당시 발췌입니다. 업무에 적용하기 전에 원문과 조건을 확인하세요.
          </small>
          <a
            className="chat-original-link"
            href={ref.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            웹 원문 열기 ↗
          </a>
        </article>
      ))}
    </div>
  );
}
function FeedbackForm({
  endpoint,
  runId,
  current,
  feedbackHref,
}: {
  endpoint: string;
  runId: string;
  current: Detail["runs"][number]["feedback"];
  feedbackHref: string;
}) {
  const id = useId();
  const details = useRef<HTMLDetailsElement | null>(null);
  const summary = useRef<HTMLElement | null>(null);
  const pending = useRef(false);
  const [saved, setSaved] = useState(current);
  const [rating, setRating] = useState(current?.rating ?? "incorrect");
  const [note, setNote] = useState(current?.note ?? "");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <details className="chat-feedback" ref={details}>
        <summary ref={summary}>
          {saved ? "의견이 접수되었습니다 · 수정하기" : "답변에 의견 남기기"}
        </summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (pending.current) return;
            pending.current = true;
            setBusy(true);
            setError("");
            setNotice("");
            try {
              const r = await jsonRequest(endpoint, "POST", {
                runId,
                rating,
                note,
              });
              setSaved(r);
              setRating(r.rating);
              setNote(r.note);
              setNotice(
                "의견을 저장했습니다. 내 의견 확인에서 처리 상태를 볼 수 있습니다.",
              );
              if (details.current) details.current.open = false;
              summary.current?.focus({ preventScroll: true });
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "의견 저장에 실패했습니다.",
              );
            } finally {
              pending.current = false;
              setBusy(false);
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-rating`}>답변 평가</FieldLabel>
              <Select
                name="rating"
                value={rating}
                onValueChange={setRating}
                disabled={busy}
              >
                <SelectTrigger id={`${id}-rating`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="incorrect">
                    내용이나 근거 수정이 필요해요
                  </SelectItem>
                  <SelectItem value="helpful">도움이 되었어요</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-note`}>확인할 내용</FieldLabel>
              <Textarea
                id={`${id}-note`}
                name="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
                aria-describedby={`${id}-help`}
                maxLength={2000}
                placeholder="검토 직원이 확인할 오류나 조건을 적어주세요."
              />
            </Field>
            <FieldDescription id={`${id}-help`}>
              평가와 작성한 의견을 검토함에 전달합니다. 개인 대화 본문은 자동
              공유하지 않습니다. 처리 상태는 내 신고·답변 의견에서 확인할 수
              있습니다.
            </FieldDescription>
            <Button disabled={busy} type="submit">
              {busy ? "보내는 중…" : "의견 보내기"}
            </Button>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
          </FieldGroup>
        </form>
      </details>
      {saved && (
        <Link className="chat-feedback-link" href={feedbackHref}>
          내 의견 확인 →
        </Link>
      )}
      <output className="sr-only">{notice}</output>
    </>
  );
}
