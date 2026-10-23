import type { Client } from "@libsql/client";
import type { StudioId, StudioStatus } from "./types";

/** Same rules the session-name command uses: letters, numbers, space, dash, underscore; spaces become dashes. */
export function cleanSessionName(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

/** The studio is prepared this long before a booking starts. */
export const ARM_LEAD_MS = 15 * 60 * 1000;
const COMMAND_TTL_MS = 20_000;

async function getMeta(db: Client, k: string): Promise<string | null> {
  const r = await db.execute({ sql: `SELECT v FROM meta WHERE k = ?`, args: [k] });
  return r.rows[0] ? String(r.rows[0].v) : null;
}
async function setMeta(db: Client, k: string, v: string) {
  await db.execute({
    sql: `INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
    args: [k, v],
  });
}

function parseTcMs(tc: string | undefined): number {
  const m = /^(\d+):(\d{2}):(\d{2})/.exec(tc ?? "");
  return m ? ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 : 0;
}

/**
 * Called on every agent check-in. Records when a recording starts and stops so the archive stays
 * correct no matter where Record was pressed (this dashboard, OBS itself, or Logic's key).
 */
export async function trackSessions(db: Client, studio: StudioId, prev: StudioStatus | null, next: StudioStatus, now: number) {
  const was = !!prev?.record?.active;
  const is = !!next.record?.active;
  if (is === was) return;

  if (is) {
    await db.execute({ sql: `UPDATE sessions SET ended_at = ? WHERE studio = ? AND ended_at IS NULL`, args: [now, studio] });
    // Who pressed Record: the dashboard notes it just before the command runs.
    let by = "OBS";
    const note = await getMeta(db, `rec_by:${studio}`);
    if (note) {
      const [who, at] = note.split("|");
      if (who && now - Number(at) < 60_000) by = who;
    }
    const booking = await db.execute({
      sql: `SELECT id FROM bookings WHERE studio = ? AND cancelled = 0 AND start_at - ? <= ? AND end_at >= ? ORDER BY start_at LIMIT 1`,
      args: [studio, ARM_LEAD_MS, now, now],
    });
    await db.execute({
      sql: `INSERT INTO sessions (studio, name, booking_id, started_at, started_by) VALUES (?, ?, ?, ?, ?)`,
      args: [studio, next.sessionName ?? "", booking.rows[0] ? String(booking.rows[0].id) : null, now - parseTcMs(next.record.timecode), by],
    });
  } else {
    await db.execute({ sql: `UPDATE sessions SET ended_at = ? WHERE studio = ? AND ended_at IS NULL`, args: [now, studio] });
  }
}

/**
 * Called on every agent check-in. When a booking's window opens, queues a session-name command so the
 * next recording is named for the client. It never presses Record.
 */
export async function autoArm(db: Client, studio: StudioId, status: StudioStatus | null, now: number) {
  if (!status || !status.obsConnected || status.record?.active) return;

  const r = await db.execute({
    sql: `SELECT id, client, start_at FROM bookings
          WHERE studio = ? AND cancelled = 0 AND start_at - ? <= ? AND end_at > ? ORDER BY start_at LIMIT 1`,
    args: [studio, ARM_LEAD_MS, now, now],
  });
  const b = r.rows[0];
  if (!b) return;

  const key = `${String(b.id)}@${Number(b.start_at)}`;
  const name = cleanSessionName(String(b.client));
  if (!name) return;

  const armedKey = `armed:${studio}`;
  const armed = await getMeta(db, armedKey);
  const firstTime = armed !== key;
  // After an agent restart the studio forgets its name; put it back, but not more than once a minute.
  const lostName = armed === key && !status.sessionName && now - Number((await getMeta(db, `armed_try:${studio}`)) ?? 0) > 60_000;
  if (!firstTime && !lostName) return;

  await db.execute({
    sql: `INSERT INTO commands (studio, type, payload, status, created_at, expires_at) VALUES (?, 'session_name', ?, 'pending', ?, ?)`,
    args: [studio, JSON.stringify({ name }), now, now + COMMAND_TTL_MS],
  });
  await setMeta(db, armedKey, key);
  await setMeta(db, `armed_try:${studio}`, String(now));
}
