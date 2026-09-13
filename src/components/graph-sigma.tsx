"use client";
// Adapted from llm_wiki GraphLoader, GraphRenderSettings, EventHandler and ZoomControls.
import {
  SigmaContainer,
  useLoadGraph,
  useRegisterEvents,
  useSetSettings,
  useSigma,
} from "@react-sigma/core";
import "@react-sigma/core/lib/style.css";
import Graph from "graphology";
import { Maximize, Minus, Plus } from "lucide-react";
import { Component, type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { graphColor } from "@/lib/graph-palette";
import type { AnalyzedNode, ViewEdge } from "@/lib/graph-view";

type Props = {
  nodes: AnalyzedNode[];
  edges: ViewEdge[];
  colorMode: string;
  nodeScale: number;
  selected: string | null;
  highlighted: string[];
  onSelect: (id: string) => void;
  onContext: (id: string) => void;
};
class GraphBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="alert" className="graph-empty">
        그래프를 표시하지 못했습니다. WebGL 사용 설정을 확인하거나 상단의 위키
        목록을 열어 주세요.
      </p>
    ) : (
      this.props.children
    );
  }
}
function GraphController({
  nodes,
  edges,
  colorMode,
  nodeScale,
  selected,
  highlighted,
  onSelect,
  onContext,
}: Props) {
  const sigma = useSigma(),
    loadGraph = useLoadGraph(),
    register = useRegisterEvents(),
    settings = useSetSettings();
  const [hovered, setHovered] = useState<string | null>(null);
  const [camera, setCamera] = useState({ x: 0.5, y: 0.5, ratio: 1 });
  useEffect(() => {
    const graph = new Graph({ type: "undirected" });
    const maxDegree = Math.max(1, ...nodes.map((n) => n.degree));
    const density =
      nodes.length <= 150 ? 1 : Math.max(0.35, Math.sqrt(150 / nodes.length));
    for (const n of nodes)
      graph.addNode(n.id, {
        x: n.x,
        y: n.y,
        label: n.title,
        size: (8 + Math.sqrt(n.degree / maxDegree) * 20) * density,
        color: graphColor(n.type, n.community, "type"),
        nodeType: n.type,
        community: n.community,
      });
    for (const [i, e] of edges.entries())
      if (graph.hasNode(e.source) && graph.hasNode(e.target))
        graph.addEdgeWithKey(String(i), e.source, e.target, {
          size: e.signals.directLink ? 1.5 : 0.7,
          color: e.signals.directLink ? "#94a3b8" : "#d3dce6",
          weight: e.weight,
        });
    loadGraph(graph);
    sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
    const container = sigma.getContainer();
    container.dataset.ready = "true";
    container.dataset.nodeCount = String(nodes.length);
    return () => {
      delete container.dataset.ready;
    };
  }, [nodes, edges, loadGraph, sigma]);
  useEffect(() => {
    register({
      enterNode: ({ node }) => {
        setHovered(node);
        sigma.getContainer().style.cursor = "pointer";
      },
      leaveNode: () => {
        setHovered(null);
        sigma.getContainer().style.cursor = "default";
      },
      clickNode: ({ node }) => onSelect(node),
      rightClickNode: ({ node, event }) => {
        event.preventSigmaDefault();
        event.original.preventDefault();
        onContext(node);
      },
    });
  }, [register, onSelect, onContext, sigma]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadGraph replaces the imperative graph when nodes/edges change; reducers must bind to that replacement.
  useEffect(() => {
    const graph = sigma.getGraph(),
      active = hovered ?? selected;
    const focus = new Set(highlighted);
    if (active && graph.hasNode(active)) {
      focus.add(active);
      for (const n of graph.neighbors(active)) focus.add(n);
    }
    settings({
      nodeReducer: (id, attrs) => {
        const muted = focus.size > 0 && !focus.has(id);
        return {
          ...attrs,
          size: attrs.size * nodeScale,
          color: muted
            ? "#e2e8f0"
            : graphColor(attrs.nodeType, attrs.community, colorMode),
          label: muted ? "" : attrs.label,
          highlighted: id === active,
          forceLabel: focus.has(id),
          zIndex: focus.has(id) ? 1 : 0,
        };
      },
      edgeReducer: (id, attrs) => {
        const [a, b] = graph.extremities(id);
        return {
          ...attrs,
          hidden: focus.size > 0 && !(focus.has(a) && focus.has(b)),
          color: focus.size ? "#64748b" : attrs.color,
        };
      },
    });
  }, [
    sigma,
    settings,
    colorMode,
    nodeScale,
    hovered,
    selected,
    highlighted,
    nodes,
    edges,
  ]);
  useEffect(() => {
    const c = sigma.getCamera(),
      update = () => setCamera(c.getState());
    c.on("updated", update);
    update();
    return () => {
      c.removeListener("updated", update);
    };
  }, [sigma]);
  useEffect(() => {
    const container = sigma.getContainer();
    // Sigma listens to window resize; a side panel changes its container alone.
    const resize = new ResizeObserver(() => {
      if (!container.clientWidth || !container.clientHeight) return;
      sigma.resize();
      sigma.scheduleRefresh();
    });
    resize.observe(container);
    container.tabIndex = 0;
    container.setAttribute("role", "group");
    container.setAttribute(
      "aria-label",
      "위키 관계 그래프. 방향키로 이동할 수 있습니다.",
    );
    container.setAttribute(
      "aria-keyshortcuts",
      "ArrowLeft ArrowRight ArrowUp ArrowDown",
    );
    const move = (event: KeyboardEvent) => {
      const directions: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, 1],
        ArrowDown: [0, -1],
      };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      const c = sigma.getCamera(),
        position = c.getState();
      c.setState({
        x: position.x + direction[0] * 0.1 * position.ratio,
        y: position.y + direction[1] * 0.1 * position.ratio,
      });
    };
    container.addEventListener("keydown", move);
    return () => {
      resize.disconnect();
      container.removeEventListener("keydown", move);
    };
  }, [sigma]);
  const duration = () =>
    matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200;
  return (
    <fieldset
      className="graph-zoom"
      aria-label="그래프 확대와 이동"
      data-camera-ratio={camera.ratio}
      data-camera-x={camera.x}
      data-camera-y={camera.y}
    >
      <Button
        variant="outline"
        size="icon"
        aria-label="확대"
        title="확대"
        onClick={() => sigma.getCamera().animatedZoom({ duration: duration() })}
      >
        <Plus />
      </Button>
      <Button
        variant="outline"
        size="icon"
        aria-label="축소"
        title="축소"
        onClick={() =>
          sigma.getCamera().animatedUnzoom({ duration: duration() })
        }
      >
        <Minus />
      </Button>
      <Button
        variant="outline"
        size="icon"
        aria-label="전체 보기"
        title="전체 보기"
        onClick={() =>
          sigma.getCamera().animatedReset({ duration: duration() })
        }
      >
        <Maximize />
      </Button>
    </fieldset>
  );
}
export default function GraphSigma(props: Props) {
  return (
    <GraphBoundary>
      <SigmaContainer
        className="graph-sigma"
        style={{ height: "100%", width: "100%", background: "transparent" }}
        settings={{
          defaultNodeType: "circle",
          renderEdgeLabels: false,
          hideEdgesOnMove: true,
          hideLabelsOnMove: true,
          defaultEdgeColor: "#cbd5e1",
          defaultNodeColor: "#94a3b8",
          labelSize: 13,
          labelWeight: "bold",
          labelColor: { color: "#334155" },
          labelDensity: 0.4,
          labelRenderedSizeThreshold: 6,
          stagePadding: 40,
          zIndex: true,
        }}
      >
        <GraphController {...props} />
      </SigmaContainer>
    </GraphBoundary>
  );
}
