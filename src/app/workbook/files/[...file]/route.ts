import { workbookDownloads } from "@/lib/workbook";
import { readWorkbookFile } from "@/server/workbook";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string[] }> },
) {
  const file = (await params).file.join("/");
  if (!workbookDownloads.includes(file))
    return new Response("파일을 찾을 수 없습니다.", { status: 404 });
  const buffer = await readWorkbookFile(file);
  if (!buffer) return new Response("파일을 찾을 수 없습니다.", { status: 404 });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": file.endsWith(".pdf")
        ? "application/pdf"
        : file.endsWith(".csv")
          ? "text/csv; charset=utf-8"
          : "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.split("/").at(-1) ?? "workbook.txt")}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
