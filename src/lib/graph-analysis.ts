import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { detectCommunities } from "./graph-communities";
import { graphInsights } from "./graph-insights";
import {
  GRAPH_VIEW_SETTINGS,
  type ViewAnalysis,
  type ViewData,
  type ViewEdge,
} from "./graph-view";
import type { GraphNode, KnowledgeGraph } from "./knowledge-graph";
import { graphRelevance } from "./knowledge-relevance";

export function analyzeGraph(data: ViewData, spacing = 1): ViewAnalysis {
  const start = performance.now();
  if (data.nodes.length > GRAPH_VIEW_SETTINGS.maxNodes)
    throw new Error("표시할 위키 수를 줄여 주세요.");
  const ids = new Set(data.nodes.map((n) => n.id));
  const nodes: GraphNode[] = [...data.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => ({
      ...n,
      body: "",
      metadata: { type: n.type, aliases: n.aliases, links: [] },
      outLinks: new Set(n.outLinks.filter((id) => ids.has(id))),
      inLinks: new Set<string>(),
    }));
  const graph: KnowledgeGraph = {
    nodes: new Map(nodes.map((n) => [n.id, n])),
    bySource: new Map(),
  };
  for (const n of nodes)
    for (const id of n.outLinks) graph.nodes.get(id)?.inLinks.add(n.id);
  const edges: ViewEdge[] = [],
    degrees = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const proof = graphRelevance(nodes[i], nodes[j], graph);
      if (!proof) continue;
      edges.push({
        source: proof.seedId,
        target: proof.targetId,
        weight: proof.score,
        signals: proof.signals,
        via: proof.pages.slice(2).map((p) => p.id),
        sources: proof.sources,
      });
      if (edges.length > GRAPH_VIEW_SETTINGS.maxEdges)
        throw new Error(
          "관련성이 밀집되어 있습니다. 표시 수·유형·검색 조건을 좁혀 주세요.",
        );
      degrees.set(proof.seedId, (degrees.get(proof.seedId) ?? 0) + 1);
      degrees.set(proof.targetId, (degrees.get(proof.targetId) ?? 0) + 1);
    }
  const { assignments, communities } = detectCommunities(
    nodes.map((n) => ({ id: n.id, degree: degrees.get(n.id) ?? 0 })),
    edges,
  );
  // llm_wiki GraphLoader / graph-layout-worker: ForceAtlas2, weighted edges,
  // gravity 1, strong gravity and Barnes-Hut beyond 50 nodes. Run in our Worker.
  const layout = new Graph({ type: "undirected" });
  for (const [i, n] of nodes.entries()) {
    const angle = (i * 2 * Math.PI) / Math.max(nodes.length, 1);
    layout.addNode(n.id, { x: Math.cos(angle), y: Math.sin(angle) });
  }
  for (const e of edges)
    layout.addEdge(e.source, e.target, { weight: e.weight });
  if (nodes.length > 1)
    forceAtlas2.assign(layout, {
      iterations: 140,
      settings: {
        ...forceAtlas2.inferSettings(layout),
        gravity: 1,
        scalingRatio: Math.max(0.6, Math.min(2.2, spacing)) * 2,
        strongGravityMode: true,
        barnesHutOptimize: nodes.length > 50,
      },
    });
  const analyzed = [...data.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => ({
      ...n,
      degree: degrees.get(n.id) ?? 0,
      community: assignments.get(n.id) ?? 0,
      x: layout.getNodeAttribute(n.id, "x") as number,
      y: layout.getNodeAttribute(n.id, "y") as number,
    }));
  return {
    nodes: analyzed,
    edges,
    communities,
    insights: graphInsights(analyzed, edges, communities),
    durationMs: performance.now() - start,
  };
}
