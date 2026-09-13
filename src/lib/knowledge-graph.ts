// Adapted from llm_wiki src/lib/graph-relevance.ts, Git 8bcf9b5.
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
// See licenses/NOTICE.md. Every input node and source must already be scope-filtered.
import { graphRelevance } from "./knowledge-relevance";

export { graphRelevance } from "./knowledge-relevance";

import { wikiLinksFromMarkdown } from "./wiki-links";
import type { WikiMetadata } from "./wiki-metadata";
import { buildWikiReferenceIndex } from "./wiki-reference-index";

export const GRAPH_SETTINGS = {
  version: "scoped-relevance-v1",
  maxNodes: 1000,
  maxEdges: 20000,
  maxBodyChars: 8000000,
  maxSeeds: 8,
  maxCandidates: 256,
} as const;
export type GraphSource = {
  id: string;
  versionId: string;
  chunkId: string;
};
export type GraphPage = {
  id: string;
  versionId: string;
  domainId: string;
  projectId: string | null;
  title: string;
  body: string;
  metadata: WikiMetadata;
  sources: GraphSource[];
};
export type GraphNode = GraphPage & {
  outLinks: Set<string>;
  inLinks: Set<string>;
};
export type KnowledgeGraph = {
  nodes: Map<string, GraphNode>;
  bySource: Map<string, Set<string>>;
};
export type GraphSignals = {
  directLink: number;
  sourceOverlap: number;
  commonNeighbor: number;
  typeAffinity: number;
};
export type GraphProof = {
  seedId: string;
  targetId: string;
  score: number;
  signals: GraphSignals;
  pages: { id: string; versionId: string; title: string }[];
  sources: GraphSource[];
};
export function buildKnowledgeGraph(
  workspaceId: string,
  pages: GraphPage[],
): KnowledgeGraph {
  if (
    pages.length > GRAPH_SETTINGS.maxNodes ||
    pages.reduce((n, p) => n + p.body.length, 0) > GRAPH_SETTINGS.maxBodyChars
  )
    throw new Error("관계 검색 범위가 처리 한도를 넘었습니다.");
  const nodes = new Map<string, GraphNode>(
    pages.map((p) => [p.id, { ...p, outLinks: new Set(), inLinks: new Set() }]),
  );
  const bySource = new Map<string, Set<string>>();
  const referenceIndex = buildWikiReferenceIndex(pages);
  let edges = 0;
  for (const node of nodes.values()) {
    // Reconstruct legacy versions without mutating published bodies or trusting stale metadata links.
    // Canonical UUID links survive renames; ambiguous duplicate titles are never guessed.
    for (const id of wikiLinksFromMarkdown(
      node.body,
      workspaceId,
      referenceIndex,
    )) {
      const target = nodes.get(id);
      if (!target || id === node.id) continue;
      node.outLinks.add(id);
      target.inLinks.add(node.id);
      if (++edges > GRAPH_SETTINGS.maxEdges)
        throw new Error("관계 검색 연결 수가 처리 한도를 넘었습니다.");
    }
    for (const source of node.sources) {
      const key = `${source.id}:${source.versionId}`;
      const set = bySource.get(key) ?? new Set<string>();
      set.add(node.id);
      bySource.set(key, set);
    }
  }
  return { nodes, bySource };
}
function neighbors(node: GraphNode) {
  return new Set([...node.outLinks, ...node.inLinks]);
}
// Upstream search.rs uses one-hop graph neighbors, ranked by reciprocal seed
// rank. The four-signal model remains available for explicit graph exploration.
export function referenceGraphPages(
  graph: KnowledgeGraph,
  seeds: string[],
  limit: number,
) {
  const seedIds = new Set(seeds.slice(0, 20));
  const candidates = new Map<
    string,
    { node: GraphNode; proof: GraphProof; rank: number }
  >();
  for (const [rank, id] of [...seedIds].entries()) {
    const seed = graph.nodes.get(id);
    if (!seed) continue;
    for (const neighbor of neighbors(seed)) {
      if (seedIds.has(neighbor)) continue;
      const node = graph.nodes.get(neighbor);
      if (!node) continue;
      const proof = graphRelevance(seed, node, graph);
      if (!proof) continue;
      const previous = candidates.get(neighbor);
      candidates.set(neighbor, {
        node,
        proof: previous?.proof ?? proof,
        rank: (previous?.rank ?? 0) + 1 / (rank + 1),
      });
    }
  }
  return [...candidates.values()]
    .sort((a, b) => b.rank - a.rank || a.node.id.localeCompare(b.node.id))
    .slice(0, limit);
}
export function relatedGraphPages(
  graph: KnowledgeGraph,
  seeds: string[],
  limit = 4,
) {
  const seedIds = new Set(seeds.slice(0, GRAPH_SETTINGS.maxSeeds));
  const ranked = new Map<string, { node: GraphNode; proof: GraphProof }>();
  for (const seedId of seedIds) {
    const seed = graph.nodes.get(seedId);
    if (!seed) continue;
    const candidates = new Set<string>(neighbors(seed));
    for (const source of seed.sources)
      for (const id of graph.bySource.get(`${source.id}:${source.versionId}`) ??
        [])
        candidates.add(id);
    for (const id of neighbors(seed)) {
      const middle = graph.nodes.get(id);
      if (middle)
        for (const target of neighbors(middle)) candidates.add(target);
    }
    if (candidates.size > GRAPH_SETTINGS.maxCandidates)
      throw new Error("관계 후보가 처리 한도를 넘었습니다.");
    for (const id of candidates) {
      const node = graph.nodes.get(id);
      if (!node || seedIds.has(id)) continue;
      const proof = graphRelevance(seed, node, graph);
      if (proof && proof.score > (ranked.get(id)?.proof.score ?? 0))
        ranked.set(id, { node, proof });
    }
  }
  return [...ranked.values()]
    .sort(
      (a, b) =>
        b.proof.score - a.proof.score || a.node.id.localeCompare(b.node.id),
    )
    .slice(0, limit);
}
