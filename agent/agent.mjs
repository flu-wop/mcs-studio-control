#!/usr/bin/env node
// Mid City Sound Studio Control: bridge agent.
// Runs on each studio Mac next to OBS. Talks to OBS on localhost and to the dashboard over outbound HTTPS only.
import OBSWebSocket, { EventSubscription } from "obs-websocket-js/json";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.3.0";
const here = dirname(fileURLToPath(import.meta.url));

// ---------- config ----------
function loadEnvFile() {
  const file = join(here, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnvFile();

function pairs(s) {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.indexOf("=");
      return i < 0 ? { key: x, val: x } : { key: x.slice(0, i).trim(), val: x.slice(i + 1).trim() };
    });
}

const cfg = {
  studio: (process.env.STUDIO ?? "").toUpperCase(),
  appUrl: (process.env.APP_URL ?? "").replace(/\/+$/, ""),
  token: process.env.AGENT_TOKEN ?? "",
  obsUrl: process.env.OBS_URL ?? "ws://127.0.0.1:4455",
  obsPassword: process.env.OBS_PASSWORD ?? "",
  cams: pairs(process.env.CAMERAS), // key = cam id, val = OBS source name
  mics: pairs(process.env.MIC_INPUTS), // key = OBS input name, val = label
  // Name|server|key, comma separated. Keys stay on this Mac and are never sent to the dashboard.
  streams: (process.env.STREAM_TARGETS ?? "")
    .split(",")
    .map((x) => x.trim().split("|").map((p) => p.trim()))
    .filter((p) => p.length === 3 && p[0] && p[1] && p[2])
    .map(([name, server, key]) => ({ name, server, key })),
  // Logic control is off unless LOGIC_CONTROL=on. Keys must match Logic's own key commands.
  logic: {
    on: (process.env.LOGIC_CONTROL ?? "").toLowerCase() === "on",
    app: process.env.LOGIC_APP ?? "Logic Pro",
    recordKey: (process.env.LOGIC_RECORD_KEY ?? "r").toLowerCase(),
    stopKey: (process.env.LOGIC_STOP_KEY ?? "space").toLowerCase(),
    dryRun: process.env.LOGIC_DRY_RUN === "1",
  },
  reverseScenes: (process.env.SCENE_ORDER ?? "reverse").toLowerCase() !== "normal",
};

