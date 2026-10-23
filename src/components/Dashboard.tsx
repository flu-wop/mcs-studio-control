"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@flu-wop/design-system";
import { CAMERAS, STUDIOS, type CommandBody, type StateResponse, type StudioId } from "@/lib/types";
import { cx } from "@/lib/format";
import CameraViewer from "./CameraViewer";
import CameraWall from "./CameraWall";
import RecButton, { type RecPending } from "./RecButton";
import StudioPanel from "./StudioPanel";

const POLL_MS = 800;
const PENDING_MS = 8000;
const ARM_MS = 3000;

type Target = StudioId | "BOTH";
type PendingRec = Partial<Record<StudioId, { kind: "start" | "stop"; until: number }>>;
type PendingScene = Partial<Record<StudioId, { scene: string; until: number }>>;

export default function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState<StateResponse | null>(null);
  const [connected, setConnected] = useState(true);
  const [selected, setSelected] = useState<StudioId>("A");
  const [pendingRec, setPendingRec] = useState<PendingRec>({});
  const [pendingScene, setPendingScene] = useState<PendingScene>({});
  const [armed, setArmed] = useState<Target | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [viewer, setViewer] = useState<number | null>(null);
  // The poll loop reads this so the open camera gets a larger picture without restarting the loop.
  const focusRef = useRef<string | null>(null);
  useEffect(() => {
    focusRef.current = viewer === null ? null : CAMERAS[viewer].id;
  }, [viewer]);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll the server. Pausing while the tab is hidden also tells the agents to stop sending pictures.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.hidden) {
        timer = setTimeout(tick, 1500);
        return;
      }
      try {
        const focus = focusRef.current;
        const res = await fetch(`/api/state?watch=1${focus ? `&focus=${focus}` : ""}`, { cache: "no-store" });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.ok) {
          const next = (await res.json()) as StateResponse;
          if (!stopped) {
            setData(next);
            setConnected(true);
          }
        } else if (!stopped) {
          setConnected(false);
        }
      } catch {
        if (!stopped) setConnected(false);
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [router]);

  const flash = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  const send = useCallback(
    async (studio: Target, body: CommandBody) => {
      try {
        const res = await fetch("/api/command", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ studio, ...body }),
        });
        if (res.status === 401) {
          router.replace("/login");
          return false;
        }
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          flash(e.error ?? "Command failed");
          return false;
        }
        return true;
      } catch {
        flash("Could not reach the server");
        return false;
      }
    },
    [flash, router],
  );

  const serverNow = data?.now ?? 0;
  const targets = (t: Target): StudioId[] => (t === "BOTH" ? STUDIOS : [t]);
  const isRecording = (s: StudioId) => !!data?.studios[s].status?.record.active;

  const startRecording = useCallback(
    async (t: Target) => {
      if (!data) return;
      setArmed(null);
      setPendingRec((p) => {
        const n = { ...p };
        for (const s of targets(t)) n[s] = { kind: "start", until: data.now + PENDING_MS };
        return n;
      });
      await send(t, { type: "record_start" });
    },
    [data, send],
  );

  const stopRecording = useCallback(
    async (t: Target) => {
      if (!data) return;
      // First tap arms, second tap inside the window confirms.
      if (armed !== t) {
        setArmed(t);
        if (armTimer.current) clearTimeout(armTimer.current);
        armTimer.current = setTimeout(() => setArmed(null), ARM_MS);
        return;
      }
      if (armTimer.current) clearTimeout(armTimer.current);
      setArmed(null);
      setPendingRec((p) => {
        const n = { ...p };
        for (const s of targets(t)) n[s] = { kind: "stop", until: data.now + PENDING_MS };
        return n;
      });
      await send(t, { type: "record_stop" });
    },
    [data, send, armed],
  );

  const toggleRecording = useCallback(
    (s: StudioId) => (data?.studios[s].status?.record.active ? stopRecording(s) : startRecording(s)),
    [data, startRecording, stopRecording],
  );

  const switchScene = useCallback(
    async (s: StudioId, scene: string) => {
      if (!data) return;
      setPendingScene((p) => ({ ...p, [s]: { scene, until: data.now + 4000 } }));
      await send(s, { type: "scene", scene });
    },
    [data, send],
  );

  // Keyboard: A/B pick a studio, R records, 1-9 pick a scene.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (viewer !== null) return;
      const k = e.key.toLowerCase();
      if (k === "a") setSelected("A");
      else if (k === "b") setSelected("B");
      else if (k === "r") toggleRecording(selected);
      else if (/^[1-9]$/.test(k)) {
        const scene = data?.studios[selected].status?.scenes[Number(k) - 1];
        if (scene) switchScene(selected, scene);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, data, viewer, toggleRecording, switchScene]);

  // Server-reported command failures surface once each.
  const errors = (data?.errors ?? []).filter((e) => !dismissed.includes(e.id));

  const recPendingFor = (s: StudioId): RecPending => {
    const p = pendingRec[s];
    if (!p || serverNow >= p.until) return null;
    const rec = isRecording(s);
    if (p.kind === "start" && rec) return null;
    if (p.kind === "stop" && !rec) return null;
    return p.kind;
  };
  const scenePendingFor = (s: StudioId): string | null => {
    const p = pendingScene[s];
    if (!p || serverNow >= p.until) return null;
    return data?.studios[s].status?.scene === p.scene ? null : p.scene;
  };

  const anyRecording = STUDIOS.some(isRecording);
  const bothOnline = STUDIOS.every((s) => data?.studios[s].online && data.studios[s].status?.obsConnected);
  const bothPending: RecPending = STUDIOS.some((s) => recPendingFor(s) !== null)
    ? (recPendingFor("A") ?? recPendingFor("B"))
    : null;
  const selectedState = data?.studios[selected];
  const selectedOnline = !!selectedState?.online && !!selectedState.status?.obsConnected;

  return (
    <main className="mx-auto min-h-dvh max-w-[1400px] px-5 pb-40 pt-6 lg:pb-12">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow uppercase text-accent-text">Mid City Sound</p>
          <h1 className="mt-1 font-display text-heading-4 text-ink lg:text-heading-3">
            Studio <em className="text-accent-text">Control</em>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {connected ? <Badge variant="success">Live</Badge> : <Badge variant="danger">Reconnecting</Badge>}
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.replace("/login");
              router.refresh();
            }}
          >
            Sign out
          </Button>
        </div>
      </header>

      {(notice || errors.length > 0) && (
        <div role="alert" className="mb-4 space-y-2">
          {notice && <p className="rounded-sm border border-danger-text px-4 py-3 text-body-sm text-danger-text">{notice}</p>}
          {errors.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setDismissed((d) => [...d, e.id])}
              className="block w-full rounded-sm border border-danger-text px-4 py-3 text-left text-body-sm text-danger-text"
            >
              Studio {e.studio}: {e.message} (tap to dismiss)
            </button>
          ))}
        </div>
      )}

      <CameraWall data={data} onOpen={setViewer} />
      {viewer !== null && (
        <CameraViewer data={data} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
      )}

      {/* Phone: choose a studio. Desktop: both are visible, so this only sets the keyboard target. */}
      <div className="mt-6 flex items-center justify-between gap-4">
        <div role="tablist" aria-label="Studio" className="inline-flex rounded-sm border border-line p-1">
          {STUDIOS.map((s) => (
            <button
              key={s}
              role="tab"
              type="button"
              aria-selected={selected === s}
              onClick={() => setSelected(s)}
              className={cx(
                "min-h-[44px] min-w-[96px] rounded-sm px-4 text-eyebrow uppercase transition-colors duration-fast",
                selected === s ? "bg-accent text-on-accent" : "text-ink-muted hover:text-ink",
              )}
            >
              Studio {s}
              {isRecording(s) && <span className="rec-dot ml-2 inline-block h-2 w-2 rounded-full bg-danger-text align-middle" />}
            </button>
          ))}
        </div>
        <div className="hidden items-center gap-5 lg:flex">
          <p className="text-caption text-ink-muted">
            <span className="font-mono">A</span> <span className="font-mono">B</span> studio · <span className="font-mono">R</span> record ·{" "}
            <span className="font-mono">1–9</span> scene
          </p>
          <Button
            variant="outline"
            disabled={!bothOnline || bothPending !== null}
            onClick={() => (anyRecording ? stopRecording("BOTH") : startRecording("BOTH"))}
          >
            {bothPending
              ? bothPending === "start"
                ? "Starting both…"
                : "Stopping both…"
              : anyRecording
                ? armed === "BOTH"
                  ? "Tap again to stop both"
                  : "Stop both"
                : "Record both"}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        {STUDIOS.map((s) => (
          <StudioPanel
            key={s}
            id={s}
            state={data?.studios[s] ?? { online: false, ageMs: null, status: null }}
            selected={selected === s}
            pendingRec={recPendingFor(s)}
            pendingScene={scenePendingFor(s)}
            armed={armed === s}
            onSelect={() => setSelected(s)}
            onRecStart={() => startRecording(s)}
            onRecStop={() => stopRecording(s)}
            onScene={(scene) => switchScene(s, scene)}
            onMute={(input, muted) => send(s, { type: "mute", input, muted })}
            onSession={(name) => send(s, { type: "session_name", name })}
            onStreamStart={(target) => send(s, { type: "stream_start", target })}
            onStreamStop={() => send(s, { type: "stream_stop" })}
          />
        ))}
      </div>

      {/* Phone: always-reachable record bar */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-5 pt-3 backdrop-blur lg:hidden">
        <div className="mx-auto max-w-xl space-y-2">
          <RecButton
            recording={isRecording(selected)}
            pending={recPendingFor(selected)}
            armed={armed === selected}
            disabled={!selectedOnline}
            timecode={selectedState?.status?.record.timecode}
            onStart={() => startRecording(selected)}
            onStop={() => stopRecording(selected)}
          />
          <button
            type="button"
            disabled={!bothOnline || bothPending !== null}
            onClick={() => (anyRecording ? stopRecording("BOTH") : startRecording("BOTH"))}
            className="min-h-[44px] w-full rounded-sm border border-line text-eyebrow uppercase text-ink-muted transition-colors duration-fast hover:border-line-strong disabled:opacity-40"
          >
            {anyRecording ? (armed === "BOTH" ? "Tap again to stop both" : "Stop both studios") : "Record both studios"}
          </button>
        </div>
      </div>
    </main>
  );
}
