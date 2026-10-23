"use client";

import { cx, fmtTimecode } from "@/lib/format";

export type RecPending = "start" | "stop" | null;

interface Props {
  recording: boolean;
  pending: RecPending;
  /** True after the first tap on Stop; the next tap confirms. */
  armed: boolean;
  disabled?: boolean;
  timecode?: string;
  onStart: () => void;
  onStop: () => void;
  className?: string;
}

/** One button, four states. Stopping takes two taps so a pocket-press can't end a take. */
export default function RecButton({ recording, pending, armed, disabled, timecode, onStart, onStop, className }: Props) {
  const base =
    "relative flex w-full min-h-[56px] items-center justify-center gap-3 rounded-sm px-5 text-body font-medium uppercase tracking-[0.14em] transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:shadow-focus";

  if (pending) {
    return (
      <button type="button" disabled className={cx(base, "border border-line-strong text-ink-muted", className)}>
        {pending === "start" ? "Starting…" : "Stopping…"}
      </button>
    );
  }

  if (recording) {
    return (
      <button
        type="button"
        onClick={onStop}
        disabled={disabled}
        aria-label={armed ? "Tap again to stop recording" : "Stop recording"}
        className={cx(
          base,
          armed ? "border border-danger-text bg-surface text-danger-text" : "bg-danger text-on-danger",
          className,
        )}
      >
        {armed ? (
          "Tap again to stop"
        ) : (
          <>
            <span className="rec-dot h-2.5 w-2.5 rounded-full bg-danger-text" aria-hidden="true" />
            <span className="font-mono tracking-[0.08em]">{fmtTimecode(timecode)}</span>
            <span className="text-ink/70">Stop</span>
          </>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onStart}
      disabled={disabled}
      aria-label="Start recording"
      className={cx(base, "border border-danger-text text-danger-text hover:bg-danger/30", className)}
    >
      <span className="h-2.5 w-2.5 rounded-full bg-danger-text" aria-hidden="true" />
      Record
    </button>
  );
}
