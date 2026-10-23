import { getDb } from "@/lib/db";
import { forgetEngineer, getSession, json, sameOrigin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner only: cancel an open code, or sign an engineer out for good. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const s = await getSession();
  if (!s || s.role !== "owner") return json({ error: "Unauthorized" }, 401);

  let body: { id?: unknown; kind?: unknown };
  try {
    body = (await req.json()) as { id?: unknown; kind?: unknown };
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  if (typeof body.id !== "string" || body.id.length > 64 || (body.kind !== "invite" && body.kind !== "engineer")) {
    return json({ error: "Bad request" }, 400);
  }

  const db = await getDb();
  if (body.kind === "invite") {
    await db.execute({ sql: `UPDATE invites SET revoked = 1 WHERE id = ?`, args: [body.id] });
  } else {
    await db.execute({ sql: `UPDATE engineers SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, args: [Date.now(), body.id] });
    forgetEngineer(body.id);
  }
  return json({ ok: true });
}
