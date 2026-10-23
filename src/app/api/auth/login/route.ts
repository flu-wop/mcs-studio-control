import { cookies } from "next/headers";
import { createSessionCookie, json, safeEq, sameOrigin } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);

  const allowed = await rateLimit(`login:${clientIp(req)}`, 5, 15 * 60);
  if (!allowed) return json({ error: "Too many attempts. Try again in a few minutes." }, 429);

  let password = "";
  try {
    const body = (await req.json()) as { password?: unknown };
    if (typeof body.password === "string") password = body.password.slice(0, 200);
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const expected = process.env.OWNER_PASSWORD;
  if (!expected) return json({ error: "Server is not configured" }, 500);
  if (!password || !safeEq(password, expected)) return json({ error: "Wrong password" }, 401);

  const c = await createSessionCookie("owner");
  (await cookies()).set(c.name, c.value, c.options);
  return json({ ok: true });
}
