"use client";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
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
import { Textarea } from "@/components/ui/textarea";

async function send(url: string, data: unknown, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "처리하지 못했습니다.");
  return result;
}
export function OfficialSiteForm({ workspaceId }: { workspaceId: string }) {
  const id = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form
      className="stack-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const d = new FormData(form);
        setBusy(true);
        setMessage("");
        try {
          await send(`/api/workspaces/${workspaceId}/official-sites`, {
            name: d.get("name"),
            url: d.get("url"),
            confirmed,
          });
          form.reset();
          setConfirmed(false);
          router.refresh();
          setMessage("허용 사이트를 등록했습니다.");
        } catch (error) {
          setMessage(
            error instanceof Error ? error.message : "연결을 확인해 주세요.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>기관·발행처 이름</FieldLabel>
        <Input
          id={`${id}-name`}
          name="name"
          required
          maxLength={100}
          disabled={busy}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-url`}>허용할 사이트·경로</FieldLabel>
        <Input
          id={`${id}-url`}
          name="url"
          type="url"
          required
          maxLength={2000}
          placeholder="https://기관주소/자료실/"
          disabled={busy}
        />
        <FieldDescription>
          이 경로와 하위 경로만 수집합니다. 첨부가 다른 도메인에 있으면 해당
          경로도 따로 등록하세요.
        </FieldDescription>
      </Field>
      <Field orientation="horizontal">
        <Checkbox
          id={`${id}-confirm`}
          checked={confirmed}
          onCheckedChange={(v) => setConfirmed(v === true)}
          disabled={busy}
        />
        <FieldContent>
          <FieldLabel htmlFor={`${id}-confirm`}>
            기관의 공식 주소와 허용 범위를 확인했습니다.
          </FieldLabel>
        </FieldContent>
      </Field>
      <Button type="submit" disabled={busy || !confirmed}>
        {busy ? "등록 중…" : "허용 사이트 등록"}
      </Button>
      <output aria-live="polite">{message}</output>
    </form>
  );
}
export function OfficialSiteSwitch({
  workspaceId,
  id,
  active,
}: {
  workspaceId: string;
  id: string;
  active: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await send(
              `/api/workspaces/${workspaceId}/official-sites/${id}`,
              { active: !active },
              "PATCH",
            );
            router.refresh();
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : "변경하지 못했습니다.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {active ? "수집 허용 중지" : "수집 다시 허용"}
      </Button>
      {message && <p role="alert">{message}</p>}
    </div>
  );
}
export function OfficialCollectForm({
  workspaceId,
  domains,
  projects,
  hasSites,
}: {
  workspaceId: string;
  domains: { id: string; name: string }[];
  projects: { id: string; name: string; domainId: string }[];
  hasSites: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [domain, setDomain] = useState(domains[0]?.id ?? "");
  const [project, setProject] = useState("none");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form
      className="stack-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        setBusy(true);
        setMessage("");
        try {
          const r = await send(`/api/workspaces/${workspaceId}/official`, {
            requestId: crypto.randomUUID(),
            domainId: domain,
            projectId: project === "none" ? null : project,
            title: d.get("title"),
            url: d.get("url"),
          });
          router.push(`/w/${workspaceId}/tools/official/${r.id}`);
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "원문을 수집하지 못했습니다.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor={`${id}-title`}>자료 이름</FieldLabel>
        <Input
          id={`${id}-title`}
          name="title"
          required
          maxLength={160}
          disabled={busy}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-url`}>확인할 원문 주소</FieldLabel>
        <Input
          id={`${id}-url`}
          name="url"
          type="url"
          required
          maxLength={2000}
          disabled={busy}
          placeholder="공식 자료 페이지 또는 첨부 파일 주소"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-domain`}>도메인</FieldLabel>
        <Select
          value={domain}
          onValueChange={(v) => {
            setDomain(v);
            setProject("none");
          }}
          disabled={busy}
        >
          <SelectTrigger id={`${id}-domain`} className="w-full">
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
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-project`}>프로젝트</FieldLabel>
        <Select value={project} onValueChange={setProject} disabled={busy}>
          <SelectTrigger id={`${id}-project`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">도메인 공통</SelectItem>
            {projects
              .filter((p) => p.domainId === domain)
              .map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>
      {!hasSites && (
        <p className="notice-box">
          관리자가 등록한 허용 사이트가 없습니다. 먼저 관리 화면에서 기관과
          경로를 등록해 주세요.
        </p>
      )}
      <Button type="submit" disabled={busy || !domain || !hasSites}>
        {busy ? "원문을 수집하고 있어요…" : "원문 수집·검토 대기 등록"}
      </Button>
      <output aria-live="polite">{message}</output>
    </form>
  );
}
export function CollectAttachment({
  workspaceId,
  url,
  title,
  domainId,
  projectId,
  enabled,
}: {
  workspaceId: string;
  url: string;
  title: string;
  domainId: string;
  projectId: string | null;
  enabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        disabled={busy || !enabled}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await send(`/api/workspaces/${workspaceId}/official`, {
              requestId: crypto.randomUUID(),
              url,
              title,
              domainId,
              projectId,
            });
            router.push(`/w/${workspaceId}/tools/official/${r.id}`);
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "첨부를 수집하지 못했습니다.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "수집 중…" : "이 첨부 수집"}
      </Button>
      {!enabled && (
        <p className="field-help">
          허용 사이트의 PDF·DOCX·PPTX 첨부만 수집할 수 있습니다.
        </p>
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  );
}
export function OfficialReviewForm({
  workspaceId,
  candidateId,
  current,
}: {
  workspaceId: string;
  candidateId: string;
  current: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form
      className="stack-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const action = (e.nativeEvent.submitter as HTMLButtonElement)?.value;
        const d = new FormData(e.currentTarget);
        setBusy(true);
        setMessage("");
        try {
          await send(
            `/api/workspaces/${workspaceId}/official/${candidateId}/action`,
            {
              action,
              confirmed,
              note: d.get("note"),
              publishedDate: d.get("publishedDate") || null,
              effectiveDate: d.get("effectiveDate") || null,
            },
          );
          router.refresh();
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "확인 결과를 저장하지 못했습니다.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor={`${id}-published`}>
          원문에서 확인한 발행일
        </FieldLabel>
        <Input
          id={`${id}-published`}
          name="publishedDate"
          type="date"
          disabled={busy}
        />
        <FieldDescription>
          원문에 없거나 확인하지 못했다면 비워 두고 검토 의견에 적어 주세요.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-effective`}>
          원문에서 확인한 시행일
        </FieldLabel>
        <Input
          id={`${id}-effective`}
          name="effectiveDate"
          type="date"
          disabled={busy}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-note`}>기관·날짜·첨부 확인 내용</FieldLabel>
        <Textarea
          id={`${id}-note`}
          name="note"
          required
          minLength={5}
          maxLength={2000}
          disabled={busy}
          placeholder="대조한 원문 위치, 첨부와 개정 여부, 확인하지 못한 날짜를 남겨 주세요."
        />
      </Field>
      <Field orientation="horizontal">
        <Checkbox
          id={`${id}-confirmed`}
          checked={confirmed}
          onCheckedChange={(v) => setConfirmed(v === true)}
          disabled={busy}
        />
        <FieldContent>
          <FieldLabel htmlFor={`${id}-confirmed`}>
            기관·원문·발행/시행 정보와 첨부를 직접 대조했습니다.
          </FieldLabel>
        </FieldContent>
      </Field>
      <div className="form-actions">
        <Button
          type="submit"
          value="verify"
          disabled={busy || !confirmed || !current}
        >
          공식 자료 확인 기록
        </Button>
        <Button type="submit" variant="outline" value="reject" disabled={busy}>
          후보 반려
        </Button>
      </div>
      {!current && (
        <p className="field-help">
          원본 공개 검토를 먼저 완료해야 확인 기록을 남길 수 있습니다.
        </p>
      )}
      <output aria-live="polite">{message}</output>
    </form>
  );
}
