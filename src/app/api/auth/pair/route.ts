import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { createSessionCookie, hashCode, json, sameOrigin } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An engineer trades a one-time code for a limited session. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);

  // Per-visitor and site-wide limits: six digits is only safe if guessing is slow.
  if (!(await rateLimit(`pair:${clientIp(req)}`, 6, 15 * 60)) || !(await rateLimit("pair:all", 60, 10 * 60))) {
    return json({ error: "Too many attempts. Try again in a few minutes." }, 429);
  }

  let code = "";
  try {
    const body = (await req.json()) as { code?: unknown };
    if (typeof body.code === "string") code = body.code.replace(/\s+/g, "");
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  if (!/^\d{6}$/.test(code)) return json({ error: "Invalid or expired code" }, 401);

  const db = await getDb();
  const now = Date.now();
  // One atomic step: the code is spent the moment it matches, so it can never be used twice.
  const claimed = await db.execute({
    sql: `UPDATE invites SET used_at = ?
          WHERE code_hash = ? AND used_at IS NULL AND revoked = 0 AND expires_at > ?
          RETURNING id, label`,
    args: [now, hashCode(code), now],
  });
  const row = claimed.rows[0];
  if (!row) return json({ error: "Invalid or expired code" }, 401);

  const eid = randomUUID();
  await db.execute({
    sql: `INSERT INTO engineers (id, label, created_at, last_seen) VALUES (?, ?, ?, ?)`,
    args: [eid, String(row.label), now, now],
  });

  const c = await createSessionCookie("engineer", eid);
  (await cookies()).set(c.name, c.value, c.options);
  return json({ ok: true });
}
