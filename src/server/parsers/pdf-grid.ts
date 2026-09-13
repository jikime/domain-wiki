import { getDocument, OPS, Util } from "pdfjs-dist/legacy/build/pdf.mjs";

type Line = { axis: "h" | "v"; at: number; from: number; to: number };
type PointText = { x: number; y: number; text: string };
const EPS = 1.5;
function mergeLines(lines: Line[]) {
  const result: Line[] = [];
  for (const line of lines.sort(
    (a, b) => a.axis.localeCompare(b.axis) || a.at - b.at || a.from - b.from,
  )) {
    const existing = result.find(
      (l) =>
        l.axis === line.axis &&
        Math.abs(l.at - line.at) < EPS &&
        l.from <= line.to + EPS &&
        l.to >= line.from - EPS,
    );
    if (existing) {
      existing.from = Math.min(existing.from, line.from);
      existing.to = Math.max(existing.to, line.to);
    } else result.push({ ...line });
  }
  return result;
}
function crosses(a: Line, b: Line) {
  return (
    a.axis !== b.axis &&
    a.at >= b.from - EPS &&
    a.at <= b.to + EPS &&
    b.at >= a.from - EPS &&
    b.at <= a.to + EPS
  );
}
// Bordered, axis-aligned grids only. Borderless/merged/rotated layouts remain manual review.
// PDFParse's stroke-only detector misses browsers' thin filled rectangles; this uses PDF.js public page APIs.
export async function pdfBorderedTables(
  bytes: Uint8Array,
  pageNumbers: number[],
) {
  const task = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  const result: {
    page: number;
    tables: { rows: string[][]; x: number[]; y: number[] }[];
  }[] = [];
  try {
    for (const pageNumber of pageNumbers) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const ops = await page.getOperatorList();
      const lines: Line[] = [];
      let matrix = [1, 0, 0, 1, 0, 0];
      const stack: number[][] = [];
      const add = (x1: number, y1: number, x2: number, y2: number) => {
        const a = x1 * matrix[0] + y1 * matrix[2] + matrix[4];
        const b = x1 * matrix[1] + y1 * matrix[3] + matrix[5];
        const c = x2 * matrix[0] + y2 * matrix[2] + matrix[4];
        const d = x2 * matrix[1] + y2 * matrix[3] + matrix[5];
        const [x, y] = viewport.convertToViewportPoint(a, b);
        const [xx, yy] = viewport.convertToViewportPoint(c, d);
        if (Math.abs(y - yy) < EPS && Math.abs(x - xx) > 10)
          lines.push({
            axis: "h",
            at: (y + yy) / 2,
            from: Math.min(x, xx),
            to: Math.max(x, xx),
          });
        else if (Math.abs(x - xx) < EPS && Math.abs(y - yy) > 10)
          lines.push({
            axis: "v",
            at: (x + xx) / 2,
            from: Math.min(y, yy),
            to: Math.max(y, yy),
          });
      };
      for (let i = 0; i < ops.fnArray.length; i++) {
        const op = ops.fnArray[i];
        const args = ops.argsArray[i];
        if (op === OPS.save) stack.push([...matrix]);
        else if (op === OPS.restore) matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (op === OPS.transform) matrix = Util.transform(matrix, args);
        else if (op === OPS.constructPath) {
          const bounds = args?.[2];
          if (
            !bounds ||
            bounds.length !== 4 ||
            !Array.from(bounds).every(Number.isFinite)
          )
            continue;
          const [x1, y1, x2, y2] = bounds;
          const width = x2 - x1;
          const height = y2 - y1;
          if (args[0] === OPS.stroke) {
            add(x1, y1, x2, y1);
            add(x2, y1, x2, y2);
            add(x2, y2, x1, y2);
            add(x1, y2, x1, y1);
          } else if ([OPS.fill, OPS.eoFill].includes(args[0])) {
            if (width > 10 && height <= 2.5)
              add(x1, (y1 + y2) / 2, x2, (y1 + y2) / 2);
            else if (height > 10 && width <= 2.5)
              add((x1 + x2) / 2, y1, (x1 + x2) / 2, y2);
          }
        }
      }
      if (lines.length > 10000) {
        page.cleanup();
        continue;
      }
      const merged = mergeLines(lines);
      if (merged.length > 2000) {
        page.cleanup();
        continue;
      }
      const visited = new Set<number>();
      const grids: { x: number[]; y: number[] }[] = [];
      for (let i = 0; i < merged.length; i++) {
        if (visited.has(i)) continue;
        visited.add(i);
        const component = [merged[i]];
        const queue = [i];
        while (queue.length) {
          const current = queue.pop();
          if (current === undefined) break;
          for (let j = 0; j < merged.length; j++)
            if (!visited.has(j) && crosses(merged[current], merged[j])) {
              visited.add(j);
              queue.push(j);
              component.push(merged[j]);
            }
        }
        const vertical = component.filter((l) => l.axis === "v");
        const horizontal = component.filter((l) => l.axis === "h");
        const x = vertical.map((l) => l.at).sort((a, b) => a - b);
        const y = horizontal.map((l) => l.at).sort((a, b) => a - b);
        if (x.length < 3 || y.length < 3 || x.length > 51 || y.length > 201)
          continue;
        if (
          vertical.some(
            (l) => l.from > y[0] + EPS || l.to < y[y.length - 1] - EPS,
          ) ||
          horizontal.some(
            (l) => l.from > x[0] + EPS || l.to < x[x.length - 1] - EPS,
          )
        )
          continue;
        grids.push({ x, y });
      }
      const content = await page.getTextContent();
      const texts: PointText[] = content.items.flatMap((item) => {
        if (!("str" in item) || !item.str) return [];
        const p = viewport.convertToViewportPoint(
          item.transform[4] + item.width / 2,
          item.transform[5],
        );
        return [{ x: p[0], y: p[1], text: item.str }];
      });
      const tables = grids
        .map((g) => ({
          ...g,
          rows: g.y.slice(0, -1).map((top, r) =>
            g.x.slice(0, -1).map((left, c) =>
              texts
                .filter(
                  (t) =>
                    t.x > left &&
                    t.x < g.x[c + 1] &&
                    t.y > top &&
                    t.y < g.y[r + 1],
                )
                .sort((a, b) =>
                  Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y,
                )
                .reduce(
                  (s, t, i, items) =>
                    s +
                    (i && Math.abs(t.y - items[i - 1].y) > 2 ? "\n" : "") +
                    t.text,
                  "",
                )
                .trim(),
            ),
          ),
        }))
        .filter((t) => t.rows.every((row) => row.some(Boolean)));
      result.push({ page: pageNumber, tables });
      page.cleanup();
    }
    return result;
  } finally {
    await doc.destroy();
  }
}
