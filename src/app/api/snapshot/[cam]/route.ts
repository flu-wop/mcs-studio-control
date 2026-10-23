import { getDb } from "@/lib/db";
import { getSession, json } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ cam: string }> }) {
  if (!(await getSession())) return json({ error: "Unauthorized" }, 401);
  const { cam } = await params;
  if (!/^[a-z0-9_-]{1,24}$/.test(cam)) return json({ error: "Not found" }, 404);

  const db = await getDb();
  const r = await db.execute({ sql: `SELECT jpeg_b64 FROM snapshots WHERE cam = ?`, args: [cam] });
  if (!r.rows[0]) return json({ error: "Not found" }, 404);

  const bytes = Buffer.from(String(r.rows[0].jpeg_b64), "base64");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/jpeg",
      // The URL carries the snapshot's timestamp, so each version can be cached.
      "cache-control": "private, max-age=60",
    },
  });
}
