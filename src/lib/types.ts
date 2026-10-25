export type StudioId = "A" | "B";
export const STUDIOS: StudioId[] = ["A", "B"];

/** The three cameras. Each studio's agent only reports the ones plugged into its own Mac. */
export const CAMERAS = [
  { id: "cam1", label: "A Room", studio: "A" as StudioId },
  { id: "cam2", label: "Booth", studio: "A" as StudioId },
  { id: "cam3", label: "B Room", studio: "B" as StudioId },
];

export interface InputStatus {
  /** OBS input name, used when sending mute commands. */
  name: string;
  /** Friendly label shown on the dashboard. */
  label: string;
  /** Peak level in dBFS since the last update, null when unknown. */
  db: number | null;
  muted: boolean | null;
}

/** What a studio's agent reports about its OBS. */
export interface StudioStatus {
  obsConnected: boolean;
  record: { active: boolean; paused: boolean; timecode: string };
  scene: string | null;
  scenes: string[];
  diskFreeMb: number | null;
  inputs: InputStatus[];
  /** Live stream state. Stream keys never leave the Mac; only target names are reported. */
  stream: { active: boolean; reconnecting: boolean; timecode: string; target: string | null };
  streamTargets: string[];
  /** Extra views this Mac offers (desktop screens, more cameras). Labels the agent chose, if any. */
  cameras?: { id: string; label: string | null }[];
  /** True when this Mac's agent is set up to press Logic's record and stop keys. */
  logic: boolean;
  sessionName: string;
  agentVersion: string;
}

export interface StudioState {
  online: boolean;
  /** Milliseconds since the agent last checked in, null if never. */
  ageMs: number | null;
  status: StudioStatus | null;
}

export interface SnapshotMeta {
  studio: StudioId;
  updatedAt: number;
  ageMs: number;
}

export interface CommandError {
  id: number;
  studio: StudioId;
  type: string;
  message: string;
}

export interface Marker {
  id: number;
  studio: StudioId;
  tc: string;
  label: string;
  createdAt: number;
}

export interface Booking {
  id: string;
  studio: StudioId;
  client: string;
  startAt: number;
  endAt: number;
  /** The session name has been applied to the studio for this booking. */
  armed: boolean;
}

export type Role = "owner" | "engineer";

export interface StateResponse {
  role: Role;
  now: number;
  studios: Record<StudioId, StudioState>;
  snapshots: Record<string, SnapshotMeta>;
  errors: CommandError[];
  markers: Record<StudioId, Marker[]>;
  bookings: Record<StudioId, Booking | null>;
}

export type CommandBody =
  | { type: "record_start" }
  | { type: "record_stop" }
  | { type: "scene"; scene: string }
  | { type: "mute"; input: string; muted: boolean }
  | { type: "session_name"; name: string }
  | { type: "stream_start"; target: string }
  | { type: "stream_stop" }
  | { type: "marker"; label?: string }
  | { type: "logic_record" }
  | { type: "logic_stop" };

/** What an engineer may send. Everything else is owner only. */
export const ENGINEER_COMMANDS: CommandBody["type"][] = ["record_start", "record_stop", "scene", "mute", "marker"];

/** Camera currently open full screen on a dashboard; its agent sends a larger picture. */
export type FocusCam = string | null;

export interface AgentCommand {
  id: number;
  type: CommandBody["type"];
  payload: Record<string, unknown>;
}

export interface View {
  id: string;
  label: string;
  studio: StudioId;
}

/** Every picture the dashboard can show: the three known cameras plus anything an agent reports, A before B. */
export function viewsFrom(studios: Record<StudioId, StudioState> | undefined): View[] {
  const views: View[] = CAMERAS.map((c) => ({ ...c }));
  for (const studio of STUDIOS) {
    for (const c of studios?.[studio].status?.cameras ?? []) {
      if (typeof c?.id !== "string") continue;
      const hit = views.find((v) => v.id === c.id);
      if (hit) {
        if (c.label) hit.label = c.label;
      } else {
        views.push({ id: c.id, label: c.label ?? c.id, studio });
      }
    }
  }
  return views.map((v, i) => ({ v, i })).sort((a, b) => (a.v.studio === b.v.studio ? a.i - b.i : a.v.studio < b.v.studio ? -1 : 1)).map((x) => x.v);
}
