import { randomInt, randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSession, hashCode, json, sameOrigin } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVITE_TTL_MS = 10 * 60 * 1000;
const MAX_ACTIVE = 5;

/** Owner only: who is signed in and which codes are waiting. */
export async function GET() {
  const s = await getSession();
  if (!s || s.role !== "owner") return json({ error: "Unauthorized" }, 401);
  const db = await getDb();
  const now = Date.now();
  const [inv, eng] = await Promise.all([
    db.execute({
      sql: `SELECT id, label, expires_at FROM invites
            WHERE used_at IS NULL AND revoked = 0 AND expires_at > ? ORDER BY created_at DESC`,
      args: [now],
    }),
    db.execute({
      sql: `SELECT id, label, created_at, last_seen FROM engineers WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 30`,
      args: [],
    }),
  ]);
  return json({
    now,
    invites: inv.rows.map((r) => ({ id: String(r.id), label: String(r.label), expiresAt: Number(r.expires_at) })),
    engineers: eng.rows.map((r) => ({
      id: String(r.id),
      label: String(r.label),
      createdAt: Number(r.created_at),
      lastSeen: Number(r.last_seen),
    })),
  });
}

/** Owner only: make a one-time code. The code is shown once and only its hash is stored. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const s = await getSession();
  if (!s || s.role !== "owner") return json({ error: "Unauthorized" }, 401);
  if (!(await rateLimit(`invite:${clientIp(req)}`, 20, 600))) return json({ error: "Too many requests" }, 429);

  let label = "";
  try {
    const body = (await req.json()) as { label?: unknown };
    if (typeof body.label === "string") label = body.label.replace(/[^A-Za-z0-9 ._-]/g, "").trim().slice(0, 30);
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  if (!label) return json({ error: "Enter the engineer's name" }, 400);

  const db = await getDb();
  const now = Date.now();
  const active = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM invites WHERE used_at IS NULL AND revoked = 0 AND expires_at > ?`,
    args: [now],
  });
  if (Number(active.rows[0]?.n ?? 0) >= MAX_ACTIVE) return json({ error: "Too many open codes. Revoke one first." }, 400);

  // Never hand out a code that another open invite already uses.
  let code = "";
  for (let i = 0; i < 10; i++) {
    const candidate = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const clash = await db.execute({
      sql: `SELECT 1 FROM invites WHERE code_hash = ? AND used_at IS NULL AND revoked = 0 AND expires_at > ?`,
      args: [hashCode(candidate), now],
    });
    if (!clash.rows[0]) {
      code = candidate;
      break;
    }
  }
  if (!code) return json({ error: "Could not make a code. Try again." }, 500);

  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO invites (id, code_hash, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    args: [id, hashCode(code), label, now, now + INVITE_TTL_MS],
  });
  return json({ ok: true, id, code, label, expiresAt: now + INVITE_TTL_MS });
}