if (!["A", "B"].includes(cfg.studio) || !cfg.appUrl || !cfg.token) {
  console.error("Set STUDIO (A or B), APP_URL and AGENT_TOKEN in agent/.env, then start again.");
  process.exit(1);
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- OBS ----------
const obs = new OBSWebSocket();
let obsReady = false;
let lastObsTry = 0;
let obsWarned = false;
let knownScenes = [];
let sessionName = "";
let streamTarget = null;
let streamStartedAt = 0;

/** Highest input level seen since the last report, per OBS input name (linear 0..1). */
const peaks = new Map();
obs.on("InputVolumeMeters", ({ inputs }) => {
  for (const m of cfg.mics) {
    const entry = inputs.find((i) => i.inputName === m.key);
    if (!entry) continue;
    let top = 0;
    for (const ch of entry.inputLevelsMul ?? []) top = Math.max(top, ch[2] ?? ch[1] ?? 0);
    if (top > (peaks.get(m.key) ?? 0)) peaks.set(m.key, top);
  }
});
obs.on("ConnectionClosed", () => {
  if (obsReady) log("OBS connection closed");
  obsReady = false;
});

async function connectObs() {
  if (obsReady) return;
  if (Date.now() - lastObsTry < 3000) return;
  lastObsTry = Date.now();
  try {
    await obs.connect(cfg.obsUrl, cfg.obsPassword || undefined, {
      eventSubscriptions: EventSubscription.All | EventSubscription.InputVolumeMeters,
      rpcVersion: 1,
    });
    obsReady = true;
    obsWarned = false;
    log("Connected to OBS");
  } catch (e) {
    if (!obsWarned) log(`OBS not reachable at ${cfg.obsUrl}: ${e.message}`);
    obsWarned = true;
  }
}

function toDb(mul) {
  if (!mul || mul <= 0) return -90;
  return Math.max(-90, 20 * Math.log10(mul));
}

async function buildStatus(includeMeters) {
  const status = {
    obsConnected: obsReady,
    record: { active: false, paused: false, timecode: "00:00:00.000" },
    scene: null,
    scenes: [],
    diskFreeMb: null,
    inputs: cfg.mics.map((m) => ({ name: m.key, label: m.val, db: null, muted: null })),
    stream: { active: false, reconnecting: false, timecode: "00:00:00.000", target: null },
    streamTargets: cfg.streams.map((t) => t.name),
    logic: cfg.logic.on,
    sessionName,
    agentVersion: VERSION,
  };
  if (!obsReady) return status;

  try {
    const [rec, sceneList, stats, stream] = await Promise.all([
      obs.call("GetRecordStatus"),
      obs.call("GetSceneList"),
      obs.call("GetStats"),
      obs.call("GetStreamStatus"),
    ]);
    // OBS reports inactive for a moment while the stream is starting, so only forget the target after a grace period.
    if (!stream.outputActive && Date.now() - streamStartedAt > 20_000) streamTarget = null;
    status.stream = {
      active: !!stream.outputActive,
      reconnecting: !!stream.outputReconnecting,
      timecode: stream.outputTimecode ?? "00:00:00.000",
      target: stream.outputActive ? streamTarget : null,
    };
    status.record = { active: !!rec.outputActive, paused: !!rec.outputPaused, timecode: rec.outputTimecode ?? "00:00:00.000" };
    status.scene = sceneList.currentProgramSceneName ?? null;
    let names = sceneList.scenes.map((s) => s.sceneName);
    if (cfg.reverseScenes) names = names.reverse();
    status.scenes = names;
    knownScenes = names;
    status.diskFreeMb = typeof stats.availableDiskSpace === "number" ? Math.round(stats.availableDiskSpace) : null;
  } catch (e) {
    log("OBS status read failed:", e.message);
    return status;
  }

  await Promise.all(
    status.inputs.map(async (inp) => {
      try {
        inp.muted = (await obs.call("GetInputMute", { inputName: inp.name })).inputMuted;
      } catch {
        inp.muted = null;
      }
    }),
  );

  for (const inp of status.inputs) {
    if (includeMeters) inp.db = Math.round(toDb(peaks.get(inp.name)));
  }
  peaks.clear();
  return status;
}

async function grabSnapshots(focus) {
  const out = {};
  // A full-screen camera gets a bigger, sharper picture; the others pause while it is open.
  const cams = focus && cfg.cams.some((c) => c.key === focus) ? cfg.cams.filter((c) => c.key === focus) : cfg.cams;
  await Promise.all(
    cams.map(async (cam) => {
      try {
        const big = cam.key === focus;
        const r = await obs.call("GetSourceScreenshot", {
          sourceName: cam.val,
          imageFormat: "jpg",
          imageWidth: big ? 1280 : 480,
          imageHeight: big ? 720 : 270,
          imageCompressionQuality: big ? 60 : 55,
        });
        const b64 = String(r.imageData).replace(/^data:image\/\w+;base64,/, "");
        if (b64.length <= (big ? 195_000 : 88_000)) out[cam.key] = b64;
      } catch {
        /* source missing or not rendering; the dashboard shows "waiting for picture" */
      }
    }),
  );
  return out;
}

async function applyFilenameFormat() {
  if (!obsReady) return;
  const base = sessionName ? `${sessionName}_` : "";
  try {
    await obs.call("SetProfileParameter", {
      parameterCategory: "Output",
      parameterName: "FilenameFormatting",
      parameterValue: `${base}%CCYY-%MM-%DD_%hh-%mm-%ss`,
    });
  } catch (e) {
    log("Could not set file name format:", e.message);
  }
}

// ---------- Logic ----------
const KEY_CODES = { space: 49, return: 36 };

/** Brings Logic to the front and presses one key, using AppleScript. Needs Accessibility permission for node. */
function pressInLogic(key) {
  const { app, dryRun } = cfg.logic;
  if (!/^[a-z0-9]$|^space$|^return$/.test(key)) return Promise.reject(new Error(`Unsupported Logic key "${key}"`));
  if (!/^[A-Za-z0-9 ._-]{1,40}$/.test(app)) return Promise.reject(new Error("Unsupported LOGIC_APP name"));
  if (dryRun) {
    log(`[dry run] ${app}: press ${key}`);
    return Promise.resolve();
  }
  if (process.platform !== "darwin") return Promise.reject(new Error("Logic control only works on a Mac"));
  const press = key in KEY_CODES ? `key code ${KEY_CODES[key]}` : `keystroke "${key}"`;
  const script = [`tell application "${app}" to activate`, "delay 0.2", `tell application "System Events" to ${press}`];
  return new Promise((resolve, reject) => {
    execFile("osascript", script.flatMap((l) => ["-e", l]), { timeout: 8000 }, (err, _out, stderr) => {
      if (!err) return resolve();
      const msg = String(stderr || err.message);
      reject(new Error(/not allowed|assistive|1002/i.test(msg) ? "Allow node in Accessibility settings on this Mac" : msg.trim().slice(0, 120)));
    });
  });
}

// ---------- commands ----------
async function runCommand(cmd) {
  // Logic keys do not need OBS; everything else does.
  if (!obsReady && !cmd.type.startsWith("logic_")) throw new Error("OBS is not running on this Mac");
  const p = cmd.payload ?? {};
  switch (cmd.type) {
    case "record_start": {
      const rec = await obs.call("GetRecordStatus");
      if (rec.outputActive) return;
      await applyFilenameFormat();
      await obs.call("StartRecord");
      return;
    }
    case "record_stop": {
      const rec = await obs.call("GetRecordStatus");
      if (!rec.outputActive) return;
      await obs.call("StopRecord");
      return;
    }
    case "scene": {
      if (typeof p.scene !== "string" || !knownScenes.includes(p.scene)) throw new Error("Unknown scene");
      await obs.call("SetCurrentProgramScene", { sceneName: p.scene });
      return;
    }
    case "mute": {
      if (!cfg.mics.some((m) => m.key === p.input) || typeof p.muted !== "boolean") throw new Error("Unknown input");
      await obs.call("SetInputMute", { inputName: p.input, inputMuted: p.muted });
      return;
    }
    case "stream_start": {
      const t = cfg.streams.find((x) => x.name === p.target);
      if (!t) throw new Error("Unknown stream destination");
      const st = await obs.call("GetStreamStatus");
      if (st.outputActive) return;
      await obs.call("SetStreamServiceSettings", {
        streamServiceType: "rtmp_custom",
        streamServiceSettings: { server: t.server, key: t.key, use_auth: false },
      });
      streamTarget = t.name;
      streamStartedAt = Date.now();
      await obs.call("StartStream");
      return;
    }
    case "stream_stop": {
      const st = await obs.call("GetStreamStatus");
      if (!st.outputActive) return;
      await obs.call("StopStream");
      return;
    }
    case "logic_record":
      if (!cfg.logic.on) throw new Error("Logic control is off on this Mac");
      await pressInLogic(cfg.logic.recordKey);
      return;
    case "logic_stop":
      if (!cfg.logic.on) throw new Error("Logic control is off on this Mac");
      await pressInLogic(cfg.logic.stopKey);
      return;
    case "session_name": {
      sessionName = String(p.name ?? "").replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 60);
      await applyFilenameFormat();
      return;
    }
    default:
      throw new Error("Unknown command");
  }
}

