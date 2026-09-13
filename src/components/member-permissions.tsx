"use client";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { includedRoles, type WorkRole } from "@/lib/permissions";

export function MemberPermissions({
  role = "reader",
  isAdmin = false,
  id = "new-member",
}: {
  role?: WorkRole;
  isAdmin?: boolean;
  id?: string;
}) {
  const [selected, setSelected] = useState(role);
  const [admin, setAdmin] = useState(isAdmin);
  const effective = includedRoles(selected, admin);
  return (
    <>
      <FieldSet aria-describedby={`${id}-role-help`}>
        <FieldLegend>업무 권한</FieldLegend>
        {includedRoles(selected).map((value) => (
          <Input key={value} type="hidden" name="roles" value={value} />
        ))}
        <Field orientation="horizontal">
          <Checkbox id={`${id}-reader`} checked disabled />
          <FieldLabel htmlFor={`${id}-reader`}>
            이용 · 게시 지식 읽기와 채팅
          </FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            id={`${id}-writer`}
            checked={effective.includes("writer")}
            disabled={admin || selected === "reviewer"}
            onCheckedChange={(checked) =>
              setSelected(checked ? "writer" : "reader")
            }
          />
          <FieldLabel htmlFor={`${id}-writer`}>
            작성 · 자료 등록과 위키 작성
          </FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            id={`${id}-reviewer`}
            checked={effective.includes("reviewer")}
            disabled={admin}
            onCheckedChange={(checked) =>
              setSelected(checked ? "reviewer" : "writer")
            }
          />
          <FieldLabel htmlFor={`${id}-reviewer`}>
            검토 · 원문과 변경안 검토·승인
          </FieldLabel>
        </Field>
        <FieldDescription id={`${id}-role-help`}>
          이용은 모든 직원의 기본 권한입니다. 검토 권한에는 작성 권한도
          포함됩니다.
        </FieldDescription>
      </FieldSet>
      <Field orientation="horizontal">
        <Checkbox
          id={`${id}-admin`}
          name="isAdmin"
          checked={admin}
          onCheckedChange={(checked) => setAdmin(checked === true)}
        />
        <FieldLabel htmlFor={`${id}-admin`}>관리자 권한 부여</FieldLabel>
      </Field>
      <p className="field-help">
        {admin
          ? "관리자는 이용·작성·검토와 작업공간 관리 권한을 모두 갖습니다."
          : "관리자로 지정하면 모든 업무 권한이 자동으로 적용됩니다."}
      </p>
    </>
  );
}
