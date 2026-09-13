"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

type Imported = {
  domainId: string;
  name: string;
  files: number;
  wikiPages: number;
  sources: number;
  message: string;
  warnings: string[];
};
export function ProjectArchiveControls({
  workspaceId,
  domains,
  initialDomainId,
  canWrite,
  isAdmin,
}: {
  workspaceId: string;
  domains: { id: string; name: string }[];
  initialDomainId?: string;
  canWrite: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [domainId, setDomain] = useState(
      initialDomainId || domains[0]?.id || "",
    ),
    [drafts, setDrafts] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Imported | null>(null);
  return (
    <div className="archive-controls">
      <section
        className="panel form-stack"
        aria-labelledby="archive-export-heading"
      >
        <h2 id="archive-export-heading">프로젝트 ZIP 내보내기</h2>
        <Field>
          <FieldLabel htmlFor="archive-domain">내보낼 도메인</FieldLabel>
          <Select
            value={domainId}
            onValueChange={setDomain}
            disabled={!domains.length}
          >
            <SelectTrigger id="archive-domain">
              <SelectValue placeholder="도메인 선택" />
            </SelectTrigger>
            <SelectContent>
              {domains.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            원문·위키·목적·스키마·개요·목차·기록을 원본 프로젝트의 폴더 구조로
            저장합니다.
          </FieldDescription>
        </Field>
        {canWrite && (
          <Field orientation="horizontal">
            <Checkbox
              id="archive-drafts"
              checked={drafts}
              onCheckedChange={(value) => setDrafts(value === true)}
            />
            <div>
              <FieldLabel htmlFor="archive-drafts">
                열람 가능한 변경안과 숨김 상태 파일 포함
              </FieldLabel>
              <FieldDescription>
                작성 직원은 본인 자료와 게시본, 검토 직원은 검토 권한이 있는
                자료를 포함합니다.
              </FieldDescription>
            </div>
          </Field>
        )}
        {domainId && (
          <a
            className="action-link"
            href={`/api/workspaces/${workspaceId}/archives?domainId=${domainId}&drafts=${drafts ? "1" : "0"}`}
          >
            ZIP 다운로드
          </a>
        )}
      </section>
      {isAdmin && (
        <form
          className="panel form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget,
              data = new FormData(form),
              file = data.get("file");
            if (!(file instanceof File) || !file.size) return;
            setBusy(true);
            setError("");
            setResult(null);
            try {
              const response = await fetch(
                `/api/workspaces/${workspaceId}/archives?name=${encodeURIComponent(String(data.get("name")))}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/zip" },
                  body: file,
                },
              );
              const saved = await response.json();
              if (!response.ok)
                throw new Error(
                  saved.error || "프로젝트를 가져오지 못했습니다.",
                );
              setResult(saved);
              form.reset();
              router.refresh();
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "가져오기에 실패했습니다.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2>프로젝트 ZIP 가져오기</h2>
          <FieldSet disabled={busy}>
            <Field>
              <FieldLabel htmlFor="archive-name">새 도메인 이름</FieldLabel>
              <Input id="archive-name" name="name" required maxLength={100} />
            </Field>
            <Field>
              <FieldLabel htmlFor="archive-file">프로젝트 ZIP 파일</FieldLabel>
              <Input
                id="archive-file"
                name="file"
                type="file"
                accept=".zip,application/zip"
                required
                aria-describedby="archive-file-help"
              />
              <FieldDescription id="archive-file-help">
                wiki/index.md가 있는 프로젝트를 새 도메인으로 가져옵니다. 원본과
                동일하게 압축 해제 후 4 GiB·10만 항목까지 보존합니다. 위키는
                초안, 원문은 공개 대기로 등록됩니다.
              </FieldDescription>
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? "ZIP 검사·저장 중…" : "새 도메인으로 가져오기"}
            </Button>
          </FieldSet>
          {error && (
            <p role="alert" className="form-message error">
              {error}
            </p>
          )}
          {result && (
            <div aria-live="polite" className="form-stack">
              <p>{result.message}</p>
              <p>
                파일 {result.files}개 · 위키 초안 {result.wikiPages}개 · 원문{" "}
                {result.sources}개
              </p>
              <Link
                href={`/w/${workspaceId}/wiki?domainId=${result.domainId}&mode=manage`}
              >
                {result.name}의 위키 확인 →
              </Link>
              {result.warnings.length > 0 && (
                <details>
                  <summary>확인할 내용 {result.warnings.length}건</summary>
                  <ul>
                    {result.warnings.map((warning, i) => (
                      <li key={`${i}-${warning}`}>{warning}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
