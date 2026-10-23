import { getDb } from "@/lib/db";
import { json, studioForAgentToken } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import type { AgentCommand, StudioStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 450_000;
const MAX_SNAPSHOT_B64 = 90_000;
const CAM_ID = /^[a-z0-9_-]{1,24}$/;
const B64 = /^[A-Za-z0-9+/=]+$/;

interface SyncBody {
  status?: StudioStatus;
  snapshots?: Record<string, string>;
  results?: { id: number; ok: boolean; error?: string }[];
}

export async function POST(req: Request) {
  const studio = studioForAgentToken(req);
  if (!studio) {
    // Only failed attempts count: a valid token is never throttled, a guessing bot is.
    const allowed = await rateLimit(`agent-auth-fail:${clientIp(req)}`, 20, 600);
    return json({ error: allowed ? "Unauthorized" : "Too many requests" }, allowed ? 401 : 429);
  }

  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) return json({ error: "Payload too large" }, 413);

  let body: SyncBody;
  try {
    body = (await req.json()) as SyncBody;
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const db = await getDb();
  const now = Date.now();

  if (body.status && typeof body.status === "object") {
    const text = JSON.stringify(body.status);
    if (text.length <= 20_000) {
      await db.execute({
        sql: `INSERT INTO studio_status (studio, json, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(studio) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
        args: [studio, text, now],
      });
    }
  }

  if (body.snapshots && typeof body.snapshots === "object") {
    for (const [cam, b64] of Object.entries(body.snapshots).slice(0, 4)) {
      if (!CAM_ID.test(cam) || typeof b64 !== "string" || b64.length > MAX_SNAPSHOT_B64 || !B64.test(b64)) continue;
      await db.execute({
        sql: `INSERT INTO snapshots (cam, studio, jpeg_b64, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(cam) DO UPDATE SET studio = excluded.studio, jpeg_b64 = excluded.jpeg_b64, updated_at = excluded.updated_at`,
        args: [cam, studio, b64, now],
      });
    }
  }

  if (Array.isArray(body.results)) {
    for (const r of body.results.slice(0, 20)) {
      if (!r || typeof r.id !== "number") continue;
      await db.execute({
        sql: `UPDATE commands SET status = ?, result = ?, done_at = ?
              WHERE id = ? AND studio = ? AND status = 'sent'`,
        args: [r.ok ? "done" : "failed", r.ok ? null : String(r.error ?? "Failed").slice(0, 200), now, r.id, studio],
      });
    }
  }

  // Anything the agent was too late to pick up (or never confirmed) is dropped, never run later.
  await db.execute({
    sql: `UPDATE commands SET status = 'expired', result = 'No response from the studio', done_at = ?
          WHERE status IN ('pending', 'sent') AND expires_at <= ?`,
    args: [now, now],
  });
  const claimed = await db.execute({
    sql: `UPDATE commands SET status = 'sent'
          WHERE studio = ? AND status = 'pending' AND expires_at > ?
          RETURNING id, type, payload`,
    args: [studio, now],
  });
  const commands: AgentCommand[] = claimed.rows
    .map((r) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(String(r.payload));
      } catch {
        payload = {};
      }
      return { id: Number(r.id), type: String(r.type) as AgentCommand["type"], payload };
    })
    .sort((a, b) => a.id - b.id);

  const w = await db.execute({ sql: `SELECT v FROM meta WHERE k = 'watch_until'`, args: [] });
  const watching = w.rows[0] ? Number(w.rows[0].v) > now : false;

  if (Math.random() < 0.01) {
    await db.execute({ sql: `DELETE FROM commands WHERE created_at < ?`, args: [now - 86_400_000] });
  }

  return json({ commands, watching, serverTime: now });
}
