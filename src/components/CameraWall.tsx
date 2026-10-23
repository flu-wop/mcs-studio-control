"use client";

import { useState } from "react";
import { CAMERAS, type StateResponse } from "@/lib/types";
import { cx } from "@/lib/format";

/** Shows the new frame only once it has loaded, so the picture never flashes between updates. */
function LiveImage({ src, alt }: { src: string | null; alt: string }) {
  const [shown, setShown] = useState<string | null>(null);
  return (
    <>
      {shown && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shown} alt={alt} className="absolute inset-0 h-full w-full object-cover" />
      )}
      {src && src !== shown && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="hidden" onLoad={() => setShown(src)} />
      )}
    </>
  );
}

export default function CameraWall({ data }: { data: StateResponse | null }) {
  return (
    <section aria-label="Cameras" className="-mx-5 px-5 lg:mx-0 lg:px-0">
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-3 lg:gap-4 lg:overflow-visible">
        {CAMERAS.map((cam) => {
          const snap = data?.snapshots[cam.id];
          const studio = data?.studios[cam.studio];
          const fresh = !!snap && snap.ageMs < 8000;
          const src = snap ? `/api/snapshot/${cam.id}?v=${snap.updatedAt}` : null;
          const message = !data
            ? "Connecting…"
            : !studio?.online
              ? `Studio ${cam.studio} offline`
              : "Waiting for picture";

          return (
            <figure key={cam.id} className="min-w-[82%] snap-center sm:min-w-[46%] lg:min-w-0">
              <div className="relative aspect-video overflow-hidden rounded-sm border border-line bg-surface-alt">
                <LiveImage src={src} alt={`${cam.label} camera`} />
                {!fresh && (
                  <div className="absolute inset-0 flex items-center justify-center bg-surface-alt/80">
                    <span className="text-eyebrow uppercase text-ink-muted">{message}</span>
                  </div>
                )}
                <div className="absolute left-2 top-2 flex items-center gap-2">
                  <span
                    className={cx("h-2 w-2 rounded-full", fresh ? "bg-success" : "bg-line-strong")}
                    aria-hidden="true"
                  />
                </div>
              </div>
              <figcaption className="mt-2 flex items-baseline justify-between">
                <span className="font-display text-heading-4 text-ink">{cam.label}</span>
                <span className="text-eyebrow uppercase text-ink-muted">Studio {cam.studio}</span>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
