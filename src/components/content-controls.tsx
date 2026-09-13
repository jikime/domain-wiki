"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { sourceCategories } from "@/lib/content";
import { SOURCE_ACCEPT } from "@/lib/source-formats";

export function ProcessingRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [active, router]);
  return active ? (
    <output className="muted">
      처리 상태를 확인하고 있어요. 이 화면을 닫아도 등록한 작업은 유지됩니다.
    </output>
  ) : null;
}
export function ContentActions({
  endpoint,
  actions,
  noteLabel = "검토 의견 (반려 시 필수)",
}: {
  endpoint: string;
  actions: { value: string; label: string }[];
  noteLabel?: string;
}) {
  const router = useRouter();
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  if (!actions.length) return null;
  return (
    <form
      className="form-stack content-actions"
      onSubmit={async (event) => {
        event.preventDefault();
        const button = event.nativeEvent.submitter as HTMLButtonElement;
        const data = new FormData(event.currentTarget);
        setPending(true);
        setMessage("");
        setError(false);
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: button.value,
              note: data.get("note") ?? "",
            }),
          });
          const result = await response.json();
          if (!response.ok) {
            setError(true);
            setMessage(result.error);
            return;
          }
          setMessage("처리했습니다.");
          router.refresh();
        } catch {
          setError(true);
          setMessage("연결을 확인한 뒤 다시 시도해 주세요.");
        } finally {
          setPending(false);
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor={`${formId}-note`}>{noteLabel}</FieldLabel>
        <Textarea
          id={`${formId}-note`}
          name="note"
          maxLength={2000}
          rows={2}
          disabled={pending}
        />
      </Field>
      <div className="form-actions">
        {actions.map((action) => (
          <Button
            key={action.value}
            type="submit"
            value={action.value}
            disabled={pending}
            variant={
              action.value === "approve" || action.value === "submit"
                ? "default"
                : "outline"
            }
          >
            {pending ? "처리 중…" : action.label}
          </Button>
        ))}
      </div>
      {message && (
        <p
          role={error ? "alert" : "status"}
          className={error ? "form-error" : "form-success"}
        >
          {message}
        </p>
      )}
    </form>
  );
}
type DomainOption = { id: string; name: string };
type ProjectOption = { id: string; domainId: string; name: string };
export function UploadForm({
  workspaceId,
  domains,
  projects,
  existing,
  initialScope,
}: {
  initialScope?: { domainId: string; projectId: string | null };
  workspaceId: string;
  domains: DomainOption[];
  projects: ProjectOption[];
  existing?: {
    id: string;
    title: string;
    domainId: string;
    projectId: string | null;
    category: string;
  };
}) {
  const router = useRouter();
  const [domainId, setDomainId] = useState(
    existing?.domainId ?? initialScope?.domainId ?? domains[0]?.id ?? "",
  );
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        if (data.get("projectId") === "common") data.set("projectId", "");
        setPending(true);
        setError("");
        try {
          const response = await fetch(
            `/api/workspaces/${workspaceId}/sources${existing ? `/${existing.id}` : ""}`,
            { method: "POST", body: data },
          );
          const result = await response.json();
          if (!response.ok) {
            setError(result.error);
            return;
          }
          router.push(
            `/w/${workspaceId}/sources/${result.sourceId}?version=${result.versionId}${result.duplicate ? "&duplicate=1" : ""}`,
          );
          router.refresh();
        } catch {
          setError(
            "등록 결과를 확인하지 못했습니다. 같은 파일을 다시 보내도 중복 버전은 생성하지 않습니다.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <FieldSet disabled={pending} inert={pending} className="upload-fields">
        {existing ? (
          <>
            <Input type="hidden" name="title" value={existing.title} />
            <Input type="hidden" name="domainId" value={existing.domainId} />
            <Input
              type="hidden"
              name="projectId"
              value={existing.projectId ?? ""}
            />
            <Input type="hidden" name="category" value={existing.category} />
            <p className="muted">
              같은 자료에 새 원본 버전을 추가합니다. 기존 공개 버전은 새 버전의
              승인 전까지 유지됩니다.
            </p>
          </>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor={`${formId}-title`}>자료 제목</FieldLabel>
              <Input
                id={`${formId}-title`}
                name="title"
                required
                maxLength={160}
                placeholder="예: 관제 화면 점검 지침"
              />
            </Field>
            <div className="field-grid">
              <Field>
                <FieldLabel htmlFor={`${formId}-domain`}>
                  업무 도메인
                </FieldLabel>
                <Select
                  name="domainId"
                  required
                  value={domainId}
                  onValueChange={setDomainId}
                  disabled={pending}
                >
                  <SelectTrigger id={`${formId}-domain`} className="w-full">
                    <SelectValue placeholder="도메인을 선택해 주세요" />
                  </SelectTrigger>
                  <SelectContent>
                    {domains.map((item) => (
                      <SelectItem value={item.id} key={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${formId}-project`}>프로젝트</FieldLabel>
                <Select
                  name="projectId"
                  key={domainId}
                  defaultValue={
                    domainId === initialScope?.domainId
                      ? (initialScope.projectId ?? "common")
                      : "common"
                  }
                  disabled={pending}
                >
                  <SelectTrigger id={`${formId}-project`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="common">도메인 공통</SelectItem>
                    {projects
                      .filter((item) => item.domainId === domainId)
                      .map((item) => (
                        <SelectItem value={item.id} key={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor={`${formId}-category`}>자료 분류</FieldLabel>
              <Select
                name="category"
                defaultValue="guideline"
                disabled={pending}
              >
                <SelectTrigger id={`${formId}-category`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(sourceCategories).map(([value, label]) => (
                    <SelectItem value={value} key={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </>
        )}
        <Field className="file-drop">
          <FieldLabel htmlFor={`${formId}-file`}>원본 파일</FieldLabel>
          <Input
            id={`${formId}-file`}
            name="file"
            type="file"
            required
            accept={SOURCE_ACCEPT}
            aria-describedby={`${formId}-file-help`}
          />
          <FieldDescription id={`${formId}-file-help`}>
            텍스트·PDF·Word·슬라이드·스프레드시트·전자책·이미지, 최대 100MiB.
            스캔 PDF는 OCR 설정이 필요합니다. 추출 후 표와 위치를 원문과 확인해
            주세요.
          </FieldDescription>
        </Field>
      </FieldSet>
      <Button disabled={pending || !domainId} type="submit">
        {pending
          ? "자료를 등록하고 있어요…"
          : existing
            ? "새 버전 등록"
            : "자료 등록"}
      </Button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
}
