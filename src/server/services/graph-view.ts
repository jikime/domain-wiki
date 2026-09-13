import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { GRAPH_VIEW_SETTINGS, type ViewData } from "@/lib/graph-view";
import { wikiTypeSchema } from "@/lib/wiki-metadata";
import { AccessError, requireWorkspace } from "@/server/access";
import { checkScope } from "./content-access";
import { scopedKnowledgeGraph } from "./knowledge-graph";

const querySchema = z.object({
  domainId: z.uuid(),
  projectId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  type: z.union([wikiTypeSchema, z.literal("all")]).default("all"),
  q: z.string().trim().max(200).default(""),
  limit: z.coerce
    .number()
    .int()
    .refine((v) => [50, 100, 200].includes(v))
    .default(100),
  focusId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  hops: z.coerce.number().int().min(1).max(2).default(1),
});
export async function graphView(
  h: Headers,
  w: string,
  input: unknown,
): Promise<ViewData> {
  await requireWorkspace(h, w);
  const scope = querySchema.parse(input);
  await checkScope(w, scope.domainId, scope.projectId);
  let graph: Awaited<ReturnType<typeof scopedKnowledgeGraph>>;
  try {
    graph = await scopedKnowledgeGraph(w, {
      domainId: scope.domainId,
      projectId: scope.projectId,
      sourceId: null,
      wikiId: null,
      sourceOnly: false,
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("처리 한도"))
      throw new AccessError(
        413,
        "그래프 범위가 큽니다. 프로젝트를 선택해 범위를 좁혀 주세요.",
      );
    throw e;
  }
  const q = scope.q.normalize("NFKC").toLocaleLowerCase("ko");
  let nodes = [...graph.nodes.values()].filter(
    (n) =>
      (scope.type === "all" || n.metadata.type === scope.type) &&
      (!q ||
        [n.title, ...n.metadata.aliases].some((t) =>
          t.normalize("NFKC").toLocaleLowerCase("ko").includes(q),
        )),
  );
  // Filter before traversing: a hidden or excluded node never acts as a bridge.
  const allowed = new Map(nodes.map((n) => [n.id, n]));
  if (scope.focusId) {
    if (!allowed.has(scope.focusId))
      throw new AccessError(
        404,
        "선택한 범위에서 탐색할 위키를 찾을 수 없습니다.",
      );
    const reached = new Set([scope.focusId]);
    let frontier = [scope.focusId];
    for (let hop = 0; hop < scope.hops; hop++) {
      const next = new Set<string>();
      for (const id of frontier) {
        const n = allowed.get(id);
        if (!n) continue;
        for (const target of [...n.inLinks, ...n.outLinks])
          if (allowed.has(target) && !reached.has(target)) next.add(target);
        for (const source of n.sources)
          for (const target of graph.bySource.get(
            `${source.id}:${source.versionId}`,
          ) ?? [])
            if (allowed.has(target) && !reached.has(target)) next.add(target);
      }
      for (const id of next) reached.add(id);
      frontier = [...next];
    }
    nodes = nodes.filter((n) => reached.has(n.id));
  }
  // Stable UUID ordering avoids implying a global rank or leaking excluded degree.
  nodes.sort(
    (a, b) =>
      Number(b.id === scope.focusId) - Number(a.id === scope.focusId) ||
      a.id.localeCompare(b.id),
  );
  const matched = nodes.length;
  nodes = nodes.slice(0, scope.limit);
  const shown = new Set(nodes.map((n) => n.id));
  const result = nodes.map((n) => ({
    id: n.id,
    versionId: n.versionId,
    domainId: n.domainId,
    projectId: n.projectId,
    title: n.title,
    type: n.metadata.type,
    aliases: n.metadata.aliases,
    sources: n.sources,
    outLinks: [...n.outLinks].filter((id) => shown.has(id)).sort(),
  }));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([w, scope, GRAPH_VIEW_SETTINGS, result, matched]))
    .digest("hex");
  return {
    fingerprint,
    scope,
    nodes: result,
    matched,
    truncated: matched > result.length,
  };
}
