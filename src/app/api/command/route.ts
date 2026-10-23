import { getDb } from "@/lib/db";
import { getSession, json, sameOrigin } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import type { StudioId, StudioStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMAND_TTL_MS = 20_000;

type Target = StudioId | "BOTH";
const isTarget = (v: unknown): v is Target => v === "A" || v === "B" || v === "BOTH";

async function knownStatus(studio: StudioId): Promise<StudioStatus | null> {
  const db = await getDb();
  const r = await db.execute({ sql: `SELECT json FROM studio_status WHERE studio = ?`, args: [studio] });
  if (!r.rows[0]) return null;
  try {
    return JSON.parse(String(r.rows[0].json)) as StudioStatus;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  if (!(await getSession())) return json({ error: "Unauthorized" }, 401);
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

    case "session_name": {
      if (typeof body.name !== "string") return json({ error: "Invalid name" }, 400);
      const clean = body.name
        .trim()
        .replace(/[^A-Za-z0-9 _-]/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 60);
      payload = { name: clean };
      break;
    }

    default:
      return json({ error: "Unknown command" }, 400);
  }

  const db = await getDb();
  const now = Date.now();
  const ids: number[] = [];
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
