import Link from "next/link";
import { pageContext } from "@/server/page-access";
import { isWriter } from "@/server/services/content-access";
export default async function ToolsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const c = await pageContext(workspaceId);
  const base = `/w/${workspaceId}`;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">원문에서 업무로</span>
          <h1>업무 도구</h1>
          <p>
            공식 자료를 확인하고, 제안 요청의 의미와 근거를 함께 정리하세요.
          </p>
        </div>
      </div>
      <div className="tool-grid">
        {isWriter(c) && (
          <Link className="tool-card" href={`${base}/tools/research`}>
            <h2 className="content-subtitle">심층 조사</h2>
            <p>
              검색어를 보완하고 웹·내부 자료를 인용하는 위키 초안을 만듭니다.
            </p>
            <span className="action-link">조사 시작·진행 확인 →</span>
          </Link>
        )}
        <Link className="tool-card" href={`${base}/projects`}>
          <h2 className="content-subtitle">프로젝트 탐색</h2>
          <p>사업별 자료와 공통 지식, 관련 위키를 함께 살펴봅니다.</p>
          <span className="action-link">프로젝트 목록 →</span>
        </Link>
        <Link className="tool-card" href={`${base}/tools/rfp`}>
          <h2 className="content-subtitle">RFP 분석 보고서</h2>
          <p>명시 요구·관련 기준·사례·추론을 구분하고 확인 질문을 남깁니다.</p>
          <span className="action-link">보고서 살펴보기 →</span>
        </Link>
        {isWriter(c) && (
          <Link className="tool-card" href={`${base}/tools/official`}>
            <h2 className="content-subtitle">공식 자료 수집</h2>
            <p>허용한 기관의 원문과 첨부를 보관하고 검토합니다.</p>
            <span className="action-link">자료 후보 확인 →</span>
          </Link>
        )}
        {c.isAdmin && (
          <Link className="tool-card" href={`${base}/admin/sites`}>
            <h2 className="content-subtitle">수집 허용 사이트</h2>
            <p>기관과 수집할 주소 범위를 관리합니다.</p>
            <span className="action-link">허용 범위 관리 →</span>
          </Link>
        )}
      </div>
    </>
  );
}
