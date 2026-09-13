"use client";
import {
  Filter,
  Layers,
  Lightbulb,
  List,
  Network,
  RefreshCw,
  RotateCcw,
  Search,
  Tag,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { GraphWikiPreview } from "@/components/graph-wiki-preview";
import { IssueReport } from "@/components/operations-controls";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { graphColor } from "@/lib/graph-palette";
import {
  GRAPH_VIEW_SETTINGS,
  type ViewAnalysis,
  type ViewData,
} from "@/lib/graph-view";
import { wikiTypeLabels } from "@/lib/wiki-metadata";

const GraphSigma = dynamic(() => import("./graph-sigma"), {
  ssr: false,
  loading: () => <p className="graph-empty">그래프를 준비하고 있습니다.</p>,
});

export function GraphWorkspace({
  workspaceId: w,
  domains,
  projects,
  initial,
  canWrite,
}: {
  workspaceId: string;
  domains: { id: string; name: string }[];
  projects: { id: string; domainId: string; name: string }[];
  initial: { domainId?: string; projectId?: string; focusId?: string };
  canWrite: boolean;
}) {
  const id = useId(),
    base = `/w/${w}`;
  const [filters, setFilters] = useState({
    domainId: initial.domainId ?? domains[0]?.id ?? "",
    projectId: initial.projectId ?? "all",
    type: "all",
    q: "",
    limit: "100",
    focusId: initial.focusId ?? "",
    hops: "1",
  });
  const [search, setSearch] = useState("");
  const [data, setData] = useState<ViewData | null>(null),
    [analysis, setAnalysis] = useState<ViewAnalysis | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [cached, setCached] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<"node" | "insights" | "list" | null>(null);
  const [showFilters, setShowFilters] = useState(false),
    [showSearch, setShowSearch] = useState(false);
  const [colorMode, setColorMode] = useState("type"),
    [nodeScale, setNodeScale] = useState(1),
    [spacing, setSpacing] = useState(1);
  const [spacingDraft, setSpacingDraft] = useState(1);
  const [hideIsolated, setHideIsolated] = useState(false),
    [minLinks, setMinLinks] = useState(""),
    [maxLinks, setMaxLinks] = useState("");
  const [hiddenTypes, setHiddenTypes] = useState<string[]>([]),
    [hiddenNodes, setHiddenNodes] = useState<string[]>([]);
  const [legendCollapsed, setLegendCollapsed] = useState(false),
    [highlighted, setHighlighted] = useState<string[]>([]);
  const [nodeMenu, setNodeMenu] = useState<string | null>(null);
  const filterButton = useRef<HTMLButtonElement>(null),
    panelButton = useRef<HTMLButtonElement>(null);
  const cache = useRef(new Map<string, ViewAnalysis>()),
    cancel = useRef<() => void>(() => {});
  useEffect(() => {
    void refresh;
    let disposed = false,
      worker: Worker | null = null,
      timeout: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    function stop() {
      controller?.abort();
      worker?.terminate();
      worker = null;
      clearTimeout(timeout);
    }
    let stopped = false;
    cancel.current = () => {
      stopped = true;
      stop();
      setBusy(false);
      setData(null);
      setAnalysis(null);
      setError("탐색을 중지했습니다. 새로 확인을 누르면 다시 시작합니다.");
    };
    setData(null);
    setAnalysis(null);
    setSelected(null);
    setHighlighted([]);
    setHiddenNodes([]);
    setNodeMenu(null);
    async function load(quiet = false) {
      if (disposed || stopped || controller) return;
      controller = new AbortController();
      if (!quiet) setBusy(true);
      setError("");
      const query = new URLSearchParams({
        domainId: filters.domainId,
        type: filters.type,
        q: filters.q,
        limit: filters.limit,
        hops: filters.hops,
      });
      if (filters.projectId !== "all")
        query.set("projectId", filters.projectId);
      if (filters.focusId) query.set("focusId", filters.focusId);
      try {
        const response = await fetch(`/api/workspaces/${w}/graph?${query}`, {
            signal: controller.signal,
            cache: "no-store",
          }),
          value = await response.json();
        if (!response.ok)
          throw new Error(value.error ?? "그래프를 불러오지 못했습니다.");
        if (disposed || stopped) return;
        const next = value as ViewData,
          cacheKey = `${next.fingerprint}:${spacing}`,
          hit = cache.current.get(cacheKey);
        setData(next);
        setSelected((prev) =>
          next.nodes.some((n) => n.id === prev) ? prev : null,
        );
        if (hit) {
          setAnalysis(hit);
          setCached(true);
          setBusy(false);
          return;
        }
        setAnalysis(null);
        setBusy(true);
        setCached(false);
        worker = new Worker(
          new URL("./graph-analysis.worker.ts", import.meta.url),
          { type: "module" },
        );
        await new Promise<void>((resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  "계산 시간이 길어졌습니다. 표시 수나 범위를 줄여 주세요.",
                ),
              ),
            15000,
          );
          if (!worker)
            return reject(new Error("그래프 계산을 시작하지 못했습니다."));
          worker.onerror = () =>
            reject(
              new Error(
                "그래프 계산을 시작하지 못했습니다. 새로 확인해 주세요.",
              ),
            );
          worker.onmessage = (
            event: MessageEvent<{ result?: ViewAnalysis; error?: string }>,
          ) => {
            if (event.data.error) return reject(new Error(event.data.error));
            const result = event.data.result;
            if (!result)
              return reject(new Error("계산 결과를 확인하지 못했습니다."));
            if (!disposed && !stopped) {
              cache.current.set(cacheKey, result);
              while (cache.current.size > GRAPH_VIEW_SETTINGS.cacheEntries)
                cache.current.delete(
                  cache.current.keys().next().value as string,
                );
              setAnalysis(result);
            }
            resolve();
          };
          worker.postMessage({ data: next, spacing });
        });
      } catch (e) {
        if (!disposed && !stopped) {
          setError(
            e instanceof Error ? e.message : "그래프를 불러오지 못했습니다.",
          );
          setData(null);
          setAnalysis(null);
          setSelected(null);
          cache.current.clear();
        }
      } finally {
        stop();
        controller = null;
        if (!disposed && !stopped) setBusy(false);
      }
    }
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 15000);
    const focus = () => {
      void load(true);
    };
    window.addEventListener("focus", focus);
    return () => {
      disposed = true;
      stop();
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [filters, w, refresh, spacing]);
  const node = analysis?.nodes.find((n) => n.id === selected),
    nodeMap = new Map(analysis?.nodes.map((n) => [n.id, n]));
  const edges = node
    ? (analysis?.edges.filter(
        (e) => e.source === node.id || e.target === node.id,
      ) ?? [])
    : [];
  const scope = new URLSearchParams({ domainId: filters.domainId });
  if (filters.projectId !== "all") scope.set("projectId", filters.projectId);
  const visibleNodes = useMemo(
    () =>
      (analysis?.nodes ?? []).filter(
        (n) =>
          !hiddenTypes.includes(n.type) &&
          !hiddenNodes.includes(n.id) &&
          (!hideIsolated || n.degree > 0) &&
          (!minLinks || n.degree >= Number(minLinks)) &&
          (!maxLinks || n.degree <= Number(maxLinks)),
      ),
    [analysis, hiddenTypes, hiddenNodes, hideIsolated, minLinks, maxLinks],
  );
  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((n) => n.id));
    return (analysis?.edges ?? []).filter(
      (e) => ids.has(e.source) && ids.has(e.target),
    );
  }, [analysis, visibleNodes]);
  const select = useCallback((nodeId: string) => {
    setSelected(nodeId);
    setPanel("node");
    setShowFilters(false);
    setNodeMenu(null);
  }, []);
  const contextNode = useCallback((nodeId: string) => setNodeMenu(nodeId), []);
  const reveal = select;
  function explore(nodeId: string, hops: string) {
    setFilters((f) => ({ ...f, focusId: nodeId, hops }));
    setPanel(null);
  }
  function togglePanel(next: "list" | "insights") {
    setPanel((p) => (p === next ? null : next));
    setShowFilters(false);
    setHighlighted([]);
  }
  function resetDisplay() {
    setHiddenTypes([]);
    setHiddenNodes([]);
    setHideIsolated(false);
    setMinLinks("");
    setMaxLinks("");
    setNodeScale(1);
    setSpacing(1);
    setSpacingDraft(1);
  }
  function toggleType(type: string) {
    setHiddenTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }
  useEffect(() => {
    if (selected && !visibleNodes.some((n) => n.id === selected))
      setSelected(null);
  }, [selected, visibleNodes]);
  useEffect(() => {
    if (!panel && !showFilters && !showSearch && !nodeMenu) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector('[data-slot="select-content"]')
      )
        return;
      if (nodeMenu) setNodeMenu(null);
      else if (showFilters) {
        setShowFilters(false);
        filterButton.current?.focus();
      } else if (panel) {
        setPanel(null);
        setHighlighted([]);
        panelButton.current?.focus();
      } else setShowSearch(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [panel, showFilters, showSearch, nodeMenu]);
  return (
    <div className="graph-workspace">
      <header className="graph-header">
        <div className="graph-heading">
          <Network size={18} />
          <h1>지식 그래프</h1>
          <output data-cached={cached} className="graph-counts">
            {busy
              ? "불러오는 중…"
              : analysis && data
                ? `${data.matched}개 중 ${visibleNodes.length}개 표시 · 연결 ${visibleEdges.length}개`
                : ""}
          </output>
        </div>
        <div className="graph-actions">
          {showSearch && (
            <form
              className="graph-search"
              onSubmit={(e) => {
                e.preventDefault();
                setFilters((f) => ({ ...f, q: search, focusId: "" }));
              }}
            >
              <Input
                aria-label="위키 찾기"
                placeholder="제목·별칭 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={200}
              />
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                aria-label="검색 적용"
              >
                <Search />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="검색 닫기"
                onClick={() => {
                  setShowSearch(false);
                  setSearch("");
                  setFilters((f) => ({ ...f, q: "" }));
                }}
              >
                <X />
              </Button>
            </form>
          )}
          {!showSearch && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="위키 검색"
              title="위키 검색"
              onClick={() => setShowSearch(true)}
            >
              <Search />
            </Button>
          )}
          <Button
            ref={filterButton}
            variant="ghost"
            aria-expanded={showFilters}
            aria-controls={`${id}-filters`}
            onClick={() => {
              setShowFilters(!showFilters);
              setPanel(null);
            }}
          >
            <Filter />
            필터
          </Button>
          <Button
            variant="ghost"
            aria-label="유형"
            aria-pressed={colorMode === "type"}
            onClick={() => setColorMode("type")}
          >
            <Tag />
            <span className="graph-action-label">유형</span>
          </Button>
          <Button
            variant="ghost"
            aria-label="군집"
            aria-pressed={colorMode === "community"}
            onClick={() => setColorMode("community")}
          >
            <Layers />
            <span className="graph-action-label">군집</span>
          </Button>
          <Button
            ref={panelButton}
            variant="ghost"
            aria-label="인사이트"
            aria-expanded={panel === "insights"}
            onClick={() => togglePanel("insights")}
          >
            <Lightbulb />
            <span className="graph-action-label">인사이트</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="위키 목록"
            title="위키 목록"
            aria-expanded={panel === "list"}
            onClick={() => togglePanel("list")}
          >
            <List />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="새로 확인"
            title="새로 확인"
            onClick={() => setRefresh((n) => n + 1)}
          >
            <RefreshCw className={busy ? "animate-spin" : ""} />
          </Button>
          {busy && (
            <Button variant="ghost" onClick={() => cancel.current()}>
              탐색 중지
            </Button>
          )}
          {filters.focusId && (
            <Button
              variant="ghost"
              onClick={() => setFilters((f) => ({ ...f, focusId: "" }))}
            >
              주변 탐색 해제
            </Button>
          )}
        </div>
      </header>
      <div className="graph-body">
        <div className="graph-stage">
          {error ? (
            <p role="alert" className="graph-empty form-error">
              {error}
            </p>
          ) : !analysis ? (
            <p className="graph-empty">그래프를 준비하고 있습니다.</p>
          ) : !analysis.nodes.length ? (
            <p className="graph-empty">
              이 조건에 맞는 공개 위키가 없습니다. 검색과 범위를 조정해 주세요.
            </p>
          ) : (
            <>
              <GraphSigma
                nodes={visibleNodes}
                edges={visibleEdges}
                colorMode={colorMode}
                nodeScale={nodeScale}
                selected={selected}
                highlighted={highlighted}
                onSelect={select}
                onContext={contextNode}
              />
              {!visibleNodes.length && (
                <p className="graph-empty">
                  표시할 위키가 없습니다. 필터를 조정해 주세요.
                </p>
              )}
              {data?.truncated && (
                <span className="graph-limit">
                  최대 {data.scope.limit}개 표시 · 필터에서 범위를 좁힐 수
                  있습니다.
                </span>
              )}
              <section className="graph-legend" aria-label="그래프 범례">
                <Button
                  variant="ghost"
                  aria-expanded={!legendCollapsed}
                  onClick={() => setLegendCollapsed(!legendCollapsed)}
                >
                  {colorMode === "type" ? "위키 유형" : "지식 군집"}
                  <span>{legendCollapsed ? "▸" : "▾"}</span>
                </Button>
                {!legendCollapsed && (
                  <div className="graph-legend-items">
                    {colorMode === "type"
                      ? Object.entries(wikiTypeLabels)
                          .filter(([type]) =>
                            analysis.nodes.some((n) => n.type === type),
                          )
                          .map(([type, label]) => (
                            <Button
                              key={type}
                              variant="ghost"
                              aria-pressed={!hiddenTypes.includes(type)}
                              onClick={() => toggleType(type)}
                            >
                              <span
                                className="graph-dot"
                                style={{
                                  backgroundColor: graphColor(type, 0, "type"),
                                }}
                              />
                              {label}
                              <span>
                                {
                                  analysis.nodes.filter((n) => n.type === type)
                                    .length
                                }
                              </span>
                            </Button>
                          ))
                      : analysis.communities.map((c) => (
                          <Button
                            variant="ghost"
                            key={c.id}
                            onClick={() =>
                              setHighlighted((prev) =>
                                prev === c.nodeIds ? [] : c.nodeIds,
                              )
                            }
                          >
                            <span
                              className="graph-dot"
                              style={{
                                backgroundColor: graphColor(
                                  "",
                                  c.id,
                                  "community",
                                ),
                              }}
                            />
                            <span className="graph-legend-name">
                              {nodeMap.get(c.topIds[0])?.title ??
                                `군집 ${c.id + 1}`}
                            </span>
                            <span>{c.nodeIds.length}</span>
                          </Button>
                        ))}
                  </div>
                )}
              </section>
            </>
          )}
          {nodeMenu && (
            <div className="graph-node-menu">
              <p>{nodeMap.get(nodeMenu)?.title}</p>
              <Button
                variant="ghost"
                onClick={() => {
                  setHiddenNodes((prev) => [...prev, nodeMenu]);
                  setNodeMenu(null);
                }}
              >
                이 위키 숨기기
              </Button>
              <Button variant="ghost" onClick={() => setNodeMenu(null)}>
                닫기
              </Button>
            </div>
          )}
          {showFilters && (
            <form
              id={`${id}-filters`}
              className="graph-filters"
              aria-label="그래프 필터"
              onSubmit={(e) => {
                e.preventDefault();
                setShowFilters(false);
              }}
            >
              <div className="graph-panel-heading">
                <h2>그래프 필터</h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="필터 닫기"
                  onClick={() => setShowFilters(false)}
                >
                  <X />
                </Button>
              </div>
              <Field>
                <FieldLabel htmlFor={`${id}-domain`}>도메인</FieldLabel>
                <Select
                  value={filters.domainId}
                  onValueChange={(v) =>
                    setFilters((f) => ({
                      ...f,
                      domainId: v,
                      projectId: "all",
                      focusId: "",
                    }))
                  }
                >
                  <SelectTrigger id={`${id}-domain`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {domains.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-project`}>프로젝트</FieldLabel>
                <Select
                  value={filters.projectId}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, projectId: v, focusId: "" }))
                  }
                >
                  <SelectTrigger id={`${id}-project`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">도메인 전체</SelectItem>
                    {projects
                      .filter((p) => p.domainId === filters.domainId)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} + 공통
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-type`}>위키 유형</FieldLabel>
                <Select
                  value={filters.type}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, type: v, focusId: "" }))
                  }
                >
                  <SelectTrigger id={`${id}-type`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">모든 유형</SelectItem>
                    {Object.entries(wikiTypeLabels).map(([v, label]) => (
                      <SelectItem key={v} value={v}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-limit`}>최대 표시 수</FieldLabel>
                <Select
                  value={filters.limit}
                  onValueChange={(v) => setFilters((f) => ({ ...f, limit: v }))}
                >
                  <SelectTrigger id={`${id}-limit`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[50, 100, 200].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}개
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field orientation="horizontal">
                <Checkbox
                  id={`${id}-isolated`}
                  checked={hideIsolated}
                  onCheckedChange={(v) => setHideIsolated(v === true)}
                />
                <FieldLabel htmlFor={`${id}-isolated`}>
                  연결 없는 위키 숨기기
                </FieldLabel>
              </Field>
              <div className="graph-filter-pair">
                <Field>
                  <FieldLabel htmlFor={`${id}-min`}>최소 연결 수</FieldLabel>
                  <Input
                    id={`${id}-min`}
                    type="number"
                    min={0}
                    value={minLinks}
                    onChange={(e) => setMinLinks(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-max`}>최대 연결 수</FieldLabel>
                  <Input
                    id={`${id}-max`}
                    type="number"
                    min={0}
                    value={maxLinks}
                    onChange={(e) => setMaxLinks(e.target.value)}
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel>
                  노드 크기 · {Math.round(nodeScale * 100)}%
                </FieldLabel>
                <Slider
                  aria-label="노드 크기"
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  value={[nodeScale]}
                  onValueChange={(v) => setNodeScale(v[0])}
                />
              </Field>
              <Field>
                <FieldLabel>
                  그래프 간격 · {Math.round(spacingDraft * 100)}%
                </FieldLabel>
                <Slider
                  aria-label="그래프 간격"
                  min={0.6}
                  max={2.2}
                  step={0.05}
                  value={[spacingDraft]}
                  onValueChange={(v) => setSpacingDraft(v[0])}
                  onValueCommit={(v) => setSpacing(v[0])}
                />
              </Field>
              <div className="graph-filter-types">
                {Object.entries(wikiTypeLabels)
                  .filter(([type]) =>
                    analysis?.nodes.some((n) => n.type === type),
                  )
                  .map(([type, label]) => (
                    <Field key={type} orientation="horizontal">
                      <Checkbox
                        id={`${id}-${type}`}
                        checked={!hiddenTypes.includes(type)}
                        onCheckedChange={() => toggleType(type)}
                      />
                      <FieldLabel htmlFor={`${id}-${type}`}>{label}</FieldLabel>
                    </Field>
                  ))}
              </div>
              {!!hiddenNodes.length && (
                <div>
                  <h3>숨긴 위키</h3>
                  {hiddenNodes.map((n) => (
                    <Button
                      key={n}
                      variant="link"
                      onClick={() =>
                        setHiddenNodes((p) => p.filter((v) => v !== n))
                      }
                    >
                      {nodeMap.get(n)?.title} 다시 표시
                    </Button>
                  ))}
                </div>
              )}
              <Button type="button" variant="outline" onClick={resetDisplay}>
                <RotateCcw />
                표시 설정 초기화
              </Button>
              <Button type="submit">필터 닫고 보기</Button>
            </form>
          )}
        </div>
        {panel && analysis && (
          <aside
            className="graph-side-panel"
            aria-label={
              panel === "node"
                ? "선택한 위키 상세"
                : panel === "list"
                  ? "위키 목록 패널"
                  : "그래프 인사이트"
            }
          >
            <div className="graph-panel-heading">
              <h2>
                {panel === "node"
                  ? (node?.title ?? "위키 선택")
                  : panel === "list"
                    ? "위키 목록"
                    : "인사이트"}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="패널 닫기"
                onClick={() => {
                  setPanel(null);
                  setHighlighted([]);
                }}
              >
                <X />
              </Button>
            </div>
            <div className="graph-panel-content">
              {panel === "node" && node && (
                <div id={`${id}-detail`} className="graph-detail">
                  <p>
                    {wikiTypeLabels[node.type] ?? node.type} · 군집{" "}
                    {node.community + 1}
                  </p>
                  <Link
                    href={`${base}/wiki/${node.id}?version=${node.versionId}`}
                  >
                    선택한 게시 본문 →
                  </Link>
                  <GraphWikiPreview
                    key={`${node.id}:${node.versionId}`}
                    workspaceId={w}
                    pageId={node.id}
                    versionId={node.versionId}
                    canWrite={canWrite}
                  />
                  <h3>원문 근거</h3>
                  {node.sources.length ? (
                    node.sources.map((s, i) => (
                      <Link
                        key={s.chunkId}
                        href={`${base}/sources/${s.id}?version=${s.versionId}#chunk-${s.chunkId}`}
                      >
                        원문 근거 {i + 1} →
                      </Link>
                    ))
                  ) : (
                    <p className="field-help">연결된 원문 구간이 없습니다.</p>
                  )}
                  <h3>함께 읽을 관계 {edges.length}개</h3>
                  {edges.map((e) => {
                    const target = nodeMap.get(
                      e.source === node.id ? e.target : e.source,
                    );
                    return target ? (
                      <div key={target.id} className="graph-relation">
                        <Button
                          variant="link"
                          onClick={() => select(target.id)}
                        >
                          {target.title}
                        </Button>
                        <p>
                          {e.signals.directLink
                            ? "본문에 저장한 링크"
                            : "계산한 관련성"}{" "}
                          · 관련성 {e.weight.toFixed(2)}
                        </p>
                        <details>
                          <summary>관계 점수</summary>
                          <p className="field-help">
                            직접 링크 {e.signals.directLink.toFixed(2)} · 공통
                            원문 {e.signals.sourceOverlap.toFixed(2)} · 공통
                            이웃 {e.signals.commonNeighbor.toFixed(2)} · 유형{" "}
                            {e.signals.typeAffinity.toFixed(2)}
                          </p>
                        </details>
                        {e.via.map((mid) => (
                          <Button
                            variant="link"
                            key={mid}
                            onClick={() => select(mid)}
                          >
                            중간 위키: {nodeMap.get(mid)?.title}
                          </Button>
                        ))}
                      </div>
                    ) : null;
                  })}
                  <div className="graph-toolbar">
                    <Button
                      variant="outline"
                      onClick={() => explore(node.id, "1")}
                    >
                      1단계 주변 탐색
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => explore(node.id, "2")}
                    >
                      2단계 주변 탐색
                    </Button>
                  </div>
                  <Link href={`${base}/chat?${scope}&wikiId=${node.id}`}>
                    이 위키로 질문하기 →
                  </Link>
                  {canWrite && (
                    <Link href={`${base}/sources?${scope}#register-source`}>
                      이 범위에 자료 등록 →
                    </Link>
                  )}
                  <IssueReport
                    key={node.id}
                    workspaceId={w}
                    kind="wiki"
                    targetId={node.id}
                  />
                </div>
              )}
              {panel === "list" && (
                <fieldset className="graph-node-list" aria-label="위키 목록">
                  {visibleNodes.map((n) => (
                    <Button
                      variant="ghost"
                      key={n.id}
                      onClick={() => select(n.id)}
                    >
                      <span
                        className="graph-dot"
                        style={{
                          backgroundColor: graphColor(
                            n.type,
                            n.community,
                            colorMode,
                          ),
                        }}
                      />
                      <span>
                        {n.title}
                        <small>
                          {wikiTypeLabels[n.type] ?? n.type} · 연결 {n.degree}개
                        </small>
                      </span>
                    </Button>
                  ))}
                </fieldset>
              )}
              {panel === "insights" && (
                <>
                  <p className="field-help">
                    현재 표시 범위의 관계를 바탕으로 찾은 탐색 단서입니다.
                  </p>
                  {analysis.insights.map((insight) => (
                    <article className="graph-insight" key={insight.key}>
                      <Button
                        variant="ghost"
                        onClick={() => setHighlighted(insight.nodeIds)}
                      >
                        {insight.title}
                      </Button>
                      <p>{insight.description}</p>
                      <details>
                        <summary>관련 위키 {insight.nodeIds.length}개</summary>
                        {insight.nodeIds.map((n) => (
                          <Button
                            key={n}
                            variant="link"
                            onClick={() => reveal(n)}
                          >
                            {nodeMap.get(n)?.title}
                          </Button>
                        ))}
                      </details>
                      <Link href={`${base}/chat?${scope}`}>
                        이 범위에 질문하기 →
                      </Link>
                      {canWrite && (
                        <div className="inline-actions">
                          <Link
                            href={`${base}/tools/research?${scope}&topic=${encodeURIComponent(insight.title.slice(0, 150))}&description=${encodeURIComponent(insight.description.slice(0, 4000))}&gapType=${insight.kind}&pageIds=${insight.nodeIds.slice(0, 20).join(",")}`}
                          >
                            이 단서로 심층 조사 →
                          </Link>
                          <Link
                            href={`${base}/sources?${scope}#register-source`}
                          >
                            보완 자료 등록 →
                          </Link>
                        </div>
                      )}
                    </article>
                  ))}
                  {!analysis.insights.length && (
                    <p>현재 범위에서 표시할 탐색 단서가 없습니다.</p>
                  )}
                  <details className="graph-community-details">
                    <summary>지식 군집 {analysis.communities.length}개</summary>
                    {analysis.communities.map((c) => (
                      <article className="graph-insight" key={c.id}>
                        <h3>
                          군집 {c.id + 1} · {c.nodeIds.length}개
                        </h3>
                        <p>연결 밀도 {(c.cohesion * 100).toFixed(1)}%</p>
                        {c.topIds.map((n) => (
                          <Button
                            variant="link"
                            key={n}
                            onClick={() => reveal(n)}
                          >
                            {nodeMap.get(n)?.title}
                          </Button>
                        ))}
                      </article>
                    ))}
                  </details>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
