"use client";

import { useState } from "react";
import { Badge } from "@flu-wop/design-system";
import type { Booking, Marker, Role, StudioId, StudioState } from "@/lib/types";
import { cx, fmtDisk } from "@/lib/format";
import Meter from "./Meter";
import RecButton, { type RecPending } from "./RecButton";
import StreamControl from "./StreamControl";
import LogicControl from "./LogicControl";

interface Props {
  id: StudioId;
  role: Role;
  markers: Marker[];
  booking: Booking | null;
  /** Server clock, so countdowns don't depend on this device's clock. */
  now: number;
  state: StudioState;
  /** Phone: only the selected studio shows. Desktop: both always show, the selected one is highlighted. */
  selected: boolean;
  pendingRec: RecPending;
  pendingScene: string | null;
  armed: boolean;
  onSelect: () => void;
  onRecStart: () => void;
  onRecStop: () => void;
  onScene: (scene: string) => void;
  onMute: (input: string, muted: boolean) => void;
  onSession: (name: string) => void;
  onStreamStart: (target: string) => void;
  onStreamStop: () => void;
  onMark: () => void;
  onLogicRecord: () => void;
  onLogicStop: () => void;
}

const TZ = "America/Chicago";
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });

function until(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 90) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

function BookingCard({ booking, now }: { booking: Booking; now: number }) {
  const live = now >= booking.startAt;
  return (
    <div className="mt-5 rounded-sm border border-line bg-surface px-4 py-3">
      <p className="text-eyebrow uppercase text-ink-muted">{live ? "In session" : "Next booking"}</p>
      <p className="mt-1 font-display text-heading-4 leading-tight text-ink">{booking.client}</p>
      <p className="mt-1 font-mono text-caption text-ink-muted">
        {clock(booking.startAt)} – {clock(booking.endAt)}
        {!live && ` · starts in ${until(booking.startAt - now)}`}
        {live && ` · ${until(booking.endAt - now)} left`}
      </p>
      {booking.armed && <p className="mt-1 text-caption text-accent-text">Ready. The next recording is named for this client.</p>}
    </div>
  );
}

