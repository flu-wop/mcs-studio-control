"use client";

import { useEffect, useRef, useState } from "react";
import type { StudioStatus } from "@/lib/types";
import { cx, fmtTimecode } from "@/lib/format";

interface Props {
  status: StudioStatus;
  online: boolean;
  onStart: (target: string) => void;
  onStop: () => void;
}

const ARM_MS = 3000;
const PENDING_MS = 12000;

/** Go live to one platform at a time. Both starting and ending take two taps so a stray press can't air or cut the stream. */
export default function StreamControl({ status, online, onStart, onStop }: Props) {
  const targets = status.streamTargets ?? [];
  const live = !!status.stream?.active;
  const [choice, setChoice] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState<"start" | "stop" | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    },
    [],
  );

  if (targets.length === 0) return null;

  const target = choice && targets.includes(choice) ? choice : targets[0];
  // A pending action only counts until the studio reports the matching state.
  const waiting = pending !== null && (pending === "start") !== live;

  function press() {
    if (!armed) {
      setArmed(true);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmed(false), ARM_MS);
      return;
    }
    if (armTimer.current) clearTimeout(armTimer.current);
    setArmed(false);
    const kind = live ? "stop" : "start";
    setPending(kind);
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(() => setPending(null), PENDING_MS);
    if (kind === "start") onStart(target);
    else onStop();
  }

  const base =
    "relative flex w-full min-h-[52px] items-center justify-center gap-3 rounded-sm px-5 text-body-sm font-medium uppercase tracking-[0.14em] transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:shadow-focus";

  return (
    <div className="mt-6" onClick={(e) => e.stopPropagation()}>
      <p className="text-eyebrow uppercase text-ink-muted">Stream</p>

      {!live && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Stream destination">
          {targets.map((t) => (
            <button
              key={t}
              type="button"
              disabled={!online || waiting}
              aria-pressed={t === target}
              onClick={() => {
                setChoice(t);
                setArmed(false);
              }}
              className={cx(
                "min-h-[44px] rounded-sm border px-4 text-body-sm transition-colors duration-fast disabled:opacity-40",
                t === target ? "border-accent bg-accent/10 text-accent-text" : "border-line text-ink hover:border-line-strong",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3">
        {waiting ? (
          <button type="button" disabled className={cx(base, "border border-line-strong text-ink-muted")}>
            {pending === "start" ? `Going live on ${target}…` : "Ending stream…"}
          </button>
        ) : live ? (
          <button
            type="button"
            onClick={press}
            disabled={!online}
            className={cx(base, armed ? "border border-danger-text bg-surface text-danger-text" : "bg-danger text-on-danger")}
          >
            {armed ? (
              "Tap again to end stream"
            ) : (
              <>
                <span className="rec-dot h-2.5 w-2.5 rounded-full bg-danger-text" aria-hidden="true" />
                <span>{status.stream.reconnecting ? "Reconnecting" : `Live on ${status.stream.target ?? "stream"}`}</span>
                <span className="font-mono tracking-[0.08em]">{fmtTimecode(status.stream.timecode)}</span>
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={press}
            disabled={!online}
            className={cx(base, "border border-danger-text text-danger-text hover:bg-danger/30")}
          >
            {armed ? `Tap again to go live on ${target}` : `Go live on ${target}`}
          </button>
        )}
      </div>
    </div>
  );
}
