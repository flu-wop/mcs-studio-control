import { getDb } from "@/lib/db";
import { getSession, json, sameOrigin } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { cleanSessionName } from "@/lib/booking";
import { ENGINEER_COMMANDS, type StudioId, type StudioStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMAND_TTL_MS = 20_000;

type Target = StudioId | "BOTH";
const isTarget = (v: unknown): v is Target => v === "A" || v === "B" || v === "BOTH";

async function knownStatus(studio: StudioId): Promise<StudioStatus | null> {
  return (await knownStatusAt(studio))?.status ?? null;
}

async function knownStatusAt(studio: StudioId): Promise<{ status: StudioStatus; updatedAt: number } | null> {
  const db = await getDb();
  const r = await db.execute({ sql: `SELECT json, updated_at FROM studio_status WHERE studio = ?`, args: [studio] });
  if (!r.rows[0]) return null;
  try {
    return { status: JSON.parse(String(r.rows[0].json)) as StudioStatus, updatedAt: Number(r.rows[0].updated_at) };
  } catch {
    return null;
  }
}

/** "HH:MM:SS.mmm" from OBS to milliseconds. */
function tcToMs(tc: string): number {
  const m = /^(\d+):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(tc);
  if (!m) return 0;
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number((m[4] ?? "0").padEnd(3, "0"));
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (!(await rateLimit(`command:${clientIp(req)}`, 120, 60))) return json({ error: "Too many requests" }, 429);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const target = body.studio;
  const type = body.type;
  if (!isTarget(target) || typeof type !== "string") return json({ error: "Invalid command" }, 400);

  // Engineers get a short list; streaming, Logic, session names and invites stay with the owner.
  if (session.role !== "owner" && !(ENGINEER_COMMANDS as string[]).includes(type)) {
    return json({ error: "Not allowed for engineers" }, 403);
  }

  const studios: StudioId[] = target === "BOTH" ? ["A", "B"] : [target];
  let payload: Record<string, unknown> = {};

  switch (type) {
    case "record_start":
    case "record_stop":
      break;

    case "scene": {
      if (target === "BOTH" || typeof body.scene !== "string" || body.scene.length > 100) {
        return json({ error: "Invalid scene" }, 400);
      }
      const st = await knownStatus(target);
      if (!st || !st.scenes.includes(body.scene)) return json({ error: "Unknown scene" }, 400);
      payload = { scene: body.scene };
      break;
    }

    case "mute": {
      if (target === "BOTH" || typeof body.input !== "string" || typeof body.muted !== "boolean") {
        return json({ error: "Invalid mute command" }, 400);
      }
      const st = await knownStatus(target);
      if (!st || !st.inputs.some((i) => i.name === body.input)) return json({ error: "Unknown input" }, 400);
      payload = { input: body.input, muted: body.muted };
      break;
    }

    case "stream_start": {
      if (target === "BOTH" || typeof body.target !== "string") return json({ error: "Invalid stream target" }, 400);
      const st = await knownStatus(target);
      if (!st || !(st.streamTargets ?? []).includes(body.target)) return json({ error: "Unknown stream target" }, 400);
      payload = { target: body.target };
      break;
    }

    case "stream_stop":
      if (target === "BOTH") return json({ error: "Stop each stream separately" }, 400);
      break;

    case "marker": {
      if (target === "BOTH") return json({ error: "Mark one studio at a time" }, 400);
      const known = await knownStatusAt(target);
      const now0 = Date.now();
      if (!known || now0 - known.updatedAt > 15_000) return json({ error: `Studio ${target} is not responding` }, 409);
      if (!known.status.record.active) return json({ error: `Studio ${target} is not recording` }, 409);
      const label =
        (typeof body.label === "string" ? body.label.replace(/[^A-Za-z0-9 ._,'!?&-]/g, "").trim().slice(0, 40) : "") || "Moment";
      // The status is a second or so old, so add that age to the recording clock.
      const tcMs = tcToMs(known.status.record.timecode) + Math.max(0, now0 - known.updatedAt);
      const hh = String(Math.floor(tcMs / 3_600_000)).padStart(2, "0");
      const mm = String(Math.floor((tcMs % 3_600_000) / 60_000)).padStart(2, "0");
      const ss = String(Math.floor((tcMs % 60_000) / 1000)).padStart(2, "0");
      const db0 = await getDb();
      await db0.execute({
        sql: `INSERT INTO markers (studio, tc, tc_ms, rec_start, label, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [target, `${hh}:${mm}:${ss}`, tcMs, now0 - tcMs, label, session.role === "owner" ? "Owner" : (session.label ?? "Engineer"), now0],
      });
      return json({ ok: true, tc: `${hh}:${mm}:${ss}` });
    }

    case "logic_record":
    case "logic_stop": {
      if (target === "BOTH") return json({ error: "Control Logic one studio at a time" }, 400);
      const st = await knownStatus(target);
      if (!st?.logic) return json({ error: `Logic control is not set up on Studio ${target}` }, 400);
      break;
    }

    case "session_name": {
      if (typeof body.name !== "string") return json({ error: "Invalid name" }, 400);
      const clean = cleanSessionName(body.name);
      payload = { name: clean };
      break;
    }

    default:
      return json({ error: "Unknown command" }, 400);
  }

  const db = await getDb();
  const now = Date.now();
  const ids: number[] = [];
  if (type === "record_start") {
    const who = session.role === "owner" ? "Owner" : (session.label ?? "Engineer");
    for (const s of studios) {
      await db.execute({
        sql: `INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
        args: [`rec_by:${s}`, `${who}|${now}`],
      });
    }
  }
  for (const s of studios) {
    const r = await db.execute({
      sql: `INSERT INTO commands (studio, type, payload, status, created_at, expires_at)
            VALUES (?, ?, ?, 'pending', ?, ?)`,
      args: [s, type, JSON.stringify(payload), now, now + COMMAND_TTL_MS],
    });
    ids.push(Number(r.lastInsertRowid));
  }
  return json({ ok: true, ids });
}
