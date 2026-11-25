#!/bin/bash
# usage: run.sh status|restart|stop|logs
set -euo pipefail
LABEL="app.gguzhov.bb-touchbar"
DOMAIN="gui/$(id -u)"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/bb-touchbar.log"

# bootout is asynchronous; bootstrap right after it fails with error 5.
wait_unloaded() {
  for _ in $(seq 1 40); do
    launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || return 0
    sleep 0.25
  done
}

case "${1:-status}" in
  status)
    if launchctl print "$DOMAIN/$LABEL" >/tmp/bb-touchbar-status.$$ 2>/dev/null; then
      grep -E "^\s+(state|pid|last exit code) =" /tmp/bb-touchbar-status.$$ || true
    else
      echo "LaunchAgent not loaded"
    fi
    rm -f /tmp/bb-touchbar-status.$$
    pgrep -fl "BBTouchbar.app/Contents/MacOS/BBTouchbar" || echo "process not found"
    ;;
  restart)
    [ -f "$AGENT" ] || { echo "no $AGENT: run install.sh first" >&2; exit 1; }
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    wait_unloaded
    launchctl bootstrap "$DOMAIN" "$AGENT"
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "restarted"
    ;;
  stop)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    echo "stopped (until next login or run.sh restart)"
    ;;
  logs)
    tail -n 50 "$LOG" 2>/dev/null || echo "no log yet: $LOG"
    ;;
  *)
    echo "usage: $0 status|restart|stop|logs" >&2
    exit 2
    ;;
esac
