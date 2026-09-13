"use client";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { DomainGuide } from "@/server/db/schema";
export function DomainGuideEditor({
  workspaceId,
  domainId,
  guide,
  options,
}: {
  workspaceId: string;
  domainId: string;
  guide: DomainGuide;
  options: { id: string; title: string }[];
}) {
  const router = useRouter();
  const prefix = useId();
  const [steps, setSteps] = useState(
    guide.steps.map((s) => ({ ...s, key: crypto.randomUUID() })),
  );
  const [readingIds, setReading] = useState(guide.readingIds);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  function edit(key: string, patch: Partial<DomainGuide["steps"][number]>) {
    setSteps((items) =>
      items.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    );
  }
  async function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/domain-guides/${domainId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            steps: steps.map(({ key, ...s }) => s),
            readingIds,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "입문 안내를 저장하지 못했습니다.");
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "서버 연결을 확인해 주세요.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      <FieldSet disabled={pending} inert={pending}>
        <FieldGroup>
          <p className="field-help">
            업무 순서는 관리자가 작성한 안내입니다. 규정과 절차의 근거는 연결한
            게시 위키에서 확인합니다.
          </p>
          {steps.map((s, i) => (
            <div className="guide-step-editor" key={s.key}>
              <h3>순서 {i + 1}</h3>
              <Field>
                <FieldLabel htmlFor={`${prefix}-title-${i}`}>할 일</FieldLabel>
                <Input
                  id={`${prefix}-title-${i}`}
                  required
                  maxLength={120}
                  value={s.title}
                  onChange={(e) => edit(s.key, { title: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${prefix}-desc-${i}`}>안내</FieldLabel>
                <Textarea
                  id={`${prefix}-desc-${i}`}
                  maxLength={1000}
                  value={s.description}
                  onChange={(e) => edit(s.key, { description: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${prefix}-wiki-${i}`}>
                  절차를 설명하는 위키
                </FieldLabel>
                <Select
                  value={s.wikiId ?? "none"}
                  onValueChange={(v) =>
                    edit(s.key, { wikiId: v === "none" ? null : v })
                  }
                >
                  <SelectTrigger id={`${prefix}-wiki-${i}`} className="w-full">
                    <SelectValue placeholder="게시 위키 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">연결 안 함</SelectItem>
                    {options.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.title}
                      </SelectItem>
                    ))}
                    {s.wikiId && !options.some((p) => p.id === s.wikiId) && (
                      <SelectItem value={s.wikiId}>
                        현재 사용할 수 없는 위키 · 연결을 변경해 주세요
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <div className="form-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={i === 0}
                  onClick={() =>
                    setSteps((items) => {
                      const next = [...items];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      return next;
                    })
                  }
                >
                  위로
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setSteps((items) =>
                      items.filter((item) => item.key !== s.key),
                    )
                  }
                >
                  이 순서 삭제
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={steps.length >= 8}
            onClick={() =>
              setSteps((items) => [
                ...items,
                {
                  key: crypto.randomUUID(),
                  title: "",
                  description: "",
                  wikiId: null,
                },
              ])
            }
          >
            업무 순서 추가
          </Button>
          <h3>추천 읽기</h3>
          <p className="field-help">
            최대 12개를 선택할 수 있습니다. 철회되거나 근거가 바뀐 위키는 홈에서
            제외됩니다.
          </p>
          {options.map((p, i) => (
            <Field orientation="horizontal" key={p.id}>
              <Checkbox
                id={`${prefix}-read-${i}`}
                checked={readingIds.includes(p.id)}
                onCheckedChange={(v) =>
                  setReading((ids) =>
                    v === true
                      ? [...ids, p.id]
                      : ids.filter((id) => id !== p.id),
                  )
                }
                disabled={!readingIds.includes(p.id) && readingIds.length >= 12}
              />
              <FieldLabel htmlFor={`${prefix}-read-${i}`}>{p.title}</FieldLabel>
            </Field>
          ))}
          {!options.length && (
            <p className="empty-copy">연결할 게시 위키가 없습니다.</p>
          )}
          {readingIds.some((id) => !options.some((p) => p.id === id)) && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setReading((ids) =>
                  ids.filter((id) => options.some((p) => p.id === id)),
                )
              }
            >
              사용할 수 없는 추천 연결 지우기
            </Button>
          )}
        </FieldGroup>
      </FieldSet>
      <Button disabled={pending} type="submit">
        {pending ? "저장 중…" : "입문 안내 저장"}
      </Button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <output className="form-success">입문 안내를 저장했습니다.</output>
      )}
    </form>
  );
}
