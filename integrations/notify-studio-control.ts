// Drop this file into the Mid City Sound site and call it after a booking is paid, changed or cancelled.
// Set two env vars on the MCS project:
//   STUDIO_CONTROL_URL=https://studio.midcitysound.com
//   BOOKING_WEBHOOK_SECRET=<the same value set on the studio-control project>
import { createHmac } from "crypto";

export interface StudioBooking {
  /** Any stable unique id for the booking, e.g. the Stripe checkout session id. */
  id: string;
  /** "A" or "B". Other rooms are ignored by Studio Control. */
  room: string;
  /** Client or artist name; this names the recording files. */
  client: string;
  start: Date | string;
  end: Date | string;
  cancelled?: boolean;
}

/** Never throws, so a Studio Control hiccup can't break a customer's booking. */
export async function notifyStudioControl(b: StudioBooking): Promise<void> {
  const base = process.env.STUDIO_CONTROL_URL;
  const secret = process.env.BOOKING_WEBHOOK_SECRET;
  if (!base || !secret) return;
  try {
    const body = JSON.stringify({
      id: b.id,
      studio: b.room,
      client: b.client,
      start: new Date(b.start).toISOString(),
      end: new Date(b.end).toISOString(),
      cancelled: b.cancelled === true,
    });
    const ts = String(Date.now());
    const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    const res = await fetch(`${base.replace(/\/+$/, "")}/api/bookings/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mcs-timestamp": ts, "x-mcs-signature": sig },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("Studio Control rejected the booking:", res.status);
  } catch (e) {
    console.error("Could not reach Studio Control:", e instanceof Error ? e.message : e);
  }
}
