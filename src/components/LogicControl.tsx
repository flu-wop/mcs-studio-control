"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/format";

interface Props {
  online: boolean;
  onRecord: () => void;
  onStop: () => void;
}

const ARM_MS = 3000;

/** Presses Logic's record and stop keys on that Mac. Owner only. */
export default function LogicControl({ online, onRecord, onStop }: Props) {
  const [armed, setArmed] = useState<"record" | "stop" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function press(kind: "record" | "stop") {
    if (armed !== kind) {
      setArmed(kind);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(null), ARM_MS);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(null);
    if (kind === "record") onRecord();
    else onStop();
  }

  const base =
    "min-h-[48px] flex-1 rounded-sm border px-4 text-body-sm uppercase tracking-[0.12em] transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:shadow-focus";

  return (
    <div className="mt-6" onClick={(e) => e.stopPropagation()}>
      <p className="text-eyebrow uppercase text-ink-muted">Logic</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!online}
          onClick={() => press("record")}
          className={cx(base, armed === "record" ? "border-danger-text text-danger-text" : "border-line text-ink hover:border-line-strong")}
        >
          {armed === "record" ? "Tap again" : "Record"}
        </button>
        <button
          type="button"
          disabled={!online}
          onClick={() => press("stop")}
          className={cx(base, armed === "stop" ? "border-danger-text text-danger-text" : "border-line text-ink hover:border-line-strong")}
        >
          {armed === "stop" ? "Tap again" : "Stop"}
        </button>
      </div>
      <p className="mt-1.5 text-caption text-ink-muted">Stop presses Logic’s play/stop key, so use it only while Logic is running.</p>
    </div>
  );
}
