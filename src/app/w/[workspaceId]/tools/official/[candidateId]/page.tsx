import { headers } from "next/headers";
import Link from "next/link";
import {
  ContentActions,
  ProcessingRefresh,
} from "@/components/content-controls";
import { Decisions } from "@/components/content-view";
import {
  CollectAttachment,
  OfficialReviewForm,
} from "@/components/official-controls";
import { officialStateLabels } from "@/lib/business";
import { officialUrl, withinSite } from "@/server/official/fetch";
import { contentPage, pageContext } from "@/server/page-access";
import { officialDetails, officialSites } from "@/server/services/official";
export default async function CandidatePage({
  params,
}: {
  params: Promise<{ workspaceId: string; candidateId: string }>;
}) {
  const { workspaceId, candidateId } = await params;
  const c = await pageContext(workspaceId);
  const d = await contentPage(async () =>
    officialDetails(await headers(), workspaceId, candidateId),
  );
  return (
    <CandidateBody
      workspaceId={workspaceId}
      candidateId={candidateId}
      context={c}
      initial={d}
    />
  );
}
async function CandidateBody({
  workspaceId,
  candidateId,
  context: c,
  initial: d,
}: {
  workspaceId: string;
  candidateId: string;
  context: Awaited<ReturnType<typeof pageContext>>;
  initial: Awaited<ReturnType<typeof officialDetails>>;
}) {
  const item = d.candidate;
  const sites = await officialSites(await headers(), workspaceId);
  const base = `/w/${workspaceId}`;
  const actions =
    c.role === "reviewer" &&
    item.authorId !== c.user.id &&
    d.publication === "pending" &&
    d.processing === "completed"
      ? [{ value: "approve", label: "원본 공개 승인" }]
      : [];
  return (
    <>
      <Link className="back-link" href={`${base}/tools/official`}>
        ← 자료 후보
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {d.site.name} · {officialStateLabels[item.state]}
          </span>
          <h1>{item.title}</h1>
        </div>
      </div>
      {item.errorMessage && (
        <p role="alert" className="notice-box">
          {item.errorMessage} 목록에서 새 요청으로 재시도할 수 있습니다.
        </p>
      )}
      {item.state === "fetching" && <ProcessingRefresh active />}
      <section className="panel">
        <h2 className="content-subtitle">확보한 원문과 메타정보</h2>
        <p className="break-words">
          <a href={item.finalUrl ?? item.url} target="_blank" rel="noreferrer">
            기관의 원문 주소 열기 ↗
          </a>
        </p>
        <p>
          수집 시점:{" "}
          {item.fetchedAt?.toLocaleString("ko-KR", {
            timeZone: "Asia/Seoul",
          }) ?? "미확보"}
        </p>
        <p>
          발행일: {item.publishedDate ?? "확인하지 못함"} · 시행일:{" "}
          {item.effectiveDate ?? "확인하지 못함"}
        </p>
        {item.publishedHint && (
          <p className="notice-box">
            자동으로 찾은 날짜 후보: {item.publishedHint} · 원문 대조 전
            정보입니다.
          </p>
        )}
        {item.sha256 && (
          <details>
            <summary>보관 원문의 해시</summary>
            <p className="break-all">SHA-256 {item.sha256}</p>
          </details>
        )}
        {d.sourceId && (
          <Link
            className="action-link"
            href={`${base}/sources/${d.sourceId}?version=${item.sourceVersionId}`}
          >
            보관한 원문·문단·처리 상태 확인 →
          </Link>
        )}
        {item.sourceVersionId && (
          <ContentActions
            endpoint={`/api/workspaces/${workspaceId}/source-versions/${item.sourceVersionId}/action`}
            actions={actions}
          />
        )}
        <ProcessingRefresh
          active={
            !!d.processing && ["queued", "processing"].includes(d.processing)
          }
        />
        {item.state === "verified" && !d.current && (
          <p className="notice-box">
            원문이 개정·철회되어 현재성 확인이 필요합니다.
          </p>
        )}
        {item.reviewNote && (
          <p className="whitespace-pre-wrap">검토 의견: {item.reviewNote}</p>
        )}
      </section>
      <section className="panel">
        <h2 className="content-subtitle">
          첨부 후보 · {item.attachments.length}개
        </h2>
        <p className="field-help">
          원문 HTML에서 찾은 첨부 주소를 최대 50개 표시합니다. 동적 첨부·숨겨진
          파일은 기관 화면에서 확인하세요.
        </p>
        {item.attachments.map((a) => {
          let allowed = false;
          try {
            allowed = sites.some((s) => withinSite(officialUrl(a.url), s));
          } catch {}
          return (
            <div className="decision-row" key={a.url}>
              <a href={a.url} target="_blank" rel="noreferrer">
                {a.title} ↗
              </a>
              <CollectAttachment
                workspaceId={workspaceId}
                domainId={item.domainId}
                projectId={item.projectId}
                url={a.url}
                title={a.title}
                enabled={a.supported && allowed}
              />
            </div>
          );
        })}
        {!item.attachments.length && (
          <p className="empty-copy">자동으로 찾은 첨부 주소가 없습니다.</p>
        )}
      </section>
      {c.role === "reviewer" &&
        item.authorId !== c.user.id &&
        item.state === "captured" && (
          <section className="panel">
            <h2 className="content-subtitle">원문 대조 기록</h2>
            <OfficialReviewForm
              workspaceId={workspaceId}
              candidateId={candidateId}
              current={d.current}
            />
          </section>
        )}
      <Decisions items={d.decisions} />
    </>
  );
}
