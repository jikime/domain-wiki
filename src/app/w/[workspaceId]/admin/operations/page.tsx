import { headers } from "next/headers";
import Link from "next/link";
import {
  OperationsSettings,
  RetentionControls,
  RetirementControls,
} from "@/components/operations-controls";
import { pageContext } from "@/server/page-access";
import { operationsOverview } from "@/server/services/operations";
import { retirementOverview } from "@/server/services/retirement";
export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId: w } = await params;
  await pageContext(w, true);
  const d = await operationsOverview(await headers(), w);
  const retirement = await retirementOverview(await headers(), w);
  return (
    <>
      <Link className="back-link" href={`/w/${w}/admin`}>
        ← 관리
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">안정적인 팀 운영</span>
          <h1>작업·사용량·보존 관리</h1>
          <p>
            모델 요청과 문서 처리 상태를 확인하고 팀 운영 기준을 설정합니다.
          </p>
        </div>
      </div>
      <section className="panel">
        <h2 className="content-subtitle">운영 정책</h2>
        <OperationsSettings workspaceId={w} policy={d.policy} />
      </section>
      <section className="panel">
        <h2 className="content-subtitle">최근 30일 모델 사용량</h2>
        <p className="field-help">
          토큰 수를 받은 요청만 합산합니다. 추정 비용은 현재 설정한 단가
          기준이며, 제공자가 보고하지 않은 사용량은 포함하지 않습니다. 임베딩은
          아래에 따로 표시합니다. 대화 본문은 표시하지 않습니다.
        </p>
        {d.usage.map((r) => (
          <div className="decision-row" key={r.model ?? "unconfigured"}>
            <strong>{r.model ?? "모델 미설정"}</strong>
            <p>
              {r.requests}회 · 실패·중단 {r.failures}회 · 사용량 미확인{" "}
              {r.unknown}회
            </p>
            <p>
              입력 {r.input ?? "미확인"} · 출력 {r.output ?? "미확인"} 토큰 ·
              추정{" "}
              {r.estimate === null
                ? "단가·사용량 확인 필요"
                : `${r.estimate.toLocaleString("ko-KR", { maximumFractionDigits: 4 })}원`}
            </p>
          </div>
        ))}
        {!d.usage.length && (
          <p className="empty-copy">최근 모델 요청이 없습니다.</p>
        )}
      </section>
      <section className="panel">
        <h2 className="content-subtitle">최근 30일 임베딩 사용량</h2>
        <p className="field-help">
          문서 색인·질문 검색·연결 점검의 입력 토큰을 별도로 집계합니다. 임베딩
          단가가 설정되지 않아 비용은 미확인입니다.
        </p>
        {d.embedding.map((r) => (
          <div className="decision-row" key={`${r.model}:${r.purpose}`}>
            <strong>
              {r.model} ·{" "}
              {(
                {
                  index: "문서 색인",
                  query: "질문 검색",
                  connection: "연결 점검",
                } as Record<string, string>
              )[r.purpose] ?? r.purpose}
            </strong>
            <p>
              {r.requests}회 · 실패 {r.failures}회 · 입력 {r.input ?? "미확인"}{" "}
              토큰 · 사용량 미확인 {r.unknown}회
            </p>
          </div>
        ))}
        {!d.embedding.length && (
          <p className="empty-copy">기록된 임베딩 요청이 없습니다.</p>
        )}
      </section>
      <section className="panel">
        <h2 className="content-subtitle">문서 처리 상태</h2>
        <p className="field-help">
          자료 작성자나 검토 직원은 원문 화면에서 실패한 작업을 재시도할 수
          있습니다.
        </p>
        {d.jobs.map((j) => (
          <div className="decision-row" key={j.id}>
            <strong>
              {j.title} · 버전 {j.number}
            </strong>
            <p>
              {
                (
                  {
                    queued: "대기",
                    processing: "처리 중",
                    failed: "실패",
                    canceled: "취소",
                  } as Record<string, string>
                )[j.processing]
              }{" "}
              · {j.error_message ?? ""}
            </p>
            <Link href={`/w/${w}/sources/${j.source_id}?version=${j.id}`}>
              자료 확인 →
            </Link>
          </div>
        ))}
        {!d.jobs.length && (
          <p className="empty-copy">대기·실패 작업이 없습니다.</p>
        )}
      </section>
      <section className="panel">
        <h2 className="content-subtitle">최근 모델 오류</h2>
        {d.errors.map((e, i) => (
          <p className="decision-row" key={`${e.created_at}:${i}`}>
            {e.kind === "chat"
              ? "채팅"
              : e.kind === "quality"
                ? "품질 점검"
                : "지식 생성"}{" "}
            · {e.error_message} ·{" "}
            {new Date(e.created_at).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}
          </p>
        ))}
        {!d.errors.length && (
          <p className="empty-copy">기록된 오류가 없습니다.</p>
        )}
      </section>
      <section className="panel">
        <h2 className="content-subtitle">보존 기간이 지난 데이터</h2>
        <RetentionControls workspaceId={w} />
      </section>
      <section className="panel">
        <h2 className="content-subtitle">사용을 마친 원본 삭제</h2>
        <RetirementControls
          workspaceId={w}
          candidates={retirement.candidates}
        />
        <p className="field-help">파일 정리 대기 {retirement.pendingFiles}개</p>
        {retirement.history.map((r) => (
          <p className="decision-row" key={r.id}>
            {r.title} · 삭제{" "}
            {new Date(r.createdAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}
          </p>
        ))}
      </section>
      <section className="panel">
        <h2 className="content-subtitle">운영 변경 이력</h2>
        {d.events.map((e) => (
          <div className="decision-row" key={e.id}>
            <strong>
              {(
                {
                  policy: "운영 정책 변경",
                  "ingest-retry": "자료 정리 수동 재시도",
                  "password-recovery-issued": "계정 복구 링크 발급",
                  "password-recovery-completed": "계정 비밀번호 복구",
                  "password-recovery-denied": "복구 발급 비밀번호 확인 실패",
                } as Record<string, string>
              )[e.action] ?? "보존 데이터 삭제"}
            </strong>
            <p>
              {new Date(e.createdAt).toLocaleString("ko-KR", {
                timeZone: "Asia/Seoul",
              })}{" "}
              ·{" "}
              {Object.entries(e.counts)
                .map(
                  ([key, value]) =>
                    `${({ runs: "정리 작업", concurrency: "동시 한도", retentionDays: "보존 일수", conversations: "대화", generations: "생성 작업", links: "복구 링크", accounts: "계정" } as Record<string, string>)[key] ?? key} ${value}`,
                )
                .join(" · ")}
            </p>
          </div>
        ))}
      </section>
    </>
  );
}
