import { getDb } from "@/lib/db";
import { getSession, json } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV of the markers from a studio's most recent recording, for import into a DAW or an edit. */
export async function GET(req: Request) {
  if (!(await getSession())) return json({ error: "Unauthorized" }, 401);
  if (!(await rateLimit(`markers:${clientIp(req)}`, 60, 60))) return json({ error: "Too many requests" }, 429);

  const params = new URL(req.url).searchParams;
  const db = await getDb();
  let studio = params.get("studio");
  let rows;

  if (params.get("session")) {
    // One archived session: every marker made in its time span.
    const sid = Number(params.get("session"));
    if (!Number.isInteger(sid)) return json({ error: "Bad request" }, 400);
    const sess = await db.execute({ sql: `SELECT studio, started_at, ended_at FROM sessions WHERE id = ?`, args: [sid] });
    if (!sess.rows[0]) return json({ error: "Not found" }, 404);
    studio = String(sess.rows[0].studio);
    const from = Number(sess.rows[0].started_at);
    const to = sess.rows[0].ended_at === null ? from + 43_200_000 : Number(sess.rows[0].ended_at);
    rows = await db.execute({
      sql: `SELECT tc, label, author FROM markers WHERE studio = ? AND created_at BETWEEN ? AND ? ORDER BY tc_ms ASC`,
      args: [studio, from, to],
    });
  } else {
    if (studio !== "A" && studio !== "B") return json({ error: "Bad request" }, 400);
    const last = await db.execute({
      sql: `SELECT rec_start FROM markers WHERE studio = ? ORDER BY id DESC LIMIT 1`,
      args: [studio],
    });
    if (!last.rows[0]) return json({ error: "No markers yet" }, 404);
    const start = Number(last.rows[0].rec_start);
    // The start estimate wobbles by a second or so between marks, so group by a small window.
    rows = await db.execute({
      sql: `SELECT tc, label, author FROM markers WHERE studio = ? AND rec_start BETWEEN ? AND ? ORDER BY tc_ms ASC`,
      args: [studio, start - 5000, start + 5000],
    });
  }
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
