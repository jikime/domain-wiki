import { getPool } from "@/server/db";
export const runtime = "nodejs";
export async function GET() {
  try {
    await getPool().query("SELECT 1");
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
