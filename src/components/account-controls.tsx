"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { clearLocalDrafts } from "@/components/draft-controls";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function PasswordForm({ recoveryToken }: { recoveryToken?: string }) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  return (
    <form
      className="form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const newPassword = String(data.get("newPassword"));
        if (newPassword !== data.get("confirmation")) {
          setError("새 비밀번호를 두 칸에 동일하게 입력해 주세요.");
          return;
        }
        setPending(true);
        setError("");
        setDone(false);
        try {
          const response = await fetch(
            recoveryToken
              ? "/api/account/recovery"
              : "/api/auth/change-password",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                recoveryToken
                  ? { token: recoveryToken, newPassword }
                  : {
                      currentPassword: data.get("currentPassword"),
                      newPassword,
                      revokeOtherSessions: true,
                    },
              ),
            },
          );
          if (!response.ok) {
            const payload = await response.json();
            throw new Error(
              recoveryToken
                ? (payload.error ?? "복구 링크를 확인해 주세요.")
                : response.status === 401
                  ? "다시 로그인한 뒤 변경해 주세요."
                  : "현재 비밀번호와 새 비밀번호의 길이를 확인해 주세요.",
            );
          }
          form.reset();
          setDone(true);
          if (recoveryToken) clearLocalDrafts();
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "비밀번호를 변경하지 못했습니다.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <FieldSet disabled={pending || (done && !!recoveryToken)}>
        {!recoveryToken && (
          <Field>
            <FieldLabel htmlFor={`${id}-current`}>현재 비밀번호</FieldLabel>
            <Input
              id={`${id}-current`}
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor={`${id}-new`}>새 비밀번호</FieldLabel>
          <Input
            id={`${id}-new`}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            aria-describedby={`${id}-help`}
          />
          <FieldDescription id={`${id}-help`}>
            12~128자로 입력해 주세요.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-confirmation`}>
            새 비밀번호 확인
          </FieldLabel>
          <Input
            id={`${id}-confirmation`}
            name="confirmation"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </Field>
      </FieldSet>
      {error && <FieldError>{error}</FieldError>}
      {done && (
        <output className="notice-box">
          비밀번호를 변경했습니다.{" "}
          {recoveryToken
            ? "새 비밀번호로 로그인해 주세요."
            : "다른 기기의 로그인은 해제했습니다."}
        </output>
      )}
      {done && recoveryToken ? (
        <Link className="action-link" href="/login">
          로그인으로 이동 →
        </Link>
      ) : (
        <Button type="submit" disabled={pending}>
          {pending ? "변경 중…" : "비밀번호 변경"}
        </Button>
      )}
    </form>
  );
}
export function RecoveryEntry() {
  const [token, setToken] = useState<string | null>(null);
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setToken(new URLSearchParams(location.hash.slice(1)).get("token") ?? "");
    window.history.replaceState(null, "", location.pathname);
  }, []);
  if (token === null) return <p>복구 링크를 확인하고 있습니다.</p>;
  return token ? (
    <PasswordForm recoveryToken={token} />
  ) : (
    <p>
      관리자가 발급한 복구 링크를 다시 열어주세요.{" "}
      <Link href="/forgot-password">복구 안내 →</Link>
    </p>
  );
}
export function RecoveryIssuer({
  workspaceId,
  userId,
  userName,
}: {
  workspaceId: string;
  userId: string;
  userName: string;
}) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<{
    url: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  return (
    <form
      className="form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        setPending(true);
        setError("");
        setResult(null);
        setCopied(false);
        try {
          const response = await fetch(
            `/api/workspaces/${workspaceId}/password-recovery`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userId,
                adminPassword: new FormData(form).get("adminPassword"),
                confirmed,
              }),
            },
          );
          const data = await response.json();
          if (!response.ok) throw new Error(data.error);
          setResult(data);
          form.reset();
          setConfirmed(false);
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "복구 링크를 만들지 못했습니다.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <h3>비밀번호 분실 복구</h3>
      <p className="field-help">
        {userName} 직원의 본인 여부를 확인한 뒤 링크를 발급하세요. 링크는 15분
        동안 한 번 사용할 수 있고, 다시 발급하면 이전 링크는 만료됩니다.
      </p>
      <FieldSet disabled={pending}>
        <Field orientation="horizontal">
          <Checkbox
            id={`${id}-confirmed`}
            checked={confirmed}
            onCheckedChange={(value) => setConfirmed(value === true)}
          />
          <FieldLabel htmlFor={`${id}-confirmed`}>
            직원의 본인 여부를 확인했습니다
          </FieldLabel>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-password`}>
            관리자 본인 비밀번호
          </FieldLabel>
          <Input
            id={`${id}-password`}
            name="adminPassword"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </Field>
      </FieldSet>
      {error && <FieldError>{error}</FieldError>}
      <Button type="submit" variant="outline" disabled={pending || !confirmed}>
        {pending ? "발급 중…" : "일회용 복구 링크 발급"}
      </Button>
      {result && (
        <div className="notice-box">
          <Field>
            <FieldLabel htmlFor={`${id}-url`}>발급한 복구 링크</FieldLabel>
            <Input
              id={`${id}-url`}
              value={result.url}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <FieldDescription>
              이 화면에서만 확인할 수 있습니다. 본인이 확인된 직원에게 전달해
              주세요. 만료: {new Date(result.expiresAt).toLocaleString("ko-KR")}
            </FieldDescription>
          </Field>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(result.url);
                setCopied(true);
              } catch {
                setError("복구 링크를 선택해 직접 복사해 주세요.");
              }
            }}
          >
            {copied ? "복사했습니다" : "복구 링크 복사"}
          </Button>
        </div>
      )}
    </form>
  );
}
