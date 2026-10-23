import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { Role, StudioId } from "./types";
import { getDb } from "./db";

export const SESSION_COOKIE = "mcs_studio_session";
const SESSION_SECS = 8 * 60 * 60;

export function safeEq(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to 32+ characters");
  return new TextEncoder().encode(s);
}

export interface Session {
  role: Role;
  /** Engineer id, set only for engineer sessions. */
  eid?: string;
  label?: string;
}

/** Keyed hash for pairing codes, so a leaked database row can't be reversed without the server secret. */
export function hashCode(code: string): string {
  return createHmac("sha256", secretKey()).update(`pair:${code}`).digest("hex");
}

export async function createSessionCookie(role: Role, eid?: string) {
  const token = await new SignJWT(eid ? { role, eid } : { role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECS}s`)
    .sign(secretKey());
  return {
    name: SESSION_COOKIE,
    value: token,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict" as const,
      path: "/",
      maxAge: SESSION_SECS,
    },
  };
}

// Engineer sessions are re-checked against the database so a revoke takes effect within seconds.
const engineerCache = new Map<string, { ok: boolean; label: string; at: number; touched: number }>();
const CACHE_MS = 5_000;
const TOUCH_MS = 60_000;

async function engineerStatus(eid: string): Promise<{ ok: boolean; label: string }> {
  const now = Date.now();
  const hit = engineerCache.get(eid);
  if (hit && now - hit.at < CACHE_MS) return hit;
  const db = await getDb();
  const r = await db.execute({ sql: `SELECT label, revoked_at FROM engineers WHERE id = ?`, args: [eid] });
  const row = r.rows[0];
  const ok = !!row && row.revoked_at === null;
  const label = row ? String(row.label) : "";
  let touched = hit?.touched ?? 0;
  if (ok && now - touched > TOUCH_MS) {
    await db.execute({ sql: `UPDATE engineers SET last_seen = ? WHERE id = ?`, args: [now, eid] });
    touched = now;
  }
  engineerCache.set(eid, { ok, label, at: now, touched });
  if (engineerCache.size > 200) engineerCache.clear();
  return { ok, label };
}

/** Drop the cached answer for an engineer right after a revoke. */
export function forgetEngineer(eid: string) {
  engineerCache.delete(eid);
}

export async function getSession(): Promise<Session | null> {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (payload.role === "owner") return { role: "owner" };
    if (payload.role === "engineer" && typeof payload.eid === "string") {
      const st = await engineerStatus(payload.eid);
      return st.ok ? { role: "engineer", eid: payload.eid, label: st.label } : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** For POST routes that use the session cookie: the request must come from this site's own pages. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Maps a studio agent's bearer token to its studio, or null. */
export function studioForAgentToken(req: Request): StudioId | null {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const a = process.env.AGENT_TOKEN_A;
  const b = process.env.AGENT_TOKEN_B;
  if (a && safeEq(token, a)) return "A";
  if (b && safeEq(token, b)) return "B";
  return null;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
