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

export interface StateResponse {
  now: number;
  studios: Record<StudioId, StudioState>;
  snapshots: Record<string, SnapshotMeta>;
  errors: CommandError[];
}

export type CommandBody =
  | { type: "record_start" }
  | { type: "record_stop" }
  | { type: "scene"; scene: string }
  | { type: "mute"; input: string; muted: boolean }
  | { type: "session_name"; name: string }
  | { type: "stream_start"; target: string }
  | { type: "stream_stop" };

/** Camera currently open full screen on a dashboard; its agent sends a larger picture. */
export type FocusCam = string | null;

export interface AgentCommand {
  id: number;
  type: CommandBody["type"];
  payload: Record<string, unknown>;
}
