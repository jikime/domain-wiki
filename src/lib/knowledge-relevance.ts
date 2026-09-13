// Adapted from llm_wiki graph-relevance.ts, Git 8bcf9b5.
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
// Pure relation scoring shared by retrieval and the graph Web Worker.
import type {
  GraphNode,
  GraphProof,
  GraphSignals,
  KnowledgeGraph,
} from "./knowledge-graph";

const affinity: Record<string, Record<string, number>> = {
  entity: { concept: 1.2, entity: 0.8, source: 1, synthesis: 1, query: 0.8 },
  concept: { entity: 1.2, concept: 0.8, source: 1, synthesis: 1.2, query: 1 },
  source: { entity: 1, concept: 1, source: 0.5, query: 0.8, synthesis: 1 },
  query: { concept: 1, entity: 0.8, synthesis: 1, source: 0.8, query: 0.5 },
  synthesis: { concept: 1.2, entity: 1, source: 1, query: 1, synthesis: 0.8 },
};
function neighbors(node: GraphNode) {
  return new Set([...node.outLinks, ...node.inLinks]);
}
export function graphRelevance(
  a: GraphNode,
  b: GraphNode,
  graph: KnowledgeGraph,
): GraphProof | null {
  if (a.id === b.id) return null;
  const directLink =
    (Number(a.outLinks.has(b.id)) + Number(b.outLinks.has(a.id))) * 3;
  const aSources = new Set(a.sources.map((s) => `${s.id}:${s.versionId}`));
  const sharedSources = new Set(
    b.sources
      .filter((s) => aSources.has(`${s.id}:${s.versionId}`))
      .map((s) => `${s.id}:${s.versionId}`),
  );
  const aNeighbors = neighbors(a);
  const common = [...neighbors(b)].filter((id) => aNeighbors.has(id));
  const commonNeighbor =
    common.reduce((sum, id) => {
      const node = graph.nodes.get(id);
      return (
        sum +
        (node
          ? 1 / Math.log(Math.max(node.outLinks.size + node.inLinks.size, 2))
          : 0)
      );
    }, 0) * 1.5;
  // Type alone describes similarity, never an evidence-bearing relationship.
  if (!directLink && !sharedSources.size && !commonNeighbor) return null;
  const signals: GraphSignals = {
    directLink,
    sourceOverlap: sharedSources.size * 4,
    commonNeighbor,
    typeAffinity: affinity[a.metadata.type]?.[b.metadata.type] ?? 0.5,
  };
  return {
    seedId: a.id,
    targetId: b.id,
    signals,
    score: Object.values(signals).reduce((sum, value) => sum + value, 0),
    pages: [a, b, ...common.flatMap((id) => graph.nodes.get(id) ?? [])].map(
      ({ id, versionId, title }) => ({ id, versionId, title }),
    ),
    sources: [
      ...new Map(
        [...a.sources, ...b.sources]
          .filter((s) => sharedSources.has(`${s.id}:${s.versionId}`))
          .map((s) => [s.chunkId, s]),
      ).values(),
    ],
  };
}
