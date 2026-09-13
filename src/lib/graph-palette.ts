// llm_wiki graph-view.tsx palette. Additional local wiki types use its custom colors.
export const GRAPH_TYPE_COLORS: Record<string, string> = {
  entity: "#60a5fa",
  concept: "#c084fc",
  source: "#fb923c",
  query: "#4ade80",
  synthesis: "#f87171",
  procedure: "#22d3ee",
  case: "#fbbf24",
  other: "#94a3b8",
};
export const GRAPH_COMMUNITY_COLORS = [
  "#60a5fa",
  "#4ade80",
  "#fb923c",
  "#c084fc",
  "#f87171",
  "#2dd4bf",
  "#facc15",
  "#f472b6",
  "#a78bfa",
  "#38bdf8",
  "#34d399",
  "#fbbf24",
];
export function graphColor(type: string, community: number, mode: string) {
  return mode === "community"
    ? GRAPH_COMMUNITY_COLORS[community % GRAPH_COMMUNITY_COLORS.length]
    : (GRAPH_TYPE_COLORS[type] ?? "#94a3b8");
}
