import { getDb } from "./db";

/** Fixed-window limiter backed by Turso (serverless-safe). key = `${route}:${ip}`. Returns true if allowed. */
export async function rateLimit(key: string, limit: number, windowSecs: number): Promise<boolean> {
  const db = await getDb();
  const windowStart = Math.floor(Date.now() / 1000 / windowSecs) * windowSecs;
  const r = await db.execute({
    sql: `INSERT INTO rate_limits (k, w, c) VALUES (?, ?, 1)
          ON CONFLICT(k, w) DO UPDATE SET c = c + 1 RETURNING c`,
    args: [key, windowStart],
  });
  if (Math.random() < 0.01) {
    await db.execute({
      sql: `DELETE FROM rate_limits WHERE w < ?`,
      args: [Math.floor(Date.now() / 1000) - 86400],
    });
  }
  return Number(r.rows[0].c) <= limit;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
}