// ---------- sync loop ----------
let watching = false;
let focus = null;
let results = [];
let lastKey = "";
let lastStatusPost = 0;
let lastSnapshot = 0;
let serverWarned = false;

async function cycle() {
  await connectObs();

  const status = await buildStatus(watching);
  // Detect real changes, ignoring values that move every second.
  const key = JSON.stringify({
    ...status,
    record: { ...status.record, timecode: "" },
    inputs: status.inputs.map((i) => ({ ...i, db: null })),
  });
  const now = Date.now();
  const body = {};
  if (watching || key !== lastKey || now - lastStatusPost >= 10_000) {
    body.status = status;
    lastKey = key;
    lastStatusPost = now;
  }
  if (watching && obsReady && now - lastSnapshot >= (focus ? 700 : 2000)) {
    body.snapshots = await grabSnapshots(focus);
    lastSnapshot = Date.now();
  }
  if (results.length) body.results = results.splice(0, results.length);

  let res;
  try {
    res = await fetch(`${cfg.appUrl}/api/agent/sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    if (body.results) results.unshift(...body.results);
    if (!serverWarned) log("Dashboard unreachable:", e.message);
    serverWarned = true;
    return false;
  }
  if (!res.ok) {
    if (body.results) results.unshift(...body.results);
    if (!serverWarned) log(`Dashboard replied ${res.status}${res.status === 401 ? " (check AGENT_TOKEN)" : ""}`);
    serverWarned = true;
    return false;
  }
  if (serverWarned) log("Dashboard connection restored");
  serverWarned = false;

  const data = await res.json();
  watching = !!data.watching;
  focus = typeof data.focus === "string" ? data.focus : null;

  let ran = false;
  for (const cmd of data.commands ?? []) {
    ran = true;
    try {
      await runCommand(cmd);
      results.push({ id: cmd.id, ok: true });
      log(`Ran ${cmd.type}`);
    } catch (e) {
      results.push({ id: cmd.id, ok: false, error: e.message });
      log(`Command ${cmd.type} failed: ${e.message}`);
    }
  }
  return ran;
}

async function main() {
  log(`Studio ${cfg.studio} agent ${VERSION} → ${cfg.appUrl}`);
  log(`Streams: ${cfg.streams.map((t) => t.name).join(", ") || "none"}`);
  log(`Cameras: ${cfg.cams.map((c) => `${c.key}=${c.val}`).join(", ") || "none"} | Mics: ${cfg.mics.map((m) => m.key).join(", ") || "none"}`);
  for (;;) {
    const started = Date.now();
    let ran = false;
    try {
      ran = await cycle();
    } catch (e) {
      log("Cycle error:", e.message);
    }
    // After running commands, go straight back so the result and new state reach the dashboard fast.
    if (!ran) await sleep(Math.max(0, (watching ? 700 : 3000) - (Date.now() - started)));
  }
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    try {
      await obs.disconnect();
    } catch {
      /* already closed */
    }
    process.exit(0);
  });
}

main();
