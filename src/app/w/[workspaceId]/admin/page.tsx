import { headers } from "next/headers";
import Link from "next/link";
import { RecoveryIssuer } from "@/components/account-controls";
import { DomainDocumentsFields } from "@/components/domain-documents-fields";
import { DomainGuideEditor } from "@/components/domain-guide-editor";
import { MemberPermissions } from "@/components/member-permissions";
import { ModelConnection } from "@/components/model-connection";
import { SettingsForm } from "@/components/settings-form";
import { Checkbox } from "@/components/ui/checkbox";
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
import { type PurposeGuide, purposeFields } from "@/lib/domain-purpose";
import { roleLabels } from "@/lib/validation";
import { modelStatus } from "@/server/ai/client";
import type { Term } from "@/server/db/schema";
import { pageContext } from "@/server/page-access";
import { guideOptions } from "@/server/services/discovery";
import { listMembers, workspaceData } from "@/server/services/workspace";

function DomainFields({
  value,
  fieldId = "new-domain",
}: {
  fieldId?: string;
  value?: {
    name: string;
    purpose: string;
    purposeGuide?: PurposeGuide;
    purposeMarkdown?: string;
    schemaMarkdown?: string;
    overviewMarkdown?: string;
    autoIngest?: boolean;
    terms: Term[];
    recordTemplate: string;
  };
}) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${fieldId}-name`}>도메인 이름</FieldLabel>
        <Input
          id={`${fieldId}-name`}
          name="name"
          required
          maxLength={100}
          defaultValue={value?.name}
          placeholder="예: 교통관제 업무"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${fieldId}-purpose`}>도메인의 목적</FieldLabel>
        <Textarea
          id={`${fieldId}-purpose`}
          name="purpose"
          required
          maxLength={3000}
          defaultValue={value?.purpose}
          placeholder="어떤 업무를 이해하고 돕기 위한 공간인가요?"
          aria-describedby={`${fieldId}-purpose-help`}
        />
        <FieldDescription id={`${fieldId}-purpose-help`}>
          문서 분석과 위키 생성의 방향을 정합니다. 목적이나 가정 자체를 사실의
          근거로 사용하지 않습니다.
        </FieldDescription>
      </Field>
      <DomainDocumentsFields
        id={fieldId}
        purpose={value?.purposeMarkdown}
        schema={value?.schemaMarkdown}
        overview={value?.overviewMarkdown}
      />
      <details className="setting-detail">
        <summary>목적의 질문·범위·판단 기준 (선택)</summary>
        <p className="muted">
          현재 업무에 필요한 항목만 입력하세요. 기준을 바꾸면 이전 기준으로
          시작한 AI 작업은 새로 실행해야 합니다.
        </p>
        <div className="form-stack">
          {purposeFields.map((field) => (
            <Field key={field.key}>
              <FieldLabel htmlFor={`${fieldId}-${field.key}`}>
                {field.label}
              </FieldLabel>
              <Textarea
                id={`${fieldId}-${field.key}`}
                name={`purposeGuide.${field.key}`}
                maxLength={field.maxLength}
                defaultValue={value?.purposeGuide?.[field.key] ?? ""}
                aria-describedby={`${fieldId}-${field.key}-help`}
              />
              <FieldDescription id={`${fieldId}-${field.key}-help`}>
                {field.help}
              </FieldDescription>
            </Field>
          ))}
        </div>
      </details>
      <Field>
        <Field orientation="horizontal">
          <Checkbox
            id={`${fieldId}-auto-ingest`}
            name="autoIngest"
            defaultChecked={value?.autoIngest ?? false}
            aria-describedby={`${fieldId}-auto-ingest-help`}
          />
          <FieldLabel htmlFor={`${fieldId}-auto-ingest`}>
            공개 자료 자동 정리
          </FieldLabel>
        </Field>
        <FieldDescription id={`${fieldId}-auto-ingest-help`}>
          켜면 현재 공개된 자료와 이후 승인한 개정본을 분석해 위키 변경안을
          만듭니다. 게시하려면 직원의 검토·승인이 필요합니다. 끄면 진행 중인
          자동 정리를 중지하며 준비된 검토안은 유지합니다.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${fieldId}-terms`}>핵심 용어</FieldLabel>
        <Textarea
          id={`${fieldId}-terms`}
          name="terms"
          defaultValue={value?.terms
            .map(
              (term) =>
                `${term.term} | ${term.definition}${term.aliases?.length ? ` | ${term.aliases.join(", ")}` : ""}`,
            )
            .join("\n")}
          placeholder="ITS | 지능형 교통체계"
          aria-describedby={`${fieldId}-terms-help`}
        />
        <FieldDescription id={`${fieldId}-terms-help`}>
          한 줄에 ‘용어 | 설명 | 동의어, 약어’ 형식으로 입력하세요. 동의어는
          생략할 수 있으며, 검색할 때 같은 뜻으로 사용합니다. 최대 100개까지
          저장합니다.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${fieldId}-recordTemplate`}>
          실무 기록 기본 양식
        </FieldLabel>
        <Textarea
          id={`${fieldId}-recordTemplate`}
          name="recordTemplate"
          required
          maxLength={5000}
          defaultValue={
            value?.recordTemplate ?? "상황\n판단과 이유\n결과\n추가 확인할 내용"
          }
        />
      </Field>
    </>
  );
}
export default async function AdminPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const context = await pageContext(workspaceId, true);
  const requestHeaders = await headers();
  const [{ domains, projects }, members] = await Promise.all([
    workspaceData(requestHeaders, workspaceId),
    listMembers(requestHeaders, workspaceId),
  ]);
  const modelConfigured =
    modelStatus().chatConfigured || modelStatus().knowledgeConfigured;
  const guideChoices = new Map(
    await Promise.all(
      domains.map(
        async (d) =>
          [
            d.id,
            await guideOptions(requestHeaders, workspaceId, d.id),
          ] as const,
      ),
    ),
  );
  const base = `/api/workspaces/${workspaceId}`;
  return (
    <>
      <Link className="action-link" href={`/w/${workspaceId}/admin/sites`}>
        공식 자료 수집 허용 사이트 →
      </Link>

      <div className="page-heading">
        <div>
          <span className="eyebrow">작업공간 설정</span>
          <h1>관리</h1>
          <Link
            className="action-link"
            href={`/w/${workspaceId}/admin/operations`}
          >
            작업·사용량·보존 관리 →
          </Link>
          <p>
            업무 도메인과 프로젝트를 정리하고, 함께할 직원의 권한을 관리합니다.
          </p>
        </div>
        <span className="stage-badge">관리자</span>
      </div>
      <nav className="settings-tabs" aria-label="관리 항목">
        <a href="#domains">도메인</a>
        <a href="#projects">프로젝트</a>
        <a href="#members">직원 계정</a>
        <a href="#model">모델 연결</a>
      </nav>
      <section id="domains" className="panel settings-panel">
        <div className="section-heading">
          <h2>업무 도메인</h2>
          <span>{domains.length}개</span>
        </div>
        <p className="muted">
          목적과 용어는 홈에 표시됩니다. 실무 기록 양식은 이후 작성 기능의
          기준으로 저장합니다.
        </p>
        {domains.map((item) => (
          <details key={item.id} className="setting-detail">
            <summary>
              {item.name}
              <span>수정</span>
            </summary>
            <SettingsForm
              endpoint={`${base}/domains/${item.id}`}
              method="PATCH"
              kind="domain"
            >
              <DomainFields value={item} fieldId={item.id} />
            </SettingsForm>
            <details className="setting-detail">
              <summary>입문 순서·추천 읽기 편집</summary>
              <DomainGuideEditor
                workspaceId={workspaceId}
                domainId={item.id}
                guide={item.guide}
                options={guideChoices.get(item.id) ?? []}
              />
            </details>
          </details>
        ))}
        <details className="setting-detail">
          <summary>+ 새 도메인 만들기</summary>
          <SettingsForm
            endpoint={`${base}/domains`}
            kind="domain"
            submitLabel="도메인 생성"
            resetAfterSave
          >
            <DomainFields />
          </SettingsForm>
        </details>
      </section>
      <section id="projects" className="panel settings-panel">
        <div className="section-heading">
          <h2>업무 프로젝트</h2>
          <span>{projects.length}개</span>
        </div>
        <p className="muted">
          프로젝트를 도메인에 연결하면 공통 지식과 개별 사업을 구분할 수
          있습니다.
        </p>
        {[...projects, undefined].map((item) => (
          <details key={item?.id ?? "new"} className="setting-detail">
            <summary>
              {item?.name ?? "+ 새 프로젝트 만들기"}
              {item && <span>수정</span>}
            </summary>
            <SettingsForm
              endpoint={`${base}/projects${item ? `/${item.id}` : ""}`}
              method={item ? "PATCH" : "POST"}
              kind="project"
              submitLabel={item ? "저장" : "프로젝트 생성"}
              resetAfterSave={!item}
            >
              <Field>
                <FieldLabel htmlFor={`${item?.id ?? "new-project"}-domainId`}>
                  업무 도메인
                </FieldLabel>
                <Select
                  name="domainId"
                  required
                  defaultValue={item?.domainId ?? domains[0]?.id}
                >
                  <SelectTrigger
                    id={`${item?.id ?? "new-project"}-domainId`}
                    className="w-full"
                  >
                    <SelectValue placeholder="도메인을 먼저 만들어 주세요" />
                  </SelectTrigger>
                  <SelectContent>
                    {domains.map((domain) => (
                      <SelectItem key={domain.id} value={domain.id}>
                        {domain.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${item?.id ?? "new-project"}-name`}>
                  프로젝트 이름
                </FieldLabel>
                <Input
                  id={`${item?.id ?? "new-project"}-name`}
                  name="name"
                  required
                  maxLength={150}
                  defaultValue={item?.name}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${item?.id ?? "new-project"}-clientName`}>
                  발주처 이름
                </FieldLabel>
                <Input
                  id={`${item?.id ?? "new-project"}-clientName`}
                  name="clientName"
                  required
                  maxLength={150}
                  defaultValue={item?.clientName}
                />
              </Field>
              <Field>
                <FieldLabel
                  htmlFor={`${item?.id ?? "new-project"}-description`}
                >
                  프로젝트 설명
                </FieldLabel>
                <Textarea
                  id={`${item?.id ?? "new-project"}-description`}
                  name="description"
                  maxLength={3000}
                  defaultValue={item?.description}
                />
              </Field>
            </SettingsForm>
          </details>
        ))}
      </section>
      <section id="members" className="panel settings-panel">
        <div className="section-heading">
          <h2>직원 계정</h2>
          <span>{members.length}명</span>
        </div>
        <p className="muted">
          업무 권한을 선택할 수 있으며, 관리자는 모든 업무 권한을 갖습니다. 이용
          중지 시 기존 로그인도 해제됩니다.
        </p>
        {members.map((member) => (
          <details key={member.id} className="setting-detail">
            <summary>
              <span className="member-title">
                {member.name} <small>{member.email}</small>
              </span>
              <span>
                {member.isActive
                  ? member.isAdmin
                    ? "관리자"
                    : roleLabels[member.role]
                  : "이용 중지"}
              </span>
            </summary>
            <SettingsForm
              endpoint={`${base}/members/${member.id}`}
              method="PATCH"
              kind="member-update"
            >
              <MemberPermissions
                key={`${member.id}-${member.role}-${member.isAdmin}`}
                role={member.role}
                isAdmin={member.isAdmin}
                id={member.id}
              />
              <Field>
                <FieldLabel htmlFor={`${member.id}-active`}>
                  이용 상태
                </FieldLabel>
                <Select name="isActive" defaultValue={String(member.isActive)}>
                  <SelectTrigger id={`${member.id}-active`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">이용 가능</SelectItem>
                    <SelectItem value="false">이용 중지</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {member.id === context.user.id && (
                <p className="field-help">
                  본인의 이용 중지·관리자 권한 해제는 다른 관리자가 처리해야
                  합니다.
                </p>
              )}
            </SettingsForm>
            {member.isActive && (
              <RecoveryIssuer
                workspaceId={workspaceId}
                userId={member.id}
                userName={member.name}
              />
            )}
          </details>
        ))}
        <details className="setting-detail">
          <summary>+ 직원 계정 생성</summary>
          <SettingsForm
            endpoint={`${base}/members`}
            kind="member"
            submitLabel="계정 생성"
            resetAfterSave
          >
            <Field>
              <FieldLabel htmlFor="new-member-name">이름</FieldLabel>
              <Input
                id="new-member-name"
                name="name"
                required
                maxLength={100}
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-member-email">이메일</FieldLabel>
              <Input
                id="new-member-email"
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-member-password">
                초기 비밀번호
              </FieldLabel>
              <Input
                id="new-member-password"
                name="password"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                aria-describedby="new-member-password-help"
              />
              <FieldDescription id="new-member-password-help">
                12자 이상 입력해 주세요. 저장한 뒤에는 비밀번호를 다시 표시하지
                않습니다.
              </FieldDescription>
            </Field>
            <MemberPermissions />
          </SettingsForm>
        </details>
      </section>
      <section id="model" className="panel settings-panel">
        <div className="section-heading">
          <h2>회사 모델 연결</h2>
          <span className="stage-badge">
            {modelConfigured ? "설정 입력됨 · 연결 미검증" : "설정 대기"}
          </span>
        </div>
        <p className="muted">
          모델 연결 정보는 서버에서 관리합니다. 연결 점검에는 업무 자료가
          포함되지 않으며, API 키는 브라우저에 표시하지 않습니다.
        </p>
        <ModelConnection workspaceId={workspaceId} {...modelStatus()} />
      </section>
    </>
  );
}
