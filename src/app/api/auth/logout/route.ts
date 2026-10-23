import { cookies } from "next/headers";
import { SESSION_COOKIE, json, sameOrigin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  (await cookies()).delete(SESSION_COOKIE);
  return json({ ok: true });
}
