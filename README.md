# MCS Studio Control

Phone and desktop control panel for the Mid City Sound studios. Start and stop recording, switch scenes, watch the three cameras and mic levels, name the session. Built on the IN-FLU-ENTIAL design system (`@flu-wop/design-system` v0.6.3).

```
Phone / desktop  →  Vercel app (Next.js 16)  →  Turso  ←  agent on each Mac  →  OBS (localhost only)
```

Nothing connects into your studio network. The agent on each Mac only makes outbound HTTPS calls, and OBS never leaves `localhost`.

## 1. Deploy the dashboard

1. Create a **new** Turso database: `turso db create mcs-studio-control`, then `turso db tokens create mcs-studio-control`.
2. Push this folder to a new private GitHub repo and import it in Vercel (or `vercel` from the folder).
3. Add these env vars in Vercel (see `.env.example`):
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `OWNER_PASSWORD`, `SESSION_SECRET` (`openssl rand -base64 48`), `AGENT_TOKEN_A`, `AGENT_TOKEN_B` (`openssl rand -hex 32`, a different one each).
4. Add the domain `studio.midcitysound.com` to the project. Tables create themselves on first request.

## 2. OBS on each Mac

1. OBS > Tools > WebSocket Server Settings: enable it, keep port 4455, set a password.
2. Make sure each Mac has the same scene names, and that sources are named to match the agent config (for example `CAM A Room`, `Booth Mic`).
3. Set OBS to launch at login.

## 3. Agent on each Mac

```bash
cd agent
cp .env.example .env     # fill in STUDIO, APP_URL, AGENT_TOKEN, OBS_PASSWORD, CAMERAS, MIC_INPUTS
bash install-mac.sh
tail -f ~/Library/Logs/studio-agent.log
```

Studio A uses `AGENT_TOKEN_A` with `CAMERAS=cam1=...,cam2=...`. Studio B uses `AGENT_TOKEN_B` with `CAMERAS=cam3=...`.

## Using it

- Phone: pick a studio, tap Record. Stopping takes two taps. A sticky bar keeps Record in reach.
- Desktop: both studios side by side. Keys: `A` / `B` pick a studio, `R` record or stop (press twice to stop), `1`-`9` scenes.
- Pictures and meters only flow while a dashboard tab is open and visible, so idle studios send almost nothing.
- A command that the studio doesn't pick up within 20 seconds is dropped, never run later.

## Extra views (desktop screens)

Any OBS source or scene can appear in the camera wall and full-screen swipe. Add it to `CAMERAS` with an id and an optional label:

```
CAMERAS=cam3=Studio B Cam,screen1=Display 1|B Desktop 1,screen2=Display 2|B Desktop 2
```

Switching what the studio is showing (the OBS program output) is done with the Scene buttons, so make a scene for each view you want to switch to.

## Full-screen cameras

Tap any camera tile to open it full screen. Swipe left or right (or use the arrow keys, the side buttons, or the camera names along the bottom) to move between A Room, Booth and B Room. Esc or Close returns to the dashboard. While a camera is open, its Mac sends a larger picture.

## Going live

Each studio panel has a Stream section once `STREAM_TARGETS` is set in that Mac's `agent/.env`:

```
STREAM_TARGETS=Twitch|rtmp://live.twitch.tv/app|live_xxxx,YouTube|rtmp://a.rtmp.youtube.com/live2|xxxx-xxxx,Kick|<server URL>|sk_xxxx
```

Pick a destination, tap Go live, and tap again to confirm. Ending takes two taps too. Stream keys stay on the Mac and are never sent to the dashboard. One destination can be live at a time per studio. Quality (bitrate, encoder, resolution) comes from your OBS output settings. After changing `.env`, restart the agent with `launchctl kickstart -k gui/$(id -u)/com.midcitysound.studio-agent`.

## Engineers

Owner only: tap **Invite engineer**, type their name, and tap Make code. They get a 6-digit code that works once and expires in 10 minutes. They open the site, tap "I have an engineer code", and type it. You can cancel an open code or sign an engineer out at any time from the same panel, and a sign-out takes effect within a few seconds.

Engineers can record and stop, switch scenes, mute mics, and mark moments. They cannot go live, control Logic, rename sessions, or invite anyone.

## Mark moment

While a studio is recording, tap **Mark moment** (or press `M`) to drop a timestamped marker. The latest markers show under the Record button, and **CSV** downloads the markers from that studio's most recent recording (timecode, label, who marked it).

## Logic

Set `LOGIC_CONTROL=on` in a Mac's `agent/.env` to show Logic Record and Stop buttons (owner only, two taps each). The agent presses Logic's own keys, so `LOGIC_RECORD_KEY` and `LOGIC_STOP_KEY` must match Logic's key commands (defaults `r` and `space`). Stop sends the play/stop key, which starts playback if Logic is idle, so use it only while Logic is running.

One-time setup on that Mac: System Settings > Privacy & Security > Accessibility, add the `node` program (run `which node` for its path; in the file picker press Cmd+Shift+G to type it), then restart the agent. macOS may also ask to let node control Logic Pro and System Events; allow both.

## Bookings

The MCS site tells Studio Control about bookings by calling `POST /api/bookings/webhook` after a booking is paid, changed or cancelled. Add `integrations/notify-studio-control.ts` to the MCS site, set `STUDIO_CONTROL_URL` and `BOOKING_WEBHOOK_SECRET` there (same secret as this project), and call `notifyStudioControl({ id, room: "A", client, start, end })` where a paid booking is confirmed. Call it again with `cancelled: true` if a booking is cancelled. Rooms other than A and B are ignored. Requests are signed (HMAC-SHA256 over timestamp and body) and expire after 5 minutes.

Each studio panel shows its current or next booking. From 15 minutes before a booking starts, the studio's session name is set to the client's name, so the recording files are named for them. Nothing starts recording by itself; someone still presses Record. If you rename the session by hand afterwards, it stays as you set it.

## Session archive

**Archive** in the header (owner only) lists every recording: studio, client or session name, start and end times, length, who pressed Record (Owner, an engineer's name, or OBS), and a CSV of any marked moments. Recordings are logged wherever Record was pressed, including in OBS itself. The video files stay on the studio Macs.

## Troubleshooting

- **Studio shows Offline:** agent isn't running or the token is wrong. Check the log.
- **OBS closed:** agent is fine but can't reach OBS. Check WebSocket is enabled and the password matches.
- **Scenes upside down:** set `SCENE_ORDER=normal` in `agent/.env` and restart the agent.
- **No picture on a camera tile:** the source name in `CAMERAS` must match the OBS source exactly.
- **Mic bar stuck at -inf:** the name in `MIC_INPUTS` must match the OBS input exactly. When the agent connects, its log says which mic or camera names OBS doesn't have and lists the ones it does.
- **Meter flat but OBS's own meter moves:** check the name above. **Meter flat in OBS too:** give OBS Microphone permission in System Settings > Privacy & Security, and add the audio device under OBS Settings > Audio > Global Audio Devices so it is live in every scene.

## Phases

1. This build: OBS control, scenes, record, cameras, meters, owner login.
2. Engineer pairing codes, mark-moment, Logic start/stop.
3. MCS booking auto-arm, session archive, streaming out.
