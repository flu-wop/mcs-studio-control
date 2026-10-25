import { getDb } from "@/lib/db";
import { json, studioForAgentToken } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import type { AgentCommand, StudioStatus } from "@/lib/types";
import { autoArm, trackSessions } from "@/lib/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 450_000;
const MAX_SNAPSHOT_B64 = 200_000;
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
      let prev: StudioStatus | null = null;
      try {
        const old = await db.execute({ sql: `SELECT json FROM studio_status WHERE studio = ?`, args: [studio] });
        prev = old.rows[0] ? (JSON.parse(String(old.rows[0].json)) as StudioStatus) : null;
      } catch {
        prev = null;
      }
      if (body.status.record && typeof body.status.record.active === "boolean") {
        await trackSessions(db, studio, prev, body.status, now);
      }
      await db.execute({
        sql: `INSERT INTO studio_status (studio, json, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(studio) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
        args: [studio, text, now],
      });
    }
  }

  if (body.snapshots && typeof body.snapshots === "object") {
    for (const [cam, b64] of Object.entries(body.snapshots).slice(0, 8)) {
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
  // Studio's latest known state decides whether a booking should rename the next recording.
  try {
    const cur = await db.execute({ sql: `SELECT json FROM studio_status WHERE studio = ?`, args: [studio] });
    await autoArm(db, studio, cur.rows[0] ? (JSON.parse(String(cur.rows[0].json)) as StudioStatus) : null, now);
  } catch {
    /* arming is best effort; the next check-in tries again */
  }
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

  const w = await db.execute({ sql: `SELECT k, v FROM meta WHERE k IN ('watch_until', 'focus')`, args: [] });
  const meta = new Map(w.rows.map((r) => [String(r.k), String(r.v)]));
  const watching = Number(meta.get("watch_until") ?? 0) > now;
  const [focusCam, focusUntil] = (meta.get("focus") ?? "|0").split("|");
  const focus = watching && focusCam && Number(focusUntil) > now ? focusCam : null;

  if (Math.random() < 0.01) {
    await db.execute({ sql: `DELETE FROM commands WHERE created_at < ?`, args: [now - 86_400_000] });
  }

  return json({ commands, watching, focus, serverTime: now });
}
