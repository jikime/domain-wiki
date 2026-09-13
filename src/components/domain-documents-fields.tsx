"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getTemplate, templates } from "@/lib/reference/templates";

const names: Record<string, string> = {
  research: "연구",
  reading: "독서",
  personal: "개인 성장",
  business: "업무",
  general: "일반",
};
export function DomainDocumentsFields({
  id,
  purpose = "",
  schema = "",
  overview = "",
}: {
  id: string;
  purpose?: string;
  schema?: string;
  overview?: string;
}) {
  const [purposeText, setPurpose] = useState(purpose),
    [schemaText, setSchema] = useState(schema),
    [template, setTemplate] = useState("general");
  return (
    <details className="setting-detail">
      <summary>목적 문서·위키 구조·시나리오 양식</summary>
      <div className="form-stack">
        <Field>
          <FieldLabel htmlFor={`${id}-wiki-template`}>시나리오 양식</FieldLabel>
          <Select value={template} onValueChange={setTemplate}>
            <SelectTrigger id={`${id}-wiki-template`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {names[t.id] ?? t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const t = getTemplate(template);
              setPurpose(t.purpose);
              setSchema(t.schema);
            }}
          >
            선택한 양식으로 입력
          </Button>
          <FieldDescription>
            원본의 목적·스키마 양식을 불러옵니다. 내용을 편집한 뒤 도메인을
            저장하세요.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-purpose-markdown`}>
            목적 문서 (purpose.md)
          </FieldLabel>
          <Textarea
            id={`${id}-purpose-markdown`}
            name="purposeMarkdown"
            value={purposeText}
            onChange={(event) => setPurpose(event.target.value)}
            rows={12}
            maxLength={40000}
          />
          <FieldDescription>
            목표, 질문, 범위와 변화하는 판단을 마크다운으로 작성합니다. 문서
            분석·위키 생성·채팅·점검에 함께 사용합니다.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-schema-markdown`}>
            위키 구조 (schema.md)
          </FieldLabel>
          <Textarea
            id={`${id}-schema-markdown`}
            name="schemaMarkdown"
            value={schemaText}
            onChange={(event) => setSchema(event.target.value)}
            rows={16}
            maxLength={40000}
          />
          <FieldDescription>
            Page Types 표에 유형·폴더·용도를 정의하고, 문서 형식·상호 참조·모순
            처리 규칙을 작성할 수 있습니다.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-overview-markdown`}>
            프로젝트 개요 (wiki/overview.md)
          </FieldLabel>
          <Textarea
            id={`${id}-overview-markdown`}
            name="overviewMarkdown"
            defaultValue={overview}
            rows={10}
            maxLength={40000}
          />
          <FieldDescription>
            프로젝트의 큰 흐름을 직접 정리합니다. 목차와 최근 기록은 공개된
            위키·원문에 맞춰 자동으로 갱신됩니다.
          </FieldDescription>
        </Field>
      </div>
    </details>
  );
}