export default function StudioPanel(p: Props) {
  const { id, state, selected } = p;
  const owner = p.role === "owner";
  const status = state.status;
  const online = state.online && !!status?.obsConnected;
  const recording = !!status?.record.active;
  const lowDisk = status?.diskFreeMb != null && status.diskFreeMb < 20 * 1024;
  const [draft, setDraft] = useState<string | null>(null);
  const sessionValue = draft ?? status?.sessionName ?? "";

  function commitSession() {
    if (draft !== null && draft !== status?.sessionName) p.onSession(draft);
    setDraft(null);
  }

  return (
    <section
      aria-label={`Studio ${id}`}
      onClick={p.onSelect}
      className={cx(
        "rounded-sm border bg-surface-alt p-5 transition-colors duration-base",
        selected ? "block border-line lg:border-accent/50" : "hidden border-line lg:block",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-eyebrow uppercase text-ink-muted">Studio</p>
          <h2 className="font-display text-heading-3 leading-none text-ink">
            {id}
            {recording && <span className="rec-dot ml-3 inline-block h-2.5 w-2.5 rounded-full bg-danger-text align-middle" aria-label="Recording" />}
          </h2>
        </div>
        <div className="flex flex-col items-end gap-2">
          {online ? <Badge variant="success">Online</Badge> : <Badge variant="danger">{state.online ? "OBS closed" : "Offline"}</Badge>}
          <span className={cx("font-mono text-caption", lowDisk ? "text-danger-text" : "text-ink-muted")}>
            Disk {fmtDisk(status?.diskFreeMb ?? null)}
          </span>
        </div>
      </header>

      {p.booking && <BookingCard booking={p.booking} now={p.now} />}

      {!status ? (
        <p className="mt-6 text-body-sm text-ink-muted">
          Waiting for Studio {id} to check in. Make sure the bridge agent is running on that Mac.
        </p>
      ) : (
        <>
          {/* Record: phones use the sticky bar at the bottom instead */}
          <div className="mt-5 hidden lg:block">
            <RecButton
              recording={recording}
              pending={p.pendingRec}
              armed={p.armed}
              disabled={!online}
              timecode={status.record.timecode}
              onStart={p.onRecStart}
              onStop={p.onRecStop}
            />
          </div>

          <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              disabled={!online || !recording}
              onClick={p.onMark}
              className="min-h-[48px] flex-1 rounded-sm border border-line px-4 text-body-sm uppercase tracking-[0.12em] text-ink transition-colors duration-fast hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:shadow-focus"
            >
              Mark moment <span className="ml-1 hidden font-mono text-caption text-ink-muted lg:inline">M</span>
            </button>
            {p.markers.length > 0 && (
              <a
                href={`/api/markers?studio=${id}`}
                className="flex min-h-[48px] items-center rounded-sm border border-line px-4 text-caption uppercase text-ink-muted transition-colors duration-fast hover:border-line-strong hover:text-ink"
              >
                CSV
              </a>
            )}
          </div>
          {p.markers.length > 0 && (
            <ul className="mt-2 space-y-1" aria-label="Recent moments">
              {p.markers.slice(0, 4).map((m) => (
                <li key={m.id} className="flex items-baseline gap-3 text-caption text-ink-muted">
                  <span className="font-mono text-ink">{m.tc}</span>
                  <span className="truncate">{m.label}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6">
            <p className="text-eyebrow uppercase text-ink-muted">Scene</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {status.scenes.map((scene, i) => {
                const active = (p.pendingScene ?? status.scene) === scene;
                return (
                  <button
                    key={scene}
                    type="button"
                    disabled={!online}
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onScene(scene);
                    }}
                    aria-pressed={active}
                    className={cx(
                      "relative min-h-[52px] rounded-sm border px-3 text-left text-body-sm transition-colors duration-fast disabled:opacity-40 focus-visible:outline-none focus-visible:shadow-focus",
                      active
                        ? "border-accent bg-accent/10 text-accent-text"
                        : "border-line text-ink hover:border-line-strong",
                    )}
                  >
                    <span className="line-clamp-2">{scene}</span>
                    {i < 9 && (
                      <span className="absolute right-2 top-1.5 hidden font-mono text-caption text-ink-muted lg:inline">{i + 1}</span>
                    )}
                  </button>
                );
              })}
              {status.scenes.length === 0 && <p className="col-span-full text-body-sm text-ink-muted">No scenes found in OBS.</p>}
            </div>
          </div>

          {owner && <StreamControl status={status} online={online} onStart={p.onStreamStart} onStop={p.onStreamStop} />}
          {owner && status.logic && <LogicControl online={online} onRecord={p.onLogicRecord} onStop={p.onLogicStop} />}

          <div className="mt-6">
            <p className="text-eyebrow uppercase text-ink-muted">Audio</p>
            <div className="mt-3 space-y-2.5">
              {status.inputs.map((inp) => (
                <Meter
                  key={inp.name}
                  label={inp.label}
                  db={inp.db}
                  muted={inp.muted}
                  disabled={!online}
                  onToggleMute={() => p.onMute(inp.name, !inp.muted)}
                />
              ))}
              {status.inputs.length === 0 && <p className="text-body-sm text-ink-muted">No mics configured on this agent.</p>}
            </div>
          </div>

          <div className="mt-6">
            <label htmlFor={`session-${id}`} className="text-eyebrow uppercase text-ink-muted">
              Session name
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id={`session-${id}`}
                className="if-input min-h-[48px] flex-1"
                value={sessionValue}
                placeholder="e.g. Grim-vocals"
                disabled={!owner || !online || recording}
                maxLength={60}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitSession}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
            <p className="mt-1.5 text-caption text-ink-muted">
              {!owner ? "Set by the studio owner." : recording ? "Locked while recording." : "Names the next recording file."}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
