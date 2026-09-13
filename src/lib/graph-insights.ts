// Adapted from llm_wiki graph-insights.ts, Git 8bcf9b5.
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
import type {
  AnalyzedNode,
  Community,
  GraphInsight,
  ViewEdge,
} from "./graph-view";
import { wikiTypeLabels } from "./wiki-metadata";
export function graphInsights(
  nodes: AnalyzedNode[],
  edges: ViewEdge[],
  communities: Community[],
): GraphInsight[] {
  const gaps: GraphInsight[] = [],
    map = new Map(nodes.map((n) => [n.id, n]));
  const isolated = nodes.filter((n) => n.degree <= 1);
  if (isolated.length)
    gaps.push({
      key: "isolated",
      kind: "isolated",
      title: `연결이 적은 위키 ${isolated.length}개`,
      description:
        "현재 표시 범위에서 연결이 1개 이하입니다. 관련 문서나 근거를 더 연결할지 검토해 주세요. 독립 안내문일 수도 있습니다.",
      nodeIds: isolated.map((n) => n.id),
    });
  for (const c of communities)
    if (c.nodeIds.length >= 3 && c.cohesion < 0.15)
      gaps.push({
        key: `sparse:${c.id}`,
        kind: "sparse",
        title: `군집 ${c.id + 1}의 내부 연결 확인`,
        description: `${c.nodeIds.length}개 위키의 가능한 내부 연결 중 ${(c.cohesion * 100).toFixed(1)}%가 연결되어 있습니다. 설명이나 상호 참조를 보완할지 확인해 주세요.`,
        nodeIds: c.nodeIds,
      });
  const neighbors = new Map(nodes.map((n) => [n.id, new Set<number>()]));
  for (const e of edges) {
    const a = map.get(e.source),
      b = map.get(e.target);
    if (a && b) {
      neighbors.get(a.id)?.add(b.community);
      neighbors.get(b.id)?.add(a.community);
    }
  }
  for (const n of nodes
    .filter((n) => (neighbors.get(n.id)?.size ?? 0) >= 3)
    .sort(
      (a, b) =>
        (neighbors.get(b.id)?.size ?? 0) - (neighbors.get(a.id)?.size ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 3))
    gaps.push({
      key: `bridge:${n.id}`,
      kind: "bridge",
      title: `여러 군집과 연결: ${n.title}`,
      description: `${neighbors.get(n.id)?.size}개 군집에 연결됩니다. 함께 읽을 내용을 정리하거나 최신 근거를 확인할 수 있습니다.`,
      nodeIds: [n.id],
    });
  const maxDegree = Math.max(1, ...nodes.map((n) => n.degree));
  const distant = new Set([
    "source-concept",
    "concept-source",
    "source-synthesis",
    "synthesis-source",
    "query-entity",
    "entity-query",
  ]);
  const surprising = edges
    .flatMap((e) => {
      const a = map.get(e.source),
        b = map.get(e.target);
      if (!a || !b) return [];
      let score = 0;
      const reasons: string[] = [];
      if (a.community !== b.community) {
        score += 3;
        reasons.push("서로 다른 군집");
      }
      if (a.type !== b.type) {
        score += distant.has(`${a.type}-${b.type}`) ? 2 : 1;
        reasons.push(
          `${wikiTypeLabels[a.type] ?? a.type}·${wikiTypeLabels[b.type] ?? b.type}`,
        );
      }
      if (
        Math.min(a.degree, b.degree) <= 2 &&
        Math.max(a.degree, b.degree) >= maxDegree * 0.5
      ) {
        score += 2;
        reasons.push("연결이 적은 위키와 중심 위키");
      }
      if (e.weight > 0 && e.weight < 2) {
        score++;
        reasons.push("약한 관련성");
      }
      return score >= 3
        ? [
            {
              score,
              insight: {
                key: `connection:${a.id}:${b.id}`,
                kind: "connection" as const,
                title: `함께 살펴볼 연결: ${a.title} · ${b.title}`,
                description: reasons.join(" / "),
                nodeIds: [a.id, b.id],
              },
            },
          ]
        : [];
    })
    .sort(
      (a, b) => b.score - a.score || a.insight.key.localeCompare(b.insight.key),
    )
    .slice(0, 5);
  return [...gaps, ...surprising.map((s) => s.insight)];
}
