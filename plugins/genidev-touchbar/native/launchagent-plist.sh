#!/bin/bash
# Prints the LaunchAgent plist for the given app executable. Used by install.sh.
# usage: launchagent-plist.sh <path to BBTouchbar executable>
set -euo pipefail
LABEL="app.gguzhov.bb-touchbar"
EXE="${1:?path to the app executable}"
xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
EXE_XML="$(printf '%s' "$EXE" | xml_escape)"
cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$EXE_XML</string>
  </array>
  <key>RunAtLoad</key><true/>
  <!-- Restart after a crash; Quit from the menu exits with 0 and stays stopped. -->
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict>
</plist>
PLIST
