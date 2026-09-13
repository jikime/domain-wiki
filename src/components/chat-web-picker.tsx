"use client";
import { useEffect, useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChatWebProvider } from "@/lib/chat-web";
import { researchProviderLabels } from "@/lib/research";
import type { ChatScope } from "@/server/db/schema";

export function ChatWebPicker({
  workspaceId,
  scope,
  disabled,
  onChange,
}: {
  workspaceId: string;
  scope: ChatScope;
  disabled: boolean;
  onChange: (scope: ChatScope) => Promise<void>;
}) {
  const id = useId();
  const [providers, setProviders] = useState<
    { provider: ChatWebProvider; label: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/workspaces/${workspaceId}/conversations/web-providers`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setProviders(data.providers);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "웹 검색 연결을 확인하지 못했습니다.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [workspaceId]);
  return (
    <div className="chat-web-picker">
      <div className="chat-web-controls">
        <Field orientation="horizontal">
          <Checkbox
            id={id}
            checked={!!scope.webProvider}
            disabled={
              disabled ||
              !!scope.sourceOnly ||
              loading ||
              (!providers.length && !scope.webProvider)
            }
            aria-describedby={`${id}-help`}
            onCheckedChange={(checked) =>
              void onChange({
                ...scope,
                webProvider:
                  checked === true ? providers[0]?.provider : undefined,
              })
            }
          />
          <FieldLabel htmlFor={id}>웹 검색 사용</FieldLabel>
        </Field>
        {scope.webProvider && (
          <Field>
            <FieldLabel className="sr-only" htmlFor={`${id}-provider`}>
              웹 검색 제공자
            </FieldLabel>
            <Select
              value={scope.webProvider}
              onValueChange={(value) =>
                void onChange({
                  ...scope,
                  webProvider: value as ChatWebProvider,
                })
              }
              disabled={disabled || !providers.length}
            >
              <SelectTrigger id={`${id}-provider`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!providers.some(
                  (item) => item.provider === scope.webProvider,
                ) && (
                  <SelectItem value={scope.webProvider} disabled>
                    {researchProviderLabels[scope.webProvider]} · 연결 확인 필요
                  </SelectItem>
                )}
                {providers.map((item) => (
                  <SelectItem value={item.provider} key={item.provider}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>
      <FieldDescription id={`${id}-help`}>
        {scope.sourceOnly
          ? "원문만 사용하는 동안 웹 검색은 꺼집니다."
          : loading
            ? "웹 검색 연결 확인 중…"
            : error ||
              (!providers.length
                ? "연결된 웹 검색 제공자가 없습니다. 관리자에게 연결을 요청하세요."
                : scope.webProvider
                  ? "질문과 필요한 검색어가 선택한 외부 검색 제공자에게 전송됩니다."
                  : "웹 검색을 켜면 외부 출처도 함께 찾습니다.")}
      </FieldDescription>
    </div>
  );
}
