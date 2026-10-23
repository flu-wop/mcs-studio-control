import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const TZ = "America/Chicago";
const day = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ });
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });

/** Read the clock outside the component so the page stays a pure function of its data. */
const currentTime = () => Date.now();

function length(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return "under a minute";
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export default async function ArchivePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/");

  const db = await getDb();
  const rows = await db.execute({
    sql: `SELECT s.id, s.studio, s.name, s.started_at, s.ended_at, s.started_by, b.client,
            (SELECT COUNT(*) FROM markers m WHERE m.studio = s.studio AND m.created_at >= s.started_at
               AND m.created_at <= COALESCE(s.ended_at, s.started_at + 43200000)) AS marks
          FROM sessions s LEFT JOIN bookings b ON b.id = s.booking_id
          ORDER BY s.started_at DESC LIMIT 100`,
    args: [],
  });
  const now = currentTime();

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-5 pb-16 pt-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow uppercase text-accent-text">Mid City Sound</p>
          <h1 className="mt-1 font-display text-heading-3 text-ink">
            Session <em className="text-accent-text">archive</em>
          </h1>
        </div>
        <Link
          href="/"
          className="flex min-h-[44px] items-center rounded-sm border border-line px-5 text-eyebrow uppercase text-ink transition-colors duration-fast hover:border-line-strong focus-visible:outline-none focus-visible:shadow-focus"
        >
          Dashboard
        </Link>
      </header>
      <p className="mt-3 text-body-sm text-ink-muted">
        Every recording, by room, with who started it and any marked moments. The video files stay on each studio Mac.
      </p>

      {rows.rows.length === 0 ? (
        <p className="mt-10 rounded-sm border border-line px-5 py-8 text-center text-body-sm text-ink-muted">
          No sessions yet. They appear here as recordings start and stop.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-line rounded-sm border border-line">
          {rows.rows.map((r) => {
            const start = Number(r.started_at);
            const end = r.ended_at === null ? null : Number(r.ended_at);
            const open = end === null && now - start < 12 * 3_600_000;
            const title = String(r.client ?? "") || String(r.name) || "Untitled session";
            const marks = Number(r.marks);
            return (
              <li key={String(r.id)} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4">
                <div className="min-w-0">
                  <p className="truncate font-display text-heading-4 leading-tight text-ink">{title}</p>
                  <p className="mt-1 font-mono text-caption text-ink-muted">
                    {day(start)} · {clock(start)}
                    {end !== null ? ` – ${clock(end)} · ${length(end - start)}` : open ? " · recording now" : " · end not recorded"}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-caption text-ink-muted">
                  <span className="uppercase tracking-[0.12em]">Studio {String(r.studio)}</span>
                  <span>{String(r.started_by)}</span>
                  {marks > 0 && (
                    <a
                      href={`/api/markers?session=${String(r.id)}`}
                      className="flex min-h-[44px] items-center text-accent-text underline-offset-4 hover:underline"
                    >
                      {marks} {marks === 1 ? "moment" : "moments"} · CSV
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
