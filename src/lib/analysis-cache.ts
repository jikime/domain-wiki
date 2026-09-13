import { isDeepStrictEqual } from "node:util";
import { type AnalysisUnit, validateUnitAnalysis } from "./document-analysis";

// Locations and generated IDs change after a revision; text and interpretation
// context must match exactly. No whitespace or Unicode normalization is applied.
export function analysisUnitContent(unit: AnalysisUnit) {
  return {
    parts: unit.parts.map((part) => ({
      text: part.text,
      headingPath: part.headingPath,
      structure: part.structure,
      structureContext: part.structureContext,
    })),
    contextBefore: unit.contextBefore,
  };
}
export function rebindUnitAnalysis(
  value: unknown,
  previous: AnalysisUnit,
  current: AnalysisUnit,
) {
  if (
    !isDeepStrictEqual(
      analysisUnitContent(previous),
      analysisUnitContent(current),
    )
  )
    throw new Error(
      "분석 구간의 내용 또는 해석 문맥이 달라 재사용할 수 없습니다.",
    );
  const parsed = validateUnitAnalysis(value, previous);
  const mapping = new Map(
    previous.parts.map((p, index) => [p.id, current.parts[index]]),
  );
  const mapped = (id: string) => {
    const part = mapping.get(id);
    if (!part) throw new Error("재연결할 현재 문단이 없습니다.");
    return part;
  };
  const rebound = {
    ...parsed,
    parts: parsed.parts.map((p) => ({
      ...p,
      partId: mapped(p.partId).id,
    })),
    claims: parsed.claims.map((claim) => ({
      ...claim,
      evidence: claim.evidence.map((e) => ({
        ...e,
        partId: mapped(e.partId).id,
        chunkId: mapped(e.partId).chunkId,
      })),
    })),
  };
  return validateUnitAnalysis(rebound, current);
}
