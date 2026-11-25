#!/bin/bash
# Stops BBTouchbar, removes the LaunchAgent, the app and its config.
# Keeps the log and the user's own mascot pictures (~/Library/Application Support/bb-touchbar/mascot);
# --purge removes the mascot folder too.
set -euo pipefail
LABEL="app.gguzhov.bb-touchbar"
DEST="$HOME/Applications/BBTouchbar.app"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
CONF_DIR="$HOME/Library/Application Support/bb-touchbar"
PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
pkill -f "$DEST/Contents/MacOS/BBTouchbar" 2>/dev/null || true
rm -f "$AGENT"
rm -rf "$DEST"
if [ -d "$CONF_DIR" ]; then
  if [ "$PURGE" = 1 ]; then
    rm -rf "$CONF_DIR"
  else
    # Everything except the mascot folder.
    find "$CONF_DIR" -mindepth 1 -maxdepth 1 ! -name mascot -exec rm -rf {} +
    [ -d "$CONF_DIR/mascot" ] || rmdir "$CONF_DIR" 2>/dev/null || true
  fi
fi
echo "removed: app, LaunchAgent, config (log kept: ~/Library/Logs/bb-touchbar.log)"
if [ "$PURGE" = 0 ] && [ -d "$CONF_DIR/mascot" ]; then
  echo "your mascot pictures are kept: $CONF_DIR/mascot (uninstall.sh --purge removes them)"
fi
