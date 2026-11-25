#!/bin/bash
# Builds BBTouchbar.app, installs it to ~/Applications, writes config.json (0600),
# installs the LaunchAgent and starts it. Safe to run again.
# Works from a read-only plugin copy without .git (a catalog install): then it builds in a
# temporary folder and removes it afterwards.
# Optional: BB_PATH=/path/to/bb ./install.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="app.gguzhov.bb-touchbar"
DEST="$HOME/Applications/BBTouchbar.app"
EXE="$DEST/Contents/MacOS/BBTouchbar"
CONF_DIR="$HOME/Library/Application Support/bb-touchbar"
CONF="$CONF_DIR/config.json"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ -z "${BB_TOUCHBAR_BUILD_DIR:-}" ]; then
  if { [ -d "$DIR/build" ] && [ -w "$DIR/build" ]; } || { [ ! -e "$DIR/build" ] && [ -w "$DIR" ]; }; then
    BB_TOUCHBAR_BUILD_DIR="$DIR/build"
  else
    BB_TOUCHBAR_BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bb-touchbar-build.XXXXXX")"
    trap 'rm -rf "$BB_TOUCHBAR_BUILD_DIR"' EXIT
    echo "plugin folder is read-only, building in $BB_TOUCHBAR_BUILD_DIR"
  fi
fi
export BB_TOUCHBAR_BUILD_DIR
APP_SRC="$BB_TOUCHBAR_BUILD_DIR/BBTouchbar.app"

/bin/bash "$DIR/build.sh"

# bootout is asynchronous; bootstrap right after it fails with error 5.
wait_unloaded() {
  for _ in $(seq 1 40); do
    launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || return 0
    sleep 0.25
  done
}

# Stop the running copy before replacing it (no error if it is not loaded).
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
wait_unloaded
pkill -f "$EXE" 2>/dev/null || true

mkdir -p "$HOME/Applications"
rm -rf "$DEST.new"
ditto "$APP_SRC" "$DEST.new"
rm -rf "$DEST"
mv "$DEST.new" "$DEST"

# Find bb: BB_PATH, current PATH, login shell PATH, usual places.
BB="${BB_PATH:-}"
[ -z "$BB" ] && BB="$(command -v bb 2>/dev/null || true)"
[ -z "$BB" ] && BB="$("${SHELL:-/bin/zsh}" -lc 'command -v bb' 2>/dev/null || true)"
if [ -z "$BB" ]; then
  for c in /opt/homebrew/bin/bb /usr/local/bin/bb "$HOME/.bb/bin/bb" "$HOME/.local/bin/bb" \
           /Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb; do
    if [ -x "$c" ]; then BB="$c"; break; fi
  done
fi

mkdir -p "$CONF_DIR"
chmod 700 "$CONF_DIR"
if [ -n "$BB" ] && [ -x "$BB" ]; then
  BB_JSON="$(printf '%s' "$BB" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
  TMP="$(mktemp "$CONF_DIR/config.XXXXXX")"   # mktemp creates the file with mode 0600
  printf '{"bbPath": "%s"}\n' "$BB_JSON" > "$TMP"
  chmod 600 "$TMP"
  mv -f "$TMP" "$CONF"
  chmod 600 "$CONF"
  echo "bb: $BB (saved to $CONF)"
else
  echo "warning: bb not found; the app will look for it itself. Set BB_PATH=... and run again." >&2
fi

mkdir -p "$HOME/Library/LaunchAgents"
TMP_AGENT="$(mktemp "$AGENT.XXXXXX")"
/bin/bash "$DIR/launchagent-plist.sh" "$EXE" > "$TMP_AGENT"
plutil -lint "$TMP_AGENT" >/dev/null
chmod 644 "$TMP_AGENT"
mv -f "$TMP_AGENT" "$AGENT"

launchctl bootstrap "$DOMAIN" "$AGENT"
launchctl kickstart -k "$DOMAIN/$LABEL"
sleep 1
if launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -q "state = running"; then
  echo "installed and running: $DEST"
else
  echo "installed but not running: see ~/Library/Logs/bb-touchbar.log" >&2
  exit 1
fi
