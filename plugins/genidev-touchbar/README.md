# Notch Bar for bb

Notch Bar puts a thin black strip around the camera notch of a MacBook and shows what your bb agents are doing, on top of any app:

- **Collapsed strip:** a small robot, the number of projects in work, a ring with the overall share of done tasks and the count done/planned (for example `25/41`). The robot thinks, asks, cheers, gets upset or sleeps with the state of the work.
- **Panel on hover:** one row per thread that has a plan: project icon, the task in work and its time, and a track of coloured blocks, one per task. Filters All / Working / Paused. Click a row to see the tasks by queue with time and executor; the arrow or "Open thread" opens the thread in bb.
- **Messages at the notch:** when a thread finishes, fails or waits for your answer, the strip grows into a short message for a few seconds.
- The strip hides when no thread has a plan.

Plans come from the Working Thread plugin (`task-queue`): the lead agent keeps a plan of queues and tickets there, and Notch Bar counts them.

It is a bb plugin (`genidev-touchbar`, TypeScript) plus a small native macOS app, `BBTouchbar.app` (Swift, AppKit and SwiftUI), that draws the strip. The plugin builds the summary; the app reads it from bb over HTTP on 127.0.0.1.

**The app's labels (panel, menu, messages) are in Russian for now.** The plugin, its CLI and this README are in English.

## Requirements

- bb 0.50 or later.
- macOS 13 or later on a MacBook with a camera notch. On a screen without a notch the strip shows as a pill at the top centre.
- Xcode Command Line Tools (`xcode-select --install`): the app is built from source on your Mac with `swiftc`.
- The Working Thread plugin (`task-queue`) for plans. Without it the strip stays hidden.
- Optional: the Project Icons plugin (`genidev-project-icons`) for thread and executor pictures. Without it rows show letter badges.

## Install

1. Install the plugin:

   ```sh
   bb plugin install genidev-touchbar
   ```

2. Build and install the app from the installed plugin copy:

   ```sh
   bb genidev-touchbar install-app --run
   ```

   Without `--run` the command prints the exact script command for your copy, such as `/bin/bash /path/to/plugin/native/install.sh`, so you can run it yourself in Terminal. The build takes about a minute.

Check it with `bb genidev-touchbar status`.

## Remove

```sh
bb genidev-touchbar uninstall-app --run   # app, LaunchAgent and config
bb plugin remove genidev-touchbar         # the plugin
```

## What the app does on your Mac

- Installs `~/Applications/BBTouchbar.app` and the LaunchAgent `~/Library/LaunchAgents/app.gguzhov.bb-touchbar.plist`, so it starts at login. "Turn off the strip" in its menu stops it until the next login.
- Writes the path to `bb` into `~/Library/Application Support/bb-touchbar/config.json` (mode 600).
- Logs to `~/Library/Logs/bb-touchbar.log`, caches thread icons in `~/Library/Caches/bb-touchbar/icons/` for a week.
- Runs `bb genidev-touchbar endpoint` and `bb plugin token genidev-touchbar` to get the address and token, keeps the token in memory only, and polls `http://127.0.0.1:<port>/api/v1/plugins/genidev-touchbar/http/snapshot` every 2 seconds. It makes no other network requests.
- Runs `bb thread open <id>` when you open a thread from the panel.
- When the plugin folder is read-only, the install script builds in a temporary folder and deletes it afterwards.

You can replace the robot with your own mascot: put seven PNG frames (names in [native/Assets/mascot/README.md](native/Assets/mascot/README.md)) into `~/Library/Application Support/bb-touchbar/mascot/` and restart the app. Uninstalling keeps that folder.

## Commands

```sh
bb genidev-touchbar snapshot [--json]       # threads with a plan: project, done/total, left, time, state
bb genidev-touchbar endpoint [--json]       # snapshot URL for the app
bb genidev-touchbar status [--json]         # app installed, running, version, last snapshot read
bb genidev-touchbar install-app [--run]     # print or run the app install script
bb genidev-touchbar uninstall-app [--run]   # print or run the app uninstall script
bb plugin config genidev-touchbar set recentHours 24
bb plugin config genidev-touchbar set cardLimit 12
```

## What is in the summary

Project, thread and plan titles, the current task and ticket titles, executor names from the plan, counts and times. No message text, prompts or file paths.

## Limits

- macOS only, and the app is built locally; there is no signed download.
- The app's interface is in Russian.
- Work time counts agent turns since the plan appeared; waiting for your answer is not counted.
- The strip covers the menu bar around the notch; a setting in its menu keeps it off menu bar icons.

## Development

```sh
npm run typecheck && npm test && npm run build
native/build.sh && native/build/BBTouchbar.app/Contents/MacOS/BBTouchbar --selftest
```

Architecture and design notes (in Russian): [ARCHITECTURE.md](ARCHITECTURE.md), [DESIGN.md](DESIGN.md), [features/notch-strip.md](features/notch-strip.md). Russian README: [README.ru.md](README.ru.md).
