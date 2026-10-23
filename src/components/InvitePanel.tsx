"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@flu-wop/design-system";
import { cx } from "@/lib/format";

interface Invite {
  id: string;
  label: string;
  expiresAt: number;
}
interface Engineer {
  id: string;
  label: string;
  createdAt: number;
  lastSeen: number;
}
interface Fresh {
  code: string;
  label: string;
  expiresAt: number;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

/** Owner only. Makes one-time codes and shows who is signed in. */
export default function InvitePanel({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/invites", { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { now: number; invites: Invite[]; engineers: Engineer[] };
      setInvites(d.invites);
      setEngineers(d.engineers);
      setNow(d.now);
    } catch {
      /* the list just stays as it was */
    }
  }, []);

  useEffect(() => {
    // Initial fetch plus a slow refresh; the clock below ticks every second for the countdown.
    const first = setTimeout(load, 0);
    const poll = setInterval(load, 10_000);
    const tick = setInterval(() => setNow((n) => (n ? n + 1000 : Date.now())), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const d = (await res.json().catch(() => ({}))) as Partial<Fresh> & { error?: string };
      if (!res.ok || !d.code) {
        setError(d.error ?? "Could not make a code");
      } else {
        setFresh({ code: d.code, label: d.label ?? label, expiresAt: d.expiresAt ?? 0 });
        setLabel("");
        load();
      }
    } catch {
      setError("Could not reach the server");
    }
    setBusy(false);
  }

  async function revoke(kind: "invite" | "engineer", id: string) {
    await fetch("/api/invites/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, id }),
    }).catch(() => {});
    if (kind === "invite") setFresh((f) => f);
    load();
  }

  const left = fresh ? Math.max(0, fresh.expiresAt - now) : 0;
  const mm = String(Math.floor(left / 60000)).padStart(2, "0");
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");

  return (
    <div role="dialog" aria-modal="true" aria-label="Invite an engineer" className="fixed inset-0 z-50 overflow-y-auto bg-surface/95 backdrop-blur">
      <div className="mx-auto max-w-md px-5 pb-12 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-eyebrow uppercase text-accent-text">Engineer access</p>
            <h2 className="mt-1 font-display text-heading-3 text-ink">
              Invite an <em className="text-accent-text">engineer</em>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-sm border border-line px-5 text-eyebrow uppercase text-ink transition-colors duration-fast hover:border-line-strong focus-visible:outline-none focus-visible:shadow-focus"
          >
            Close
          </button>
        </div>
        <p className="mt-3 text-body-sm text-ink-muted">
          Make a one-time code. It works once, expires in 10 minutes, and gives record, scenes, mute and mark moment. Nothing else.
        </p>

        <form onSubmit={create} className="mt-6 flex gap-2">
          <input
            className="if-input min-h-[48px] flex-1"
            placeholder="Engineer's name"
            value={label}
            maxLength={30}
            onChange={(e) => setLabel(e.target.value)}
            aria-label="Engineer's name"
          />
          <Button type="submit" disabled={busy || label.trim().length === 0}>
            {busy ? "…" : "Make code"}
          </Button>
        </form>
        {error && <p className="mt-2 text-body-sm text-danger-text">{error}</p>}

        {fresh && (
          <div className="mt-6 rounded-sm border border-accent/50 bg-surface-alt p-5 text-center">
            <p className="text-eyebrow uppercase text-ink-muted">Code for {fresh.label}</p>
            <p className="mt-2 font-mono text-[44px] leading-none tracking-[0.2em] text-accent-text">
              {fresh.code.slice(0, 3)} {fresh.code.slice(3)}
            </p>
            <p className={cx("mt-3 font-mono text-caption", left === 0 ? "text-danger-text" : "text-ink-muted")}>
              {left === 0 ? "Expired" : `Expires in ${mm}:${ss}`}
            </p>
            <p className="mt-1 text-caption text-ink-muted">They open this site, tap “I have an engineer code”, and type it in.</p>
          </div>
        )}

        <h3 className="mt-8 text-eyebrow uppercase text-ink-muted">Open codes</h3>
        <ul className="mt-2 divide-y divide-line rounded-sm border border-line">
          {invites.length === 0 && <li className="px-4 py-3 text-body-sm text-ink-muted">None waiting.</li>}
          {invites.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-body-sm text-ink">{i.label}</span>
              <span className="flex items-center gap-3">
                <span className="font-mono text-caption text-ink-muted">{Math.max(0, Math.ceil((i.expiresAt - now) / 60000))} min left</span>
                <button type="button" onClick={() => revoke("invite", i.id)} className="min-h-[44px] px-2 text-caption uppercase text-danger-text">
                  Cancel
                </button>
              </span>
            </li>
          ))}
        </ul>

        <h3 className="mt-8 text-eyebrow uppercase text-ink-muted">Signed in</h3>
        <ul className="mt-2 divide-y divide-line rounded-sm border border-line">
          {engineers.length === 0 && <li className="px-4 py-3 text-body-sm text-ink-muted">No engineers yet.</li>}
          {engineers.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="block text-body-sm text-ink">{e.label}</span>
                <span className="block font-mono text-caption text-ink-muted">Active {ago(now - e.lastSeen)}</span>
              </span>
              <button type="button" onClick={() => revoke("engineer", e.id)} className="min-h-[44px] px-2 text-caption uppercase text-danger-text">
                Sign out
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
