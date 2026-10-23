import { createHmac } from "crypto";
import { getDb } from "@/lib/db";
import { json, safeEq } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { cleanSessionName } from "@/lib/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 8_000;
const MAX_SKEW_MS = 5 * 60 * 1000;
const MAX_LENGTH_MS = 24 * 60 * 60 * 1000;

/**
 * The MCS site calls this after a booking is paid or changed.
 * Signed with BOOKING_WEBHOOK_SECRET: header x-mcs-signature = hex HMAC-SHA256 of `${x-mcs-timestamp}.${rawBody}`.
 */
export async function POST(req: Request) {
  const secret = process.env.BOOKING_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) return json({ error: "Not configured" }, 503);

  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY) return json({ error: "Payload too large" }, 413);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "Payload too large" }, 413);

  const ts = req.headers.get("x-mcs-timestamp") ?? "";
  const sig = (req.headers.get("x-mcs-signature") ?? "").trim().toLowerCase();
  const expected = createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  const fresh = /^\d{10,16}$/.test(ts) && Math.abs(Date.now() - Number(ts)) <= MAX_SKEW_MS;
  if (!fresh || !sig || !safeEq(sig, expected)) {
    // Only bad signatures count against the sender, so a real caller is never throttled.
    const allowed = await rateLimit(`booking-fail:${clientIp(req)}`, 20, 600);
    return json({ error: allowed ? "Unauthorized" : "Too many requests" }, allowed ? 401 : 429);
  }

  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const id = typeof b.id === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(b.id) ? b.id : "";
  const studio = b.studio === "A" || b.studio === "B" ? b.studio : null;
  const client = typeof b.client === "string" ? cleanSessionName(b.client).replace(/-/g, " ").trim() : "";
  const start = typeof b.start === "string" ? Date.parse(b.start) : NaN;
  const end = typeof b.end === "string" ? Date.parse(b.end) : NaN;
  const cancelled = b.cancelled === true;
  if (!id) return json({ error: "Invalid id" }, 400);
  // The MCS site has other rooms; only A and B are controlled here.
  if (!studio) return json({ ok: true, ignored: true });
  if (!client || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > MAX_LENGTH_MS) {
    return json({ error: "Invalid booking" }, 400);
  }

  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO bookings (id, studio, client, start_at, end_at, cancelled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET studio = excluded.studio, client = excluded.client, start_at = excluded.start_at,
            end_at = excluded.end_at, cancelled = excluded.cancelled, updated_at = excluded.updated_at`,
    args: [id, studio, client, start, end, cancelled ? 1 : 0, Date.now()],
  });
  if (Math.random() < 0.02) {
    await db.execute({ sql: `DELETE FROM bookings WHERE end_at < ?`, args: [Date.now() - 400 * 86_400_000] });
  }
  return json({ ok: true });
}
