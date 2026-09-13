"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldSet } from "@/components/ui/field";
import { purposeFields } from "@/lib/domain-purpose";
export function SettingsForm({
  endpoint,
  kind,
  method = "POST",
  children,
  submitLabel = "저장",
  resetAfterSave = false,
}: {
  endpoint: string;
  kind: "domain" | "project" | "member" | "member-update";
  method?: "POST" | "PATCH";
  children: React.ReactNode;
  submitLabel?: string;
  resetAfterSave?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const busy = pending || refreshing;
  const [resetKey, setResetKey] = useState(0);
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setError(false);
    const form = event.currentTarget;
    const data = new FormData(form);
    let input: Record<string, unknown> = Object.fromEntries(data);
    if (kind === "domain") {
      for (const field of purposeFields)
        delete input[`purposeGuide.${field.key}`];
      input = {
        ...input,
        purposeGuide: Object.fromEntries(
          purposeFields.map((field) => [
            field.key,
            String(data.get(`purposeGuide.${field.key}`) ?? ""),
          ]),
        ),
        autoIngest: data.get("autoIngest") === "on",
        terms: String(data.get("terms") || "")
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => {
            const [term, definition = "", aliases = ""] = line.split("|");
            return {
              term: term.trim(),
              definition: definition.trim(),
              aliases: aliases
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            };
          }),
      };
    }
    if (kind === "member" || kind === "member-update")
      input = {
        ...input,
        roles: data.getAll("roles"),
        isAdmin: data.get("isAdmin") === "on",
      };
    if (kind === "member-update")
      input = { ...input, isActive: data.get("isActive") === "true" };
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(true);
        setMessage(result.error || "저장하지 못했습니다.");
        return;
      }
      if (resetAfterSave) setResetKey((current) => current + 1);
      setMessage(
        kind === "member"
          ? "계정을 생성했습니다. 입력한 비밀번호를 직원에게 안전하게 전달해 주세요."
          : "저장했습니다.",
      );
      startRefresh(() => router.refresh());
    } catch {
      setError(true);
      setMessage("서버에 연결하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="form-stack" aria-busy={busy}>
      <FieldSet disabled={busy} inert={busy} key={resetKey}>
        <FieldGroup>{children}</FieldGroup>
      </FieldSet>
      <div className="form-actions">
        <Button disabled={busy} type="submit">
          {busy ? "저장 중…" : submitLabel}
        </Button>
        {message && (
          <p
            className={error ? "form-error" : "form-success"}
            role={error ? "alert" : "status"}
          >
            {message}
          </p>
        )}
      </div>
    </form>
  );
}
