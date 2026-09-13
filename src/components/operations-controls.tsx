"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ReviewTarget } from "@/server/services/review-desk";

async function send(url: string, body: unknown, method = "POST") {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "저장하지 못했습니다.");
  return data;
}
export function IssueReport({
  workspaceId,
  kind,
  targetId,
}: {
  workspaceId: string;
  kind: "source" | "wiki";
  targetId: string;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <details className="panel">
      <summary>오류 신고·수정 요청</summary>
      <form
        className="stack-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setBusy(true);
          try {
            await send(`/api/workspaces/${workspaceId}/issues`, {
              kind,
              targetId,
              note: new FormData(form).get("note"),
            });
            setMessage(
              "접수했습니다. 내 신고에서 처리 결과를 확인할 수 있습니다.",
            );
            form.reset();
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "접수하지 못했습니다.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field>
          <FieldLabel htmlFor={id}>확인이 필요한 내용</FieldLabel>
          <Textarea
            id={id}
            name="note"
            minLength={5}
            maxLength={2000}
            required
            disabled={busy}
            aria-describedby={`${id}-help`}
          />
          <FieldDescription id={`${id}-help`}>
            담당 검토 직원에게 전달할 오류 위치와 수정 이유를 적어 주세요.
          </FieldDescription>
        </Field>
        <Button disabled={busy} type="submit">
          신고 접수
        </Button>
        <output>{message}</output>
        <Link href={`/w/${workspaceId}/issues`}>내 신고와 답변 의견 →</Link>
      </form>
    </details>
  );
}
export function ReviewDeskControls({
  workspaceId,
  targets,
  reviewers,
  me,
  wikis,
  focused = false,
  initialFilter = "all",
}: {
  workspaceId: string;
  targets: ReviewTarget[];
  reviewers: { id: string; name: string }[];
  me: string;
  wikis: { id: string; title: string }[];
  focused?: boolean;
  initialFilter?: string;
}) {
  const id = useId();
  const [filter, setFilter] = useState(initialFilter);
  const router = useRouter();
  const active = targets.filter((t) => t.state !== "resolved");
  const visible = focused
    ? targets
    : targets.filter((t) =>
        filter === "resolved"
          ? t.state === "resolved"
          : t.state !== "resolved" &&
            (filter === "mine"
              ? t.assignee_id === me
              : filter === "unassigned"
                ? !t.assignee_name
                : true),
      );
  return (
    <>
      {focused && (
        <Link className="back-link" href={`/w/${workspaceId}/reviews/desk`}>
          전체 담당·오류 처리 목록 →
        </Link>
      )}
      <Field>
        <FieldLabel htmlFor={id}>검토 담당 범위</FieldLabel>
        <Select
          value={filter}
          disabled={focused}
          onValueChange={(value) => {
            setFilter(value);
            router.push(`/w/${workspaceId}/reviews/desk?filter=${value}`);
          }}
        >
          <SelectTrigger className="w-full" id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="mine">내 담당</SelectItem>
            <SelectItem value="resolved">처리 완료</SelectItem>
            <SelectItem value="unassigned">미지정·담당 확인 필요</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <p className="notice-box">
        대기 {active.length}건 · 7일 이상{" "}
        {active.filter((t) => t.age_days >= 7).length}건 · 미지정·담당 확인 필요{" "}
        {active.filter((t) => !t.assignee_name).length}건 (최대 500건)
      </p>
      {visible.map((t) => (
        <ReviewTask
          key={`${t.kind}:${t.id}`}
          workspaceId={workspaceId}
          target={t}
          reviewers={reviewers}
          wikis={wikis}
        />
      ))}
      {!visible.length && (
        <p className="empty-copy">이 범위에 대기 중인 검토가 없습니다.</p>
      )}
    </>
  );
}
function ReviewTask({
  workspaceId,
  target: t,
  reviewers,
  wikis,
}: {
  workspaceId: string;
  target: ReviewTarget;
  reviewers: { id: string; name: string }[];
  wikis: { id: string; title: string }[];
}) {
  const id = useId();
  const router = useRouter();
  const [assignee, setAssignee] = useState(
    t.assignee_name ? (t.assignee_id ?? "none") : "none",
  );
  const [action, setAction] = useState(
    t.state === "resolved" ? "reopen" : "assign",
  );
  const [fixedWiki, setFixedWiki] = useState("none");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const path = {
    source: "sources",
    rfp: "tools/rfp",
    official: "tools/official",
    wiki: "wiki",
    batch: "proposals",
    feedback: "",
    issue: "",
    quality: "",
  }[t.kind];
  const actionable = ["issue", "feedback", "quality"].includes(t.kind);
  return (
    <article className="panel" id={`review-${t.kind}-${t.id}`}>
      <div className="section-heading">
        <h2 className="content-subtitle">{t.title}</h2>
        <span className="state-label">{t.age_days}일 대기</span>
      </div>
      <p className="field-help">
        {t.kind === "quality"
          ? "품질 점검 후보"
          : t.kind === "issue"
            ? "자료 오류 신고"
            : t.kind === "feedback"
              ? "답변 의견"
              : "공개·게시 요청"}{" "}
        ·{" "}
        {t.state === "resolved"
          ? "처리 완료"
          : t.state === "deferred"
            ? "사유를 남기고 보류"
            : t.state === "triaged"
              ? "확인 중"
              : "대기"}{" "}
        · {t.assignee_name ?? "담당 확인 필요"}
      </p>
      {path && (
        <Link
          href={`/w/${workspaceId}/${path}/${t.parent_id}${t.kind !== "batch" ? `?version=${t.id}` : ""}`}
        >
          원문과 변경 내용 확인 →
        </Link>
      )}
      {t.kind === "quality" && (
        <Link
          href={`/w/${workspaceId}/quality?findingId=${t.id}#finding-${t.id}`}
        >
          비교 구절·원문·수정 변경안 확인 →
        </Link>
      )}
      {t.note && <p className="whitespace-pre-wrap">{t.note}</p>}
      <form
        className="stack-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const form = e.currentTarget;
          const f = new FormData(form);
          try {
            await send(`/api/workspaces/${workspaceId}/review-desk`, {
              kind: t.kind,
              targetId: t.id,
              action,
              assigneeId: assignee === "none" ? null : assignee,
              note: f.get("note") ?? "",
              fixedWikiId: fixedWiki === "none" ? null : fixedWiki,
            });
            setMessage("처리 내용을 저장했습니다.");
            router.refresh();
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "저장하지 못했습니다.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field-grid">
          <Field>
            <FieldLabel htmlFor={`${id}-action`}>처리</FieldLabel>
            <Select value={action} onValueChange={setAction} disabled={busy}>
              <SelectTrigger className="w-full" id={`${id}-action`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="assign">담당 지정</SelectItem>
                {t.state === "resolved" && (
                  <SelectItem value="reopen">다시 접수</SelectItem>
                )}
                {actionable && t.state !== "resolved" && (
                  <>
                    <SelectItem value="triage">확인 중으로 변경</SelectItem>
                    {t.kind === "quality" && (
                      <SelectItem value="defer">사유를 남기고 보류</SelectItem>
                    )}
                    <SelectItem value="resolve">처리 완료</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </Field>
          {action === "assign" && (
            <Field>
              <FieldLabel htmlFor={`${id}-assignee`}>담당 검토 직원</FieldLabel>
              <Select
                value={assignee}
                onValueChange={setAssignee}
                disabled={busy}
              >
                <SelectTrigger className="w-full" id={`${id}-assignee`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">미지정</SelectItem>
                  {reviewers.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
        <Field>
          <FieldLabel htmlFor={`${id}-note`}>
            처리 이유 {action === "assign" ? "(선택)" : ""}
          </FieldLabel>
          <Textarea
            id={`${id}-note`}
            name="note"
            required={action !== "assign"}
            maxLength={2000}
            disabled={busy}
          />
        </Field>
        {action === "resolve" && (
          <Field>
            <FieldLabel htmlFor={`${id}-wiki`}>
              수정 내용을 반영한 게시 위키 (선택)
            </FieldLabel>
            <Select
              value={fixedWiki}
              onValueChange={setFixedWiki}
              disabled={busy}
            >
              <SelectTrigger className="w-full" id={`${id}-wiki`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">별도 위키 연결 없음</SelectItem>
                {wikis.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              현재 게시된 위키만 연결할 수 있습니다.
            </FieldDescription>
          </Field>
        )}
        <Button type="submit" disabled={busy}>
          처리 저장
        </Button>
        <output>{message}</output>
      </form>
    </article>
  );
}
export function OperationsSettings({
  workspaceId,
  policy,
}: {
  workspaceId: string;
  policy: {
    concurrency: number;
    retentionDays: number;
    inputPrice: number | null;
    outputPrice: number | null;
  };
}) {
  const id = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form
      className="stack-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        try {
          await send(`/api/workspaces/${workspaceId}/operations`, {
            concurrency: Number(f.get("concurrency")),
            retentionDays: Number(f.get("retentionDays")),
            inputPrice:
              f.get("inputPrice") === "" ? null : Number(f.get("inputPrice")),
            outputPrice:
              f.get("outputPrice") === "" ? null : Number(f.get("outputPrice")),
            currency: "KRW",
          });
          setMessage("운영 정책을 저장했습니다.");
          router.refresh();
        } catch (e) {
          setMessage(e instanceof Error ? e.message : "저장하지 못했습니다.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field-grid">
        {(
          [
            {
              key: "concurrency",
              label: "채팅·지식 생성 동시 요청 한도",
              min: 1,
              max: 20,
            },
            {
              key: "retentionDays",
              label: "대화·생성 작업 보존 일수",
              min: 1,
              max: 3650,
            },
            {
              key: "inputPrice",
              label: "입력 100만 토큰 단가 (원·선택)",
              min: 0,
              max: 100000000,
            },
            {
              key: "outputPrice",
              label: "출력 100만 토큰 단가 (원·선택)",
              min: 0,
              max: 100000000,
            },
          ] as const
        ).map((f) => (
          <Field key={f.key}>
            <FieldLabel htmlFor={`${id}-${f.key}`}>{f.label}</FieldLabel>
            <Input
              id={`${id}-${f.key}`}
              type="number"
              name={f.key}
              min={f.min}
              max={f.max}
              required={!f.key.endsWith("Price")}
              defaultValue={policy[f.key] ?? ""}
              disabled={busy}
            />
          </Field>
        ))}
      </div>
      <p className="field-help">
        현재 단가를 공통 적용한 추정치이며, 실제 청구액은 모델 제공자의 내역을
        확인합니다. 보존 기간을 저장해도 데이터가 자동 삭제되지는 않습니다.
      </p>
      <Button type="submit" disabled={busy}>
        운영 정책 저장
      </Button>
      <output>{message}</output>
    </form>
  );
}
export function RetentionControls({ workspaceId }: { workspaceId: string }) {
  const id = useId();
  const router = useRouter();
  const [preview, setPreview] = useState<{
    cutoff: string;
    token: string;
    counts: { conversations: number; generations: number };
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  return (
    <div className="stack-form">
      <p>
        보존 기간이 지난 대화와 종료된 생성 작업을 최대 1,000건씩 정리합니다.
        진행 중인 답변과 미처리 답변 의견이 있는 대화는 제외합니다.
        위키·원본·승인 이력은 계속 보관합니다.
      </p>
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setPreview(
              await send(`/api/workspaces/${workspaceId}/retention`, {
                action: "preview",
              }),
            );
            setConfirmation("");
            setMessage("");
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "조회하지 못했습니다.");
          } finally {
            setBusy(false);
          }
        }}
      >
        삭제 대상 미리보기
      </Button>
      {preview && (
        <>
          <p className="notice-box">
            {new Date(preview.cutoff).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}{" "}
            이전 · 대화 {preview.counts.conversations}건 · 생성 작업{" "}
            {preview.counts.generations}건
          </p>
          <Field>
            <FieldLabel htmlFor={id}>삭제 확인 문구</FieldLabel>
            <Input
              id={id}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              disabled={busy}
              placeholder="보존 기간이 지난 대화 삭제"
            />
          </Field>
          <Button
            variant="destructive"
            disabled={
              busy ||
              confirmation !== "보존 기간이 지난 대화 삭제" ||
              !(preview.counts.conversations + preview.counts.generations)
            }
            onClick={async () => {
              setBusy(true);
              try {
                await send(`/api/workspaces/${workspaceId}/retention`, {
                  action: "delete",
                  cutoff: preview.cutoff,
                  token: preview.token,
                  confirmation,
                });
                setPreview(null);
                setConfirmation("");
                setMessage("확인한 대화와 생성 작업을 삭제했습니다.");
                router.refresh();
              } catch (e) {
                setMessage(
                  e instanceof Error ? e.message : "삭제하지 못했습니다.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            확인한 데이터 삭제
          </Button>
        </>
      )}
      <output>{message}</output>
    </div>
  );
}
export function DeleteConversation({
  workspaceId,
  conversationId,
  disabled,
}: {
  workspaceId: string;
  conversationId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled || busy}
        onClick={() => setOpen(!open)}
      >
        이 대화 삭제
      </Button>
      {open && (
        <div className="notice-box">
          <p>질문·답변·인용·답변 의견이 함께 삭제됩니다.</p>
          <Button
            size="sm"
            variant="destructive"
            disabled={disabled || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await send(
                  `/api/workspaces/${workspaceId}/conversations/${conversationId}`,
                  undefined,
                  "DELETE",
                );
                router.push(`/w/${workspaceId}/chat`);
                router.refresh();
              } catch (e) {
                setMessage(
                  e instanceof Error ? e.message : "삭제하지 못했습니다.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            대화 영구 삭제
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            취소
          </Button>
        </div>
      )}
      <output>{message}</output>
    </div>
  );
}

export function RetirementControls({
  workspaceId,
  candidates,
}: {
  workspaceId: string;
  candidates: { id: string; title: string }[];
}) {
  const id = useId();
  const router = useRouter();
  const [selected, setSelected] = useState("none");
  const [preview, setPreview] = useState<{
    sourceId: string;
    title: string;
    files: { filename: string; number: number; byteSize: number }[];
    token: string;
  } | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div className="stack-form">
      <p>
        공개를 종료하고 보존 기간이 지난 자료 중 다른 지식·대화·미처리 신고가
        참조하지 않는 원본을 정리합니다. 파일과 추출문은 삭제하고 제목·파일
        해시·승인·담당 이력은 보관합니다. 기존 백업에 남은 파일은 백업 보존
        정책을 따릅니다.
      </p>
      <Field>
        <FieldLabel htmlFor={`${id}-source`}>삭제할 보관 자료</FieldLabel>
        <Select
          value={selected}
          disabled={busy}
          onValueChange={(v) => {
            setSelected(v);
            setPreview(null);
            setConfirmation("");
          }}
        >
          <SelectTrigger className="w-full" id={`${id}-source`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">자료 선택</SelectItem>
            {candidates.map((c) => (
              <SelectItem value={c.id} key={c.id}>
                {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Button
        variant="outline"
        disabled={busy || selected === "none"}
        onClick={async () => {
          setBusy(true);
          try {
            setPreview(
              await send(`/api/workspaces/${workspaceId}/retirements`, {
                action: "preview",
                sourceId: selected,
              }),
            );
            setMessage("");
          } catch (e) {
            setMessage(
              e instanceof Error ? e.message : "대상을 확인하지 못했습니다.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        원본 삭제 미리보기
      </Button>
      {preview && (
        <>
          <p className="notice-box">
            {preview.title} · 원본 {preview.files.length}개
          </p>
          {preview.files.map((f) => (
            <p key={f.number}>
              버전 {f.number} · {f.filename} · {(f.byteSize / 1024).toFixed(1)}{" "}
              KiB
            </p>
          ))}
          <Field>
            <FieldLabel htmlFor={`${id}-confirm`}>
              위 자료 이름을 그대로 입력하세요
            </FieldLabel>
            <Input
              id={`${id}-confirm`}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Button
            variant="destructive"
            disabled={busy || confirmation !== preview.title}
            onClick={async () => {
              setBusy(true);
              try {
                await send(`/api/workspaces/${workspaceId}/retirements`, {
                  action: "delete",
                  sourceId: preview.sourceId,
                  token: preview.token,
                  confirmation,
                });
                setMessage(
                  "자료 접근을 종료했습니다. 작업자가 원본 파일을 정리합니다.",
                );
                setPreview(null);
                setSelected("none");
                setConfirmation("");
                router.refresh();
              } catch (e) {
                setMessage(
                  e instanceof Error ? e.message : "삭제하지 못했습니다.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            확인한 원본 영구 삭제
          </Button>
        </>
      )}
      <output>{message}</output>
    </div>
  );
}
