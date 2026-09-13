"use client";

import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { useWorkspaceClient } from "@/components/workspace-client";

const prefix = "wiki-draft:";
const navigationEvent = "wiki:before-navigation";
export function confirmDraftNavigation() {
  return window.dispatchEvent(new Event(navigationEvent, { cancelable: true }));
}
export function clearLocalDrafts() {
  window.dispatchEvent(new Event("wiki:clear-drafts"));
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith(prefix)) sessionStorage.removeItem(key);
  } catch {
    /* 저장소를 사용할 수 없는 브라우저도 로그아웃할 수 있다. */
  }
}

export function useDraft<T>({
  id,
  value,
  schema,
  restore,
}: {
  id: string;
  value: T;
  schema: z.ZodType<T>;
  restore: (value: T) => void;
}) {
  const { userId } = useWorkspaceClient();
  const key = `${prefix}${userId}:${id}`;
  const serialized = JSON.stringify(value);
  const initial = useRef(serialized);
  const baseline = useRef(serialized);
  const latest = useRef(serialized);
  const restoreRef = useRef(restore);
  const schemaRef = useRef(schema);
  const ready = useRef(false);
  const [restored, setRestored] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [saved, setSaved] = useState(false);
  latest.current = serialized;
  restoreRef.current = restore;
  schemaRef.current = schema;

  useEffect(() => {
    ready.current = false;
    try {
      const text = sessionStorage.getItem(key);
      if (text && text.length <= 1_000_000) {
        const stored = JSON.parse(text);
        if (
          stored.format === 1 &&
          stored.base === baseline.current &&
          Number.isFinite(stored.updatedAt) &&
          Date.now() - stored.updatedAt < 86400000
        ) {
          const parsed = schemaRef.current.safeParse(stored.value);
          if (parsed.success) {
            restoreRef.current(parsed.data);
            latest.current = JSON.stringify(parsed.data);
            setRestored(true);
          } else sessionStorage.removeItem(key);
        } else sessionStorage.removeItem(key);
      }
    } catch {
      setStorageError(true);
    }
    ready.current = true;
    const persist = () => {
      if (!ready.current) return;
      try {
        if (latest.current === baseline.current) sessionStorage.removeItem(key);
        else
          sessionStorage.setItem(
            key,
            JSON.stringify({
              format: 1,
              base: baseline.current,
              updatedAt: Date.now(),
              value: JSON.parse(latest.current),
            }),
          );
      } catch {
        setStorageError(true);
      }
    };
    const confirm = () =>
      latest.current === baseline.current ||
      window.confirm(
        "저장하지 않은 변경이 있습니다. 임시 초안을 남기고 이동할까요?",
      );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      persist();
      if (latest.current !== baseline.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.isContentEditable ||
        link.target === "_blank" ||
        link.hasAttribute("download")
      )
        return;
      const target = new URL(link.href, location.href);
      if (
        target.origin === location.origin &&
        target.pathname === location.pathname &&
        target.search === location.search
      )
        return;
      persist();
      if (!confirm()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const navigate = (event: Event) => {
      persist();
      if (!confirm()) event.preventDefault();
    };
    const forget = () => {
      baseline.current = latest.current;
      ready.current = false;
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", persist);
    window.addEventListener(navigationEvent, navigate);
    window.addEventListener("wiki:clear-drafts", forget);
    document.addEventListener("click", click, true);
    return () => {
      persist();
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", persist);
      window.removeEventListener(navigationEvent, navigate);
      window.removeEventListener("wiki:clear-drafts", forget);
      document.removeEventListener("click", click, true);
    };
  }, [key]);
  useEffect(() => {
    if (!ready.current || serialized !== latest.current) return;
    setSaved(false);
    try {
      if (serialized === baseline.current) sessionStorage.removeItem(key);
      else
        sessionStorage.setItem(
          key,
          JSON.stringify({
            format: 1,
            base: baseline.current,
            updatedAt: Date.now(),
            value: JSON.parse(serialized),
          }),
        );
    } catch {
      setStorageError(true);
    }
  }, [key, serialized]);
  const clear = () => {
    baseline.current = latest.current;
    try {
      sessionStorage.removeItem(key);
    } catch {
      setStorageError(true);
    }
    setSaved(true);
    setRestored(false);
  };
  const discard = () => {
    baseline.current = initial.current;
    latest.current = initial.current;
    restoreRef.current(JSON.parse(initial.current));
    try {
      sessionStorage.removeItem(key);
    } catch {
      setStorageError(true);
    }
    setRestored(false);
  };
  return {
    dirty: !saved && serialized !== baseline.current,
    restored,
    storageError,
    clear,
    discard,
  };
}

export function DraftNotice({ draft }: { draft: ReturnType<typeof useDraft> }) {
  if (!draft.dirty && !draft.restored && !draft.storageError) return null;
  return (
    <div className="draft-notice">
      <output>
        {draft.storageError
          ? "이 브라우저에서 임시 저장을 사용할 수 없습니다. 이동 전에 저장해 주세요."
          : draft.restored
            ? "이 탭에 남아 있던 임시 초안을 복원했습니다."
            : "작성 내용을 이 탭에 임시 보관하고 있습니다."}
      </output>
      <p className="field-help">
        임시 초안은 같은 계정·탭에서 24시간 동안 복원할 수 있습니다. 서버에
        보관하려면 저장 버튼을 눌러주세요.
      </p>
      {draft.dirty && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={draft.discard}
        >
          임시 초안 버리기
        </Button>
      )}
    </div>
  );
}
