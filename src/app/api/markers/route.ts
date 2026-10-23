import { getDb } from "@/lib/db";
import { getSession, json } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV of the markers from a studio's most recent recording, for import into a DAW or an edit. */
export async function GET(req: Request) {
  if (!(await getSession())) return json({ error: "Unauthorized" }, 401);
  if (!(await rateLimit(`markers:${clientIp(req)}`, 60, 60))) return json({ error: "Too many requests" }, 429);

  const studio = new URL(req.url).searchParams.get("studio");
  if (studio !== "A" && studio !== "B") return json({ error: "Bad request" }, 400);

  const db = await getDb();
  const last = await db.execute({
    sql: `SELECT rec_start FROM markers WHERE studio = ? ORDER BY id DESC LIMIT 1`,
    args: [studio],
  });
  if (!last.rows[0]) return json({ error: "No markers yet" }, 404);
  const start = Number(last.rows[0].rec_start);

  // The start estimate wobbles by a second or so between marks, so group by a small window.
  const rows = await db.execute({
    sql: `SELECT tc, label, author FROM markers WHERE studio = ? AND rec_start BETWEEN ? AND ? ORDER BY tc_ms ASC`,
    args: [studio, start - 5000, start + 5000],
  });
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = ["Timecode,Label,Marked by", ...rows.rows.map((r) => [esc(String(r.tc)), esc(String(r.label)), esc(String(r.author))].join(","))];
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="studio-${studio}-markers.csv"`,
      "cache-control": "no-store",
    },
  });
}
