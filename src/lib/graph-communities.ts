// Adapted from llm_wiki wiki-graph-analysis.ts, Git 8bcf9b5.
// Copyright (C) 2024-2026 YongSu. SPDX-License-Identifier: GPL-3.0-only
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { Community, ViewEdge } from "./graph-view";

export function detectCommunities(
  nodes: { id: string; degree: number }[],
  edges: ViewEdge[],
) {
  if (!nodes.length)
    return {
      assignments: new Map<string, number>(),
      communities: [] as Community[],
    };
  const graph = new Graph({ type: "undirected" });
  for (const n of [...nodes].sort((a, b) => a.id.localeCompare(b.id)))
    graph.addNode(n.id);
  for (const e of [...edges].sort((a, b) =>
    `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`),
  ))
    if (!graph.hasEdge(e.source, e.target))
      graph.addEdge(e.source, e.target, { weight: e.weight });
  const raw = louvain(graph, {
    resolution: 1,
    randomWalk: false,
    rng: () => 0.5,
  });
  const groups = new Map<number, string[]>();
  for (const n of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const ids = groups.get(raw[n.id]) ?? [];
    ids.push(n.id);
    groups.set(raw[n.id], ids);
  }
  const ordered = [...groups.values()].sort(
    (a, b) => b.length - a.length || a[0].localeCompare(b[0]),
  );
  const assignments = new Map<string, number>();
  ordered.forEach((ids, id) => {
    for (const node of ids) assignments.set(node, id);
  });
  const counts = new Map<number, number>();
  for (const e of edges) {
    const c = assignments.get(e.source);
    if (c !== undefined && c === assignments.get(e.target))
      counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const degree = new Map(nodes.map((n) => [n.id, n.degree]));
  const communities = ordered.map((nodeIds, id) => ({
    id,
    nodeIds,
    cohesion:
      nodeIds.length > 1
        ? (counts.get(id) ?? 0) / ((nodeIds.length * (nodeIds.length - 1)) / 2)
        : 0,
    topIds: [...nodeIds]
      .sort(
        (a, b) =>
          (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b),
      )
      .slice(0, 5),
  }));
  return { assignments, communities };
}
