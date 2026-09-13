"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SearchForm({
  domains,
  projects,
  values,
  action,
  showKind = false,
  management,
}: {
  domains: { id: string; name: string }[];
  projects: { id: string; domainId: string; name: string }[];
  values: {
    q?: string;
    domainId?: string;
    projectId?: string;
    kind?: string;
    mode?: string;
    status?: string;
    mine?: string;
  };
  action?: string;
  showKind?: boolean;
  management?: "source" | "wiki";
}) {
  const formId = useId();
  const [domainId, setDomainId] = useState(values.domainId ?? "");
  const [projectId, setProjectId] = useState(values.projectId ?? "");
  const [kind, setKind] = useState(values.kind ?? "all");
  const [mode, setMode] = useState(
    management && values.mode === "manage" ? "manage" : "public",
  );
  const [status, setStatus] = useState(values.status || "all");
  const [mine, setMine] = useState(values.mine === "true");
  const statuses =
    management === "source"
      ? {
          pending: "공개 검토 대기",
          published: "공개",
          rejected: "반려",
          withdrawn: "철회",
          superseded: "개정됨",
        }
      : {
          draft: "작성 초안",
          submitted: "검토 대기",
          approved: "게시",
          rejected: "반려",
          withdrawn: "철회",
          superseded: "개정됨",
        };
  return (
    <form action={action}>
      <FieldGroup className="content-search">
        {management && (
          <Field>
            <FieldLabel htmlFor={`${formId}-mode`}>검색 범위</FieldLabel>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger id={`${formId}-mode`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">공개 지식 검색</SelectItem>
                <SelectItem value="manage">작성·검토 목록</SelectItem>
              </SelectContent>
            </Select>
            <Input type="hidden" name="mode" value={mode} />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor={`${formId}-q`}>검색어</FieldLabel>
          <Input
            id={`${formId}-q`}
            name="q"
            defaultValue={values.q}
            maxLength={100}
            placeholder={
              mode === "manage" && management === "source"
                ? "자료 제목에서 찾기"
                : "제목이나 본문에서 찾기"
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${formId}-domain`}>업무 도메인</FieldLabel>
          <Select
            value={domainId || "all"}
            onValueChange={(value) => {
              setDomainId(value === "all" ? "" : value);
              setProjectId("");
            }}
          >
            <SelectTrigger id={`${formId}-domain`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모든 도메인</SelectItem>
              {domains.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="hidden" name="domainId" value={domainId} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${formId}-project`}>프로젝트</FieldLabel>
          <Select
            value={projectId || "all"}
            disabled={!domainId}
            onValueChange={(value) =>
              setProjectId(value === "all" ? "" : value)
            }
          >
            <SelectTrigger id={`${formId}-project`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {domainId ? "전체 프로젝트" : "도메인 선택 후 지정"}
              </SelectItem>
              {projects
                .filter((item) => item.domainId === domainId)
                .map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Input
            type="hidden"
            name="projectId"
            value={projectId}
            disabled={!domainId}
          />
        </Field>
        {showKind && mode !== "manage" && (
          <Field>
            <FieldLabel htmlFor={`${formId}-kind`}>자료 유형</FieldLabel>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id={`${formId}-kind`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">원문과 위키</SelectItem>
                <SelectItem value="source">공개 원문</SelectItem>
                <SelectItem value="wiki">게시 위키</SelectItem>
              </SelectContent>
            </Select>
            <Input type="hidden" name="kind" value={kind} />
          </Field>
        )}
        {management && mode === "manage" && (
          <>
            <Field>
              <FieldLabel htmlFor={`${formId}-status`}>처리 상태</FieldLabel>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id={`${formId}-status`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">모든 상태</SelectItem>
                  {Object.entries(statuses).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {status !== "all" && (
                <Input type="hidden" name="status" value={status} />
              )}
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id={`${formId}-mine`}
                checked={mine}
                onCheckedChange={(v) => setMine(v === true)}
              />
              <FieldLabel htmlFor={`${formId}-mine`}>
                내가 작성한 항목만
              </FieldLabel>
              <Input type="hidden" name="mine" value={String(mine)} />
            </Field>
          </>
        )}
        <Button type="submit">검색</Button>
      </FieldGroup>
    </form>
  );
}
