#!/bin/bash
# Installs the studio agent so it starts at login and restarts if it stops.
# Run on each studio Mac from inside the agent folder:  bash install-mac.sh
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node || true)"
LABEL="com.midcitysound.studio-agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/studio-agent.log"

if [ -z "$NODE" ]; then
  echo "Node.js was not found. Install it first:  brew install node"
  exit 1
fi
if [ ! -f "$DIR/.env" ]; then
  echo "Missing $DIR/.env. Copy .env.example to .env and fill it in first."
  exit 1
fi

cd "$DIR"
npm install --omit=dev --no-audit --no-fund

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/agent.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "Installed. It starts at login and restarts if it stops."
echo "Watch it:  tail -f $LOG"
echo "Remove it: launchctl bootout gui/$(id -u) $PLIST && rm $PLIST"
