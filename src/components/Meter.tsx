"use client";

import { cx, dbToPct, fmtDb } from "@/lib/format";

interface Props {
  label: string;
  db: number | null;
  muted: boolean | null;
  disabled?: boolean;
  onToggleMute: () => void;
}

export default function Meter({ label, db, muted, disabled, onToggleMute }: Props) {
  const pct = dbToPct(db);
  const level = db ?? -90;
  const color = level >= -3 ? "bg-danger-text" : level >= -12 ? "bg-accent" : "bg-success";

  return (
    <div className="flex items-center gap-3">
      <span className="w-[4.5rem] shrink-0 truncate text-body-sm text-ink">{label}</span>
      <div
        className="relative h-2.5 flex-1 overflow-hidden rounded-sm bg-surface-raised"
        role="meter"
        aria-label={`${label} level`}
        aria-valuemin={-60}
        aria-valuemax={0}
        aria-valuenow={db ?? -60}
      >
        <div className={cx("meter-fill absolute inset-y-0 left-0", color, muted && "opacity-25")} style={{ width: `${pct}%` }} />
        {/* -12 and -3 dB marks */}
        <span className="absolute inset-y-0 w-px bg-line-strong/60" style={{ left: "80%" }} aria-hidden="true" />
        <span className="absolute inset-y-0 w-px bg-line-strong/60" style={{ left: "95%" }} aria-hidden="true" />
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-caption text-ink-muted">{fmtDb(db)}</span>
      <button
        type="button"
        onClick={onToggleMute}
        disabled={disabled || muted === null}
        aria-pressed={muted === true}
        className={cx(
          "min-h-[40px] w-[4.25rem] shrink-0 rounded-sm border text-caption uppercase tracking-[0.12em] transition-colors duration-fast disabled:opacity-40",
          muted ? "border-danger-text text-danger-text" : "border-line text-ink-muted hover:border-line-strong",
        )}
      >
        {muted ? "Muted" : "Live"}
      </button>
    </div>
  );
}
