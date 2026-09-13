import { analyzeGraph } from "@/lib/graph-analysis";
import type { ViewData } from "@/lib/graph-view";

self.onmessage = (event: MessageEvent<{ data: ViewData; spacing: number }>) => {
  try {
    self.postMessage({
      result: analyzeGraph(event.data.data, event.data.spacing),
    });
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "그래프를 계산하지 못했습니다.",
    });
  }
};
