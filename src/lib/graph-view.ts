import type { GraphSignals, GraphSource } from "./knowledge-graph";
import type { WikiMetadata } from "./wiki-metadata";

export const GRAPH_VIEW_SETTINGS = {
  version: "graph-view-v2",
  maxNodes: 200,
  maxEdges: 4000,
  cacheEntries: 8,
} as const;
export type ViewNode = {
  id: string;
  versionId: string;
  domainId: string;
  projectId: string | null;
  title: string;
  type: WikiMetadata["type"];
  aliases: string[];
  sources: GraphSource[];
  outLinks: string[];
};
export type ViewData = {
  fingerprint: string;
  nodes: ViewNode[];
  matched: number;
  truncated: boolean;
  scope: {
    domainId: string;
    projectId: string | null;
    type: string;
    q: string;
    limit: number;
    focusId: string | null;
    hops: number;
  };
};
export type ViewEdge = {
  source: string;
  target: string;
  weight: number;
  signals: GraphSignals;
  via: string[];
  sources: GraphSource[];
};
export type AnalyzedNode = ViewNode & {
  degree: number;
  community: number;
  x: number;
  y: number;
};
export type Community = {
  id: number;
  nodeIds: string[];
  cohesion: number;
  topIds: string[];
};
export type GraphInsight = {
  key: string;
  kind: "isolated" | "sparse" | "bridge" | "connection";
  title: string;
  description: string;
  nodeIds: string[];
};
export type ViewAnalysis = {
  nodes: AnalyzedNode[];
  edges: ViewEdge[];
  communities: Community[];
  insights: GraphInsight[];
  durationMs: number;
};
