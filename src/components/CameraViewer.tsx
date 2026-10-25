"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { viewsFrom, type StateResponse } from "@/lib/types";
import { cx } from "@/lib/format";

interface Props {
  data: StateResponse | null;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}

/** Full-screen camera. Swipe, arrow keys or the side buttons move between cameras; Esc closes. */
export default function CameraViewer({ data, index, onIndex, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);
  const [shown, setShown] = useState<{ cam: string; src: string } | null>(null);

  const views = viewsFrom(data?.studios);
  const cam = views[Math.min(index, views.length - 1)];
  const snap = data?.snapshots[cam.id];
  const studio = data?.studios[cam.studio];
  const fresh = !!snap && snap.ageMs < 8000;
  const src = snap ? `/api/snapshot/${cam.id}?v=${snap.updatedAt}` : null;
  const count = views.length;

  const go = useCallback((step: number) => onIndex((index + step + count) % count), [index, count, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  // Lock page scroll behind the viewer, and use real full screen where the browser allows it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = root.current;
    el?.requestFullscreen?.().catch(() => {});
    return () => {
      document.body.style.overflow = prev;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  // Leaving real full screen (Esc, swipe down on iPad) closes the viewer too.
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement && root.current?.dataset.fs === "1") onClose();
      if (document.fullscreenElement) root.current!.dataset.fs = "1";
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [onClose]);

  // Show a new frame only once it has loaded; reset when the camera changes.
  const visible = shown && shown.cam === cam.id ? shown.src : null;

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={`${cam.label} camera, full screen`}
      className="fixed inset-0 z-50 flex flex-col bg-surface"
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        if (start === null) return;
        const dx = e.changedTouches[0].clientX - start;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
        <div>
          <p className="text-eyebrow uppercase text-ink-muted">Studio {cam.studio}</p>
          <h2 className="font-display text-heading-3 leading-none text-ink">{cam.label}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close full screen"
          className="min-h-[44px] rounded-sm border border-line px-5 text-eyebrow uppercase text-ink transition-colors duration-fast hover:border-line-strong focus-visible:outline-none focus-visible:shadow-focus"
        >
          Close
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {visible && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={visible} alt={`${cam.label} camera`} className="absolute inset-0 h-full w-full object-contain" />
        )}
        {src && src !== visible && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="hidden" onLoad={() => setShown({ cam: cam.id, src })} />
        )}
        {!fresh && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/80">
            <span className="text-eyebrow uppercase text-ink-muted">
              {!data ? "Connecting…" : !studio?.online ? `Studio ${cam.studio} offline` : "Waiting for picture"}
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Previous camera"
          className="absolute left-3 top-1/2 hidden min-h-[56px] min-w-[56px] -translate-y-1/2 rounded-sm border border-line bg-surface/70 text-heading-4 text-ink backdrop-blur transition-colors duration-fast hover:border-line-strong sm:block focus-visible:outline-none focus-visible:shadow-focus"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Next camera"
          className="absolute right-3 top-1/2 hidden min-h-[56px] min-w-[56px] -translate-y-1/2 rounded-sm border border-line bg-surface/70 text-heading-4 text-ink backdrop-blur transition-colors duration-fast hover:border-line-strong sm:block focus-visible:outline-none focus-visible:shadow-focus"
        >
          ›
        </button>
      </div>

      <div className="safe-bottom flex items-center justify-center gap-2 px-5 pt-3">
        {views.map((c, i) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onIndex(i)}
            aria-label={`Show ${c.label}`}
            aria-current={i === index}
            className={cx(
              "min-h-[44px] rounded-sm border px-4 text-eyebrow uppercase transition-colors duration-fast",
              i === index ? "border-accent bg-accent/10 text-accent-text" : "border-line text-ink-muted hover:text-ink",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
