---
name: genidev-touchbar
description: Notch Bar — a strip around the MacBook camera notch that shows bb agents' plans (projects in work, tasks done/planned, work time). Use for `bb genidev-touchbar snapshot|endpoint|status|install-app|uninstall-app`, and to install, restart or diagnose the notch app.
---

# Notch Bar (genidev-touchbar)

The plugin builds a summary of threads that have a work plan in the card above the composer (the Working Thread plugin, id `task-queue`). A small macOS app, `BBTouchbar.app`, draws it as a black strip around the camera notch: a robot, the number of projects in work and the overall tasks done/planned. Hovering opens a panel with one row per thread: the current task, its time and a track of blocks per task. A click expands the tasks; the arrow opens the thread in bb.

## What is counted

- Tasks: tickets of the thread's plan. `done` and `skipped` count as done, the rest as remaining.
- Work time: the agent's turns in the thread since the plan appeared. It grows while a turn runs; waiting for the owner between turns is not counted.
- Time per task: agent work during the task (`workMs` of the ticket), by turns, not by wall clock.
- Summary (`summary`): projects and threads in work, tasks in working threads, done and planned over all threads.
- Icons: with the Project Icons plugin (`genidev-project-icons`) a thread gets its project's icon (`chosen`, starred in `snapshot`) or a library icon pinned to the thread; ticket executors (`agent`) get icons by name. Without that plugin icons are `null` and the app draws letter badges.
- Visible, unarchived threads that run now or changed within `recentHours` hours. A finished plan stays for 10 more minutes.

## Commands

```
bb genidev-touchbar snapshot          # one line per thread: project, 2/6, left, time, state, title
bb genidev-touchbar snapshot --json   # snapshot in the lib/contract.ts format
bb genidev-touchbar endpoint          # snapshot URL for the app (127.0.0.1)
bb plugin token genidev-touchbar      # token for the x-bb-plugin-token header
bb genidev-touchbar status            # app installed? running? version, last snapshot read
bb genidev-touchbar install-app       # print the exact install command for this plugin copy
bb genidev-touchbar install-app --run # build and install the app now (about a minute)
bb genidev-touchbar uninstall-app [--run]
```

Card states: `working` — an agent turn runs, `waiting` — the plan waits for the owner, `error`, `done`, `idle` — plan open, nobody works.

## Settings

```
bb plugin config genidev-touchbar set recentHours 24   # how far back to look for threads with a plan
bb plugin config genidev-touchbar set cardLimit 12     # how many cards to send
```

## The app

`install-app` prints `/bin/bash <plugin folder>/native/install.sh`. The script builds the app with swiftc (Xcode Command Line Tools), copies it to `~/Applications/BBTouchbar.app`, writes `~/Library/Application Support/bb-touchbar/config.json` with the bb path and installs the LaunchAgent `app.gguzhov.bb-touchbar`. `native/run.sh status|restart|stop|logs` controls a running copy. App log: `~/Library/Logs/bb-touchbar.log`.

Custom mascot: put PNG frames (`idle.png`, `left.png`, `right.png`, `asking.png`, `upset.png`, `happy.png`, `sleeping.png`; see `native/Assets/mascot/README.md`) in `~/Library/Application Support/bb-touchbar/mascot/` and restart the app. Without them it draws a robot.

The app's own labels (panel, menu) are in Russian for now.

## If the strip is missing

1. `bb genidev-touchbar snapshot` — are there threads with a plan? No cards means the strip hides, by design.
2. `bb genidev-touchbar status` — is the app installed and running, and has it read the snapshot recently?
3. The last lines of the app log. An unreachable address means the bb server restarted; the app asks for the address again within seconds.
4. Plans come from the `task-queue` plugin. If it is off, the snapshot is empty.
