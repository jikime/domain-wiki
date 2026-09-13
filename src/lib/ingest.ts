export const ingestLabels: Record<string, string> = {
  waiting: "정리 대기",
  analysis: "문서 분석 중",
  generation: "위키 생성 중",
  review: "변경안 검토 대기",
  completed: "정리·게시 완료",
  failed: "정리 실패",
  canceled: "정리 중지",
  outdated: "현재 기준으로 재정리 필요",
};
export type IngestSummary = {
  id: string;
  sourceVersionId: string;
  state: string;
  origin: string;
  errorMessage: string | null;
  reusedAnalysis: boolean;
  reusedUnits: number;
  reusedPages: number;
  analysisTaskId: string | null;
  generationTaskId: string | null;
  manageable: boolean;
  current: boolean;
  createdAt: string;
  groups: {
    id: string;
    ordinal: number | null;
    state: "draft" | "submitted" | "approved" | "rejected";
  }[];
};
