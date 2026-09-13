"use client";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import {
  clearLocalDrafts,
  confirmDraftNavigation,
} from "@/components/draft-controls";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const formId = useId();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      if (!response.ok) {
        setError(
          response.status === 429
            ? "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요."
            : "이메일과 비밀번호, 계정 이용 상태를 확인해 주세요.",
        );
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="form-stack">
      <FieldSet disabled={pending}>
        <Field>
          <FieldLabel htmlFor={`${formId}-email`}>이메일</FieldLabel>
          <Input
            id={`${formId}-email`}
            name="email"
            type="email"
            required
            autoComplete="username"
            placeholder="name@company.com"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${formId}-password`}>비밀번호</FieldLabel>
          <Input
            id={`${formId}-password`}
            name="password"
            type="password"
            required
            autoComplete="current-password"
            maxLength={128}
          />
        </Field>
      </FieldSet>
      {error && <FieldError>{error}</FieldError>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "확인하고 있어요…" : "로그인"}
      </Button>
    </form>
  );
}
export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const router = useRouter();
  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={async () => {
          if (!confirmDraftNavigation()) return;
          setPending(true);
          setError(false);
          try {
            const response = await fetch("/api/auth/sign-out", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            if (!response.ok) {
              setError(true);
              return;
            }
            clearLocalDrafts();
            router.replace("/login");
            router.refresh();
          } catch {
            setError(true);
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "로그아웃 중…" : "로그아웃"}
      </Button>
      {error && (
        <p role="alert">로그아웃에 실패했습니다. 다시 시도해 주세요.</p>
      )}
    </div>
  );
}
