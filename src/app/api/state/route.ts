import { getDb } from "@/lib/db";
import { getSession, json } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { CAMERAS, type Booking, type CommandError, type Marker, type SnapshotMeta, type StateResponse, type StudioId, type StudioState, type StudioStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ONLINE_MS = 20_000;
const WATCH_WINDOW_MS = 12_000;

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (!(await rateLimit(`state:${clientIp(req)}`, 300, 60))) return json({ error: "Too many requests" }, 429);

  const db = await getDb();
  const now = Date.now();
  const params = new URL(req.url).searchParams;
  const watch = params.get("watch") === "1";
  const focusParam = params.get("focus");
  const focus = focusParam && CAMERAS.some((c) => c.id === focusParam) ? focusParam : "";

  if (watch) {
    // Tell the agents someone is looking (and which camera is full screen). Only write when needed.
    const cur = await db.execute({ sql: `SELECT k, v FROM meta WHERE k IN ('watch_until', 'focus')`, args: [] });
    const meta = new Map(cur.rows.map((r) => [String(r.k), String(r.v)]));
    const until = Number(meta.get("watch_until") ?? 0);
    if (until - now < WATCH_WINDOW_MS / 2) {
      await db.execute({
        sql: `INSERT INTO meta (k, v) VALUES ('watch_until', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
        args: [String(now + WATCH_WINDOW_MS)],
      });
    }
    // Stored as "cam|expiresAt". Rewrite when the camera changes, is closing, or is about to lapse.
    const [curCam, curUntil] = (meta.get("focus") ?? "|0").split("|");
    const stored = curCam && Number(curUntil) > now ? curCam : "";
    if (focus ? stored !== focus || Number(curUntil) - now < WATCH_WINDOW_MS / 2 : stored !== "") {
      await db.execute({
        sql: `INSERT INTO meta (k, v) VALUES ('focus', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
        args: [focus ? `${focus}|${now + WATCH_WINDOW_MS}` : "|0"],
      });
    }
  }

  const [statusRows, snapRows, errRows, markerRows, bookingRows, armedRows] = await Promise.all([
    db.execute({ sql: `SELECT studio, json, updated_at FROM studio_status`, args: [] }),
    db.execute({ sql: `SELECT cam, studio, updated_at FROM snapshots`, args: [] }),
    db.execute({
      sql: `SELECT id, studio, type, result FROM commands
            WHERE status IN ('failed', 'expired') AND created_at > ? ORDER BY id DESC LIMIT 5`,
      args: [now - 30_000],
    }),
    db.execute({ sql: `SELECT id, studio, tc, label, created_at FROM markers ORDER BY id DESC LIMIT 20`, args: [] }),
    db.execute({
      sql: `SELECT id, studio, client, start_at, end_at FROM bookings
            WHERE cancelled = 0 AND end_at > ? AND start_at < ? ORDER BY start_at LIMIT 20`,
      args: [now, now + 24 * 3_600_000],
    }),
    db.execute({ sql: `SELECT k, v FROM meta WHERE k IN ('armed:A', 'armed:B')`, args: [] }),
  ]);

  const studios: Record<StudioId, StudioState> = {
    A: { online: false, ageMs: null, status: null },
    B: { online: false, ageMs: null, status: null },
  };
  for (const row of statusRows.rows) {
    const id = String(row.studio) as StudioId;
    if (id !== "A" && id !== "B") continue;
    const ageMs = now - Number(row.updated_at);
    let status: StudioStatus | null = null;
    try {
      status = JSON.parse(String(row.json)) as StudioStatus;
    } catch {
      status = null;
    }
    studios[id] = { online: ageMs < ONLINE_MS, ageMs, status };
  }

  const snapshots: Record<string, SnapshotMeta> = {};
  for (const row of snapRows.rows) {
    const updatedAt = Number(row.updated_at);
    snapshots[String(row.cam)] = {
      studio: String(row.studio) as StudioId,
      updatedAt,
      ageMs: now - updatedAt,
    };
  }

  const errors: CommandError[] = errRows.rows.map((r) => ({
    id: Number(r.id),
    studio: String(r.studio) as StudioId,
    type: String(r.type),
    message: r.result ? String(r.result) : "Command did not run",
  }));

  const markers: Record<StudioId, Marker[]> = { A: [], B: [] };
  for (const r of markerRows.rows) {
    const id = String(r.studio) as StudioId;
    if ((id === "A" || id === "B") && markers[id].length < 6) {
      markers[id].push({ id: Number(r.id), studio: id, tc: String(r.tc), label: String(r.label), createdAt: Number(r.created_at) });
    }
  }

  // Per studio: the booking in progress (or opening within 15 minutes), else the next one today.
  const armedKeys = new Map(armedRows.rows.map((r) => [String(r.k), String(r.v)]));
  const bookings: Record<StudioId, Booking | null> = { A: null, B: null };
  for (const r of bookingRows.rows) {
    const id = String(r.studio) as StudioId;
    if ((id !== "A" && id !== "B") || bookings[id]) continue;
    const startAt = Number(r.start_at);
    bookings[id] = {
      id: String(r.id),
      studio: id,
      client: String(r.client),
      startAt,
      endAt: Number(r.end_at),
      armed: armedKeys.get(`armed:${id}`) === `${String(r.id)}@${startAt}`,
    };
  }

  const body: StateResponse = { role: session.role, now, studios, snapshots, errors, markers, bookings };
  return json(body);
}
